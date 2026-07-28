import { and, asc, eq, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./client";
import { holidays, orgs, timeOff, users, workDays } from "./schema";
import { AccessDenied, loadOrgRules, type Viewer } from "./access";
import { deductFor } from "./timeoff";
import { recomputeWorkDays } from "./recompute";
import { isPeriodClosed } from "./close";
import { resolvePeriod } from "@/lib/attendance/period";
import type { BreakRule } from "@/lib/attendance/types";
import { now } from "@/lib/clock";

/**
 * 근태 규칙·공휴일·휴가 관리 (HR).
 *
 * 규칙을 바꾸면 과거 work_days 가 낡은 값이 된다. work_days 는 파생 데이터이므로
 * 원본 태그에서 다시 계산한다 — 이게 계산 로직을 순수 함수로 둔 이유다.
 */

function assertHr(viewer: Viewer) {
  if (viewer.role !== "hr") {
    throw new AccessDenied("근태 설정 변경은 HR 권한이 필요합니다.");
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function band(start: string, end: string, label: string) {
  const s = start.trim();
  const e = end.trim();
  if (!s && !e) return { start: null, end: null };
  if (!HHMM.test(s) || !HHMM.test(e)) {
    throw new Error(`${label}는 HH:MM 형식으로 둘 다 넣거나 둘 다 비워야 합니다.`);
  }
  return { start: s, end: e };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * 실제로 존재하는 날짜인지 본다.
 * 형식만 검사하면 "2026-13-99" 가 통과해서 Postgres 에러가 사용자에게
 * 그대로 노출된다.
 */
function assertDate(value: string, label: string): string {
  const text = value.trim();
  if (!DateTime.fromISO(text).isValid || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${label}가 올바른 날짜가 아닙니다: "${text}"`);
  }
  return text;
}

export type OrgRulesInput = {
  settlementPeriod: "week" | "month";
  weekStartDay: number;
  targetCalcMethod: "business_days" | "fixed";
  targetMinutesPerPeriod: number;
  standardMinutesPerDay: number;
  limitMinutesPerWeek: number;
  dayBoundaryHour: number;
  break4h: number;
  break8h: number;
  coreTimeStart: string;
  coreTimeEnd: string;
  flexBandStart: string;
  flexBandEnd: string;
  nightWindowStart: string;
  nightWindowEnd: string;
  dailyLimitMinutes: number | null;
  closeGraceDays: number;
  reviewThresholdMinutes: number;
};

/** 설정끼리 모순되는지 — 막지는 않고 알려준다. 회사 정책 판단이다. */
export function ruleWarnings(input: {
  coreTime: { start: string; end: string } | null;
  flexBand: { start: string; end: string } | null;
  dailyLimitMinutes: number | null;
  breakRules: BreakRule[];
}): string[] {
  const out: string[] = [];
  const { coreTime, flexBand, dailyLimitMinutes, breakRules } = input;

  if (coreTime && toMinutes(coreTime.end) <= toMinutes(coreTime.start)) {
    out.push("의무근로시간대의 종료가 시작보다 이르거나 같습니다.");
  }

  if (coreTime && flexBand) {
    if (
      toMinutes(coreTime.start) < toMinutes(flexBand.start) ||
      toMinutes(coreTime.end) > toMinutes(flexBand.end)
    ) {
      out.push(
        "의무근로시간대가 선택적 근로시간대 밖에 있습니다. 지킬 수 없는 규칙이 됩니다.",
      );
    }
  }

  if (flexBand && dailyLimitMinutes !== null) {
    const width = toMinutes(flexBand.end) - toMinutes(flexBand.start);
    const deduct = breakRules.reduce(
      (max, r) => (width >= r.overHours * 60 ? Math.max(max, r.deductMinutes) : max),
      0,
    );
    if (width - deduct > dailyLimitMinutes) {
      out.push(
        `선택적 근로시간대를 꽉 채우면 실근무 ${Math.floor((width - deduct) / 60)}시간이 되어 1일 상한을 넘습니다. 규정을 지켰는데도 위반이 잡힙니다.`,
      );
    }
  }

  return out;
}

export async function updateOrgRules(
  viewer: Viewer,
  input: OrgRulesInput,
): Promise<void> {
  assertHr(viewer);

  if (input.weekStartDay < 1 || input.weekStartDay > 7) {
    throw new Error("주 시작일은 1(월)~7(일) 사이여야 합니다.");
  }
  if (input.dayBoundaryHour < 0 || input.dayBoundaryHour > 12) {
    throw new Error("날짜 귀속 기준시각은 0~12시 사이여야 합니다.");
  }
  if (input.standardMinutesPerDay <= 0) {
    throw new Error("1일 소정근로는 0보다 커야 합니다.");
  }

  const coreTime = band(input.coreTimeStart, input.coreTimeEnd, "의무근로시간대");
  const flexBand = band(
    input.flexBandStart,
    input.flexBandEnd,
    "선택적 근로시간대",
  );
  const nightWindow = band(
    input.nightWindowStart,
    input.nightWindowEnd,
    "야간근로 시간대",
  );
  if (!nightWindow.start || !nightWindow.end) {
    throw new Error("야간근로 시간대는 비울 수 없습니다.");
  }

  const breakRules: BreakRule[] = [
    { overHours: 4, deductMinutes: Math.max(0, input.break4h) },
    { overHours: 8, deductMinutes: Math.max(0, input.break8h) },
  ];

  await db
    .update(orgs)
    .set({
      settlementPeriod: input.settlementPeriod,
      weekStartDay: input.weekStartDay,
      targetCalcMethod: input.targetCalcMethod,
      targetMinutesPerPeriod: input.targetMinutesPerPeriod,
      standardMinutesPerDay: input.standardMinutesPerDay,
      limitMinutesPerWeek: input.limitMinutesPerWeek,
      dayBoundaryHour: input.dayBoundaryHour,
      breakRules,
      coreTimeStart: coreTime.start,
      coreTimeEnd: coreTime.end,
      flexBandStart: flexBand.start,
      flexBandEnd: flexBand.end,
      nightWindowStart: nightWindow.start,
      nightWindowEnd: nightWindow.end,
      dailyLimitMinutes: input.dailyLimitMinutes,
      closeGraceDays: Math.max(0, input.closeGraceDays),
      reviewThresholdMinutes: Math.max(0, input.reviewThresholdMinutes),
    })
    .where(eq(orgs.id, viewer.orgId));
}

/**
 * 규칙이 바뀐 뒤 전원 재계산.
 *
 * 마감된 기간도 다시 계산한다 — 공식 기록은 스냅샷이라 흔들리지 않고,
 * 대신 "마감 후 값이 바뀌었습니다"로 드러나는 게 맞는 동작이다.
 */
export async function recomputeEveryone(
  viewer: Viewer,
): Promise<{ users: number; days: number }> {
  assertHr(viewer);
  const rules = await loadOrgRules(viewer.orgId);

  const [earliest] = await db
    .select({ workDate: workDays.workDate })
    .from(workDays)
    .where(eq(workDays.orgId, viewer.orgId))
    .orderBy(asc(workDays.workDate))
    .limit(1);
  if (!earliest) return { users: 0, days: 0 };

  const from = earliest.workDate;
  // lib/clock 의 now()를 쓴다. DateTime.now()를 쓰면 앱 안에 시계가 두 개가 된다.
  const today = DateTime.fromJSDate(now(), {
    zone: rules.attendance.timezone,
  }).toISODate()!;
  const to = today > from ? today : from;

  const members = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgId, viewer.orgId), eq(users.active, true)));

  let total = 0;
  for (const m of members) {
    const days = await recomputeWorkDays({
      orgId: viewer.orgId,
      userId: m.id,
      from,
      to,
      rules: rules.attendance,
    });
    total += days.length;
  }
  return { users: members.length, days: total };
}

// ── 공휴일 ──

export async function listHolidays(orgId: string) {
  return db
    .select({ id: holidays.id, date: holidays.date, name: holidays.name })
    .from(holidays)
    .where(eq(holidays.orgId, orgId))
    .orderBy(asc(holidays.date));
}

export async function addHoliday(viewer: Viewer, date: string, name: string) {
  assertHr(viewer);
  const day = assertDate(date, "공휴일 날짜");
  if (!name.trim()) throw new Error("공휴일 이름을 넣어 주세요.");

  await db
    .insert(holidays)
    .values({ orgId: viewer.orgId, date: day, name: name.trim() })
    .onConflictDoNothing();
}

export async function removeHoliday(viewer: Viewer, id: string) {
  assertHr(viewer);
  await db
    .delete(holidays)
    .where(and(eq(holidays.id, id), eq(holidays.orgId, viewer.orgId)));
}

// ── 휴가 ──

export async function listTimeOff(orgId: string, from: string, to: string) {
  return db
    .select({
      id: timeOff.id,
      date: timeOff.date,
      kind: timeOff.kind,
      deductMinutes: timeOff.deductMinutes,
      reason: timeOff.reason,
      status: timeOff.status,
      userName: users.name,
      employeeNo: users.employeeNo,
    })
    .from(timeOff)
    .innerJoin(users, eq(timeOff.userId, users.id))
    .where(
      and(
        eq(timeOff.orgId, orgId),
        gte(timeOff.date, from),
        lte(timeOff.date, to),
      ),
    )
    .orderBy(asc(timeOff.date));
}

export async function addTimeOff(
  viewer: Viewer,
  input: {
    employeeNo: string;
    date: string;
    kind: "full" | "half_am" | "half_pm" | "unpaid";
    reason: string;
  },
) {
  assertHr(viewer);
  const day = assertDate(input.date, "휴가 날짜");

  const rules = await loadOrgRules(viewer.orgId);
  const range = resolvePeriod(day, {
    kind: rules.settlementKind,
    weekStartDay: rules.weekStartDay,
    timezone: rules.attendance.timezone,
  });
  if (await isPeriodClosed(viewer.orgId, range)) {
    throw new AccessDenied(
      `${range.start} ~ ${range.end} 정산기간은 마감되어 휴가를 등록할 수 없습니다.`,
    );
  }

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.orgId, viewer.orgId),
        eq(users.employeeNo, input.employeeNo.trim()),
      ),
    );
  if (!target) throw new Error(`사번 ${input.employeeNo} 을 찾을 수 없습니다.`);

  /*
   * HR 직접 등록은 즉시 승인이다.
   *
   * 승인 절차는 "본인이 자기 소정근로를 낮추는 것"을 막기 위한 것이고,
   * HR 이 대신 넣는 건 이미 결정이 있었다는 뜻이다. 여기서 pending 으로
   * 두면 HR 이 넣고 HR 이 다시 승인하는 무의미한 두 단계가 된다.
   */
  await db
    .insert(timeOff)
    .values({
      orgId: viewer.orgId,
      userId: target.id,
      date: day,
      kind: input.kind,
      deductMinutes: deductFor(
        input.kind,
        rules.settlement.standardMinutesPerDay,
      ),
      reason: input.reason.trim() || null,
      status: "approved",
      requestedBy: target.id,
      decidedBy: viewer.id,
      decidedAt: now(),
      createdBy: viewer.id,
    })
    .onConflictDoNothing();
}

export async function removeTimeOff(viewer: Viewer, id: string) {
  assertHr(viewer);
  await db
    .delete(timeOff)
    .where(and(eq(timeOff.id, id), eq(timeOff.orgId, viewer.orgId)));
}
