import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./client";
import { dayAdjustments, users } from "./schema";
import {
  AccessDenied,
  assertCanReadDetail,
  loadOrgRules,
  type OrgRules,
  type Viewer,
} from "./access";
import { isPeriodClosed } from "./close";
import { baselineWorkMinutes } from "./baseline";
import { deviationMinutes } from "@/lib/attendance/estimate";
import { recomputeWorkDays } from "./recompute";
import { syncNotifications } from "./notify";
import { resolvePeriod, type PeriodRange } from "@/lib/attendance/period";

/**
 * 예외 보정 입력.
 *
 * 화면이 "퇴근 시각을 보정해 주세요"라고 지시하면 그걸 할 수 있어야 한다.
 * append-only로 쌓고 (userId, workDate)별 가장 최근 1건만 적용한다.
 */

export type AdjustInput = {
  workDate: string;
  /** "HH:MM" — 비우면 기존 값을 그대로 쓴다 */
  firstIn?: string;
  lastOut?: string;
  /** 외근·출장처럼 시각을 모르고 시간만 더하는 경우 (실근무 분) */
  addedMinutes?: number;
  reason: string;
};

/**
 * 기록 수정은 본인과 HR만. 팀장은 조회까지만 한다 —
 * 남의 근태 시간을 고칠 수 있으면 열람 로그로도 감사가 안 된다.
 */
async function assertCanEdit(viewer: Viewer, targetUserId: string) {
  if (viewer.id === targetUserId) return;
  if (viewer.role === "hr") return;
  throw new AccessDenied("본인 기록만 보정할 수 있습니다.");
}

/**
 * 마감된 기간은 보정할 수 없다. 마감의 요점이 "확정된 과거가 더는 안 바뀐다"는
 * 것이므로, 고쳐야 하면 HR이 재마감(reopen)해야 한다.
 */
async function assertPeriodOpen(rules: OrgRules, workDate: string) {
  const range = resolvePeriod(workDate, {
    kind: rules.settlementKind,
    weekStartDay: rules.weekStartDay,
    timezone: rules.attendance.timezone,
  });
  if (await isPeriodClosed(rules.orgId, range)) {
    throw new AccessDenied(
      `${range.start} ~ ${range.end} 정산기간은 마감되어 보정할 수 없습니다. HR에 재마감을 요청하세요.`,
    );
  }
}

function combine(
  workDate: string,
  hhmm: string | undefined,
  zone: string,
): Date | null {
  if (!hhmm) return null;
  const dt = DateTime.fromISO(`${workDate}T${hhmm}`, { zone });
  return dt.isValid ? dt.toJSDate() : null;
}

export async function createAdjustment(
  viewer: Viewer,
  targetUserId: string,
  input: AdjustInput,
): Promise<void> {
  await assertCanEdit(viewer, targetUserId);

  const reason = input.reason.trim();
  if (!reason) throw new Error("사유를 적어 주세요. 근태 보정은 감사 대상입니다.");

  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;
  await assertPeriodOpen(rules, input.workDate);

  let firstInAt = combine(input.workDate, input.firstIn, zone);
  let lastOutAt = combine(input.workDate, input.lastOut, zone);
  const addedMinutes = Math.max(0, Math.round(input.addedMinutes ?? 0));

  if (!firstInAt && !lastOutAt && addedMinutes === 0) {
    throw new Error("출근·퇴근 시각이나 추가 근무시간 중 하나는 넣어야 합니다.");
  }

  // 자기신고에 상한이 없으면 부풀리기에 아무 저항이 없다.
  const limit = rules.attendance.dailyLimitMinutes;
  if (limit !== null && addedMinutes > limit) {
    throw new Error(
      `외근 시간은 1일 상한(${Math.floor(limit / 60)}시간)을 넘을 수 없습니다.`,
    );
  }

  // 퇴근이 출근보다 이르면 자정을 넘긴 것으로 본다.
  // time 입력만으로는 날짜를 알 수 없어서 이 규칙이 필요하다.
  if (firstInAt && lastOutAt && lastOutAt <= firstInAt) {
    lastOutAt = DateTime.fromJSDate(lastOutAt, { zone })
      .plus({ days: 1 })
      .toJSDate();
  }

  const kind =
    firstInAt || lastOutAt
      ? "missing_tag"
      : addedMinutes > 0
        ? "field_work"
        : "correction";

  // 기대값을 먼저 잡아둔다 (보정을 넣기 전 상태 기준)
  const baseline = await baselineWorkMinutes(
    targetUserId,
    input.workDate,
    rules,
  );

  const [inserted] = await db
    .insert(dayAdjustments)
    .values({
      orgId: viewer.orgId,
      userId: targetUserId,
      workDate: input.workDate,
      kind,
      overrideFirstInAt: firstInAt,
      overrideLastOutAt: lastOutAt,
      addedMinutes,
      reason,
      createdBy: viewer.id,
    })
    .returning({ id: dayAdjustments.id });

  const days = await recomputeWorkDays({
    orgId: viewer.orgId,
    userId: targetUserId,
    from: input.workDate,
    to: input.workDate,
    rules: rules.attendance,
  });

  // 벗어난 정도를 방금 넣은 행에만 기록한다. 검토는 이 값으로 한다.
  const final = days.find((d) => d.workDate === input.workDate);
  await db
    .update(dayAdjustments)
    .set({
      deltaMinutes: deviationMinutes({
        finalWorkMinutes: final?.workMinutes ?? 0,
        baselineWorkMinutes: baseline,
        standardMinutesPerDay: rules.settlement.standardMinutesPerDay,
      }),
    })
    .where(eq(dayAdjustments.id, inserted.id));

  // 보정으로 해소된 알림을 지운다
  await syncNotifications(viewer.orgId);
}

/** 보정 취소도 삭제가 아니라 새 행이다 */
export async function revertAdjustment(
  viewer: Viewer,
  targetUserId: string,
  workDate: string,
  reason: string,
): Promise<void> {
  await assertCanEdit(viewer, targetUserId);

  const rules = await loadOrgRules(viewer.orgId);
  await assertPeriodOpen(rules, workDate);

  await db.insert(dayAdjustments).values({
    orgId: viewer.orgId,
    userId: targetUserId,
    workDate,
    kind: "revert",
    addedMinutes: 0,
    reason: reason.trim() || "보정 취소",
    createdBy: viewer.id,
  });

  await recomputeWorkDays({
    orgId: viewer.orgId,
    userId: targetUserId,
    from: workDate,
    to: workDate,
    rules: rules.attendance,
  });

  await syncNotifications(viewer.orgId);
}

export type AdjustmentRow = {
  id: string;
  workDate: string;
  kind: "field_work" | "missing_tag" | "correction" | "revert";
  overrideFirstInAt: Date | null;
  overrideLastOutAt: Date | null;
  addedMinutes: number;
  reason: string;
  createdAt: Date;
  createdByName: string;
};

export async function listAdjustments(
  viewer: Viewer,
  targetUserId: string,
  range: PeriodRange,
): Promise<AdjustmentRow[]> {
  // 읽기이므로 조회 권한을 쓴다. 여기에 쓰기 권한(assertCanEdit)을 걸면
  // 팀장이 팀원 보정 이력을 못 봐서 검토 화면 자체가 성립하지 않는다.
  await assertCanReadDetail(viewer, targetUserId);

  return db
    .select({
      id: dayAdjustments.id,
      workDate: dayAdjustments.workDate,
      kind: dayAdjustments.kind,
      overrideFirstInAt: dayAdjustments.overrideFirstInAt,
      overrideLastOutAt: dayAdjustments.overrideLastOutAt,
      addedMinutes: dayAdjustments.addedMinutes,
      reason: dayAdjustments.reason,
      createdAt: dayAdjustments.createdAt,
      createdByName: users.name,
    })
    .from(dayAdjustments)
    .innerJoin(users, eq(dayAdjustments.createdBy, users.id))
    .where(
      and(
        eq(dayAdjustments.userId, targetUserId),
        gte(dayAdjustments.workDate, range.start),
        lte(dayAdjustments.workDate, range.end),
      ),
    )
    .orderBy(desc(dayAdjustments.createdAt));
}
