import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "./client";
import { accessLogs, holidays, orgs, teams, timeOff, users, workDays } from "./schema";
import type { AttendanceRules, ComputedDay } from "@/lib/attendance/types";
import type { SettlementRules, TimeOffEntry } from "@/lib/attendance/settle";
import type { PeriodRange } from "@/lib/attendance/period";

/**
 * 데이터 접근 게이트.
 *
 * "임원은 개인 상세를 볼 수 없다"는 스키마로 표현할 수 없다. 화면마다 직접
 * 쿼리하면 어딘가에서 반드시 빠지므로, 개인 상세 조회는 전부 이 파일을 통과한다.
 *
 * 권한 범위:
 *   member    본인만
 *   manager   본인 + 자기 팀(하위 팀 포함)
 *   hr        전사
 *   executive 개인 상세 불가 — 집계만
 */

export type Role = "member" | "manager" | "hr" | "executive";

export type Viewer = {
  id: string;
  orgId: string;
  name: string;
  role: Role;
  teamId: string | null;
  teamName: string | null;
};

export class AccessDenied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDenied";
  }
}

export async function listUsers(): Promise<(Viewer & { employeeNo: string })[]> {
  return db
    .select({
      id: users.id,
      orgId: users.orgId,
      name: users.name,
      role: users.role,
      teamId: users.teamId,
      teamName: teams.name,
      employeeNo: users.employeeNo,
    })
    .from(users)
    .leftJoin(teams, eq(users.teamId, teams.id))
    .orderBy(asc(users.employeeNo));
}

/**
 * ⚠ 검증 스크립트 전용. 비밀번호 없이 사번만으로 Viewer 를 만든다.
 *
 * 앱 코드는 절대 쓰지 말 것 — 인증 우회가 된다. 화면은 app/viewer.ts 의
 * requestViewer() 를 쓰고, 그건 세션 쿠키를 검증한다.
 * 실수로 배포되는 걸 막기 위해 프로덕션에서는 던진다.
 */
export async function currentViewer(employeeNo?: string): Promise<Viewer> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "currentViewer 는 검증 스크립트 전용입니다. 앱에서는 requestViewer 를 쓰세요.",
    );
  }

  const rows = await listUsers();
  if (rows.length === 0) {
    throw new Error("사용자가 없습니다. npm run db:seed 를 먼저 실행하세요.");
  }

  const wanted = employeeNo ?? process.env.DEMO_USER;
  const found = wanted
    ? rows.find((r) => r.employeeNo === wanted)
    : rows.find((r) => r.role === "member");

  return found ?? rows[0];
}

export type OrgRules = {
  orgId: string;
  orgName: string;
  settlementKind: "week" | "month";
  weekStartDay: number;
  closeGraceDays: number;
  accessLogRetentionDays: number;
  reviewThresholdMinutes: number;
  attendance: AttendanceRules;
  settlement: SettlementRules;
};

export async function loadOrgRules(orgId: string): Promise<OrgRules> {
  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
  if (!org) throw new Error(`org를 찾을 수 없습니다: ${orgId}`);

  const holidayRows = await db
    .select({ date: holidays.date })
    .from(holidays)
    .where(eq(holidays.orgId, orgId));
  const holidayDates = holidayRows.map((h) => h.date);

  const band = (start: string | null, end: string | null) =>
    start && end ? { start, end } : null;

  return {
    orgId: org.id,
    orgName: org.name,
    settlementKind: org.settlementPeriod,
    weekStartDay: org.weekStartDay,
    closeGraceDays: org.closeGraceDays,
    accessLogRetentionDays: org.accessLogRetentionDays,
    reviewThresholdMinutes: org.reviewThresholdMinutes,
    attendance: {
      timezone: org.timezone,
      dayBoundaryHour: org.dayBoundaryHour,
      breakRules: org.breakRules,
      coreTime: band(org.coreTimeStart, org.coreTimeEnd),
      flexBand: band(org.flexBandStart, org.flexBandEnd),
      nightWindow: {
        start: org.nightWindowStart,
        end: org.nightWindowEnd,
      },
      dailyLimitMinutes: org.dailyLimitMinutes,
      weekendDays: org.weekendDays,
      holidays: holidayDates,
    },
    settlement: {
      timezone: org.timezone,
      weekendDays: org.weekendDays,
      holidays: holidayDates,
      targetCalcMethod: org.targetCalcMethod,
      standardMinutesPerDay: org.standardMinutesPerDay,
      fixedTargetMinutes: org.targetMinutesPerPeriod,
      legalWeeklyMinutes: 40 * 60,
      maxAvgWeeklyMinutes: org.limitMinutesPerWeek,
      // 페이스 판정 허용 오차는 회사 정책이 아니라 표시 튜닝이라 코드에 둔다
      paceToleranceMinutes: 60,
    },
  };
}

/**
 * 팀 하위 트리 (자기 팀 포함).
 *
 * 권한 판정의 재료이므로 이 파일에만 둔다. 예전에 db/timeoff.ts 와 db/team.ts
 * 가 각자 복사해 갖고 있었는데, 그러면 조직 트리 규칙이 바뀔 때 조회 권한과
 * 승인 권한이 조용히 갈라진다.
 */
export async function teamScope(viewer: Viewer): Promise<Set<string>> {
  if (!viewer.teamId) return new Set();

  const rows = await db
    .select({ id: teams.id, parentId: teams.parentId })
    .from(teams)
    .where(eq(teams.orgId, viewer.orgId));

  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const list = children.get(row.parentId);
    if (list) list.push(row.id);
    else children.set(row.parentId, [row.id]);
  }

  const scope = new Set<string>();
  const queue = [viewer.teamId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (scope.has(id)) continue;
    scope.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return scope;
}

export async function assertCanReadDetail(
  viewer: Viewer,
  targetUserId: string,
): Promise<void> {
  if (viewer.id === targetUserId) return;

  if (viewer.role === "hr") return;

  if (viewer.role === "executive") {
    throw new AccessDenied(
      "임원 권한으로는 개인 상세 기록을 볼 수 없습니다. 집계만 조회할 수 있습니다.",
    );
  }

  if (viewer.role === "manager") {
    const [target] = await db
      .select({ orgId: users.orgId, teamId: users.teamId })
      .from(users)
      .where(eq(users.id, targetUserId));

    const scope = await teamScope(viewer);
    if (
      target &&
      target.orgId === viewer.orgId &&
      target.teamId &&
      scope.has(target.teamId)
    ) {
      return;
    }
    throw new AccessDenied("자기 팀 소속만 조회할 수 있습니다.");
  }

  throw new AccessDenied("본인 기록만 조회할 수 있습니다.");
}

/**
 * 열람 이력. 본인이 자기 기록을 보는 건 남기지 않는다 —
 * 아무도 감사하지 않는 행위이고, 남기면 로그가 그것만으로 가득 차서
 * 정작 봐야 할 타인 열람이 묻힌다.
 */
async function logAccess(
  viewer: Viewer,
  targetUserId: string,
  range: PeriodRange,
  resource: "work_days" | "adjustments" | "summary" | "export",
) {
  if (viewer.id === targetUserId) return;

  await db.insert(accessLogs).values({
    orgId: viewer.orgId,
    actorUserId: viewer.id,
    scope: "user",
    resource,
    targetUserId,
    periodStart: range.start,
    periodEnd: range.end,
  });
}

export async function loadWorkDays(
  viewer: Viewer,
  targetUserId: string,
  range: PeriodRange,
): Promise<ComputedDay[]> {
  await assertCanReadDetail(viewer, targetUserId);

  const rows = await db
    .select()
    .from(workDays)
    .where(
      and(
        eq(workDays.userId, targetUserId),
        gte(workDays.workDate, range.start),
        lte(workDays.workDate, range.end),
      ),
    )
    .orderBy(asc(workDays.workDate));

  await logAccess(viewer, targetUserId, range, "work_days");

  return rows.map((r) => ({
    workDate: r.workDate,
    firstInAt: r.firstInAt,
    lastOutAt: r.lastOutAt,
    stayMinutes: r.stayMinutes,
    breakMinutes: r.breakMinutes,
    workMinutes: r.workMinutes,
    nightMinutes: r.nightMinutes,
    isHoliday: r.isHoliday,
    flags: r.flags,
    status: r.status,
    tagCount: r.tagCount,
      sessionCount: r.sessionCount,
      openSince: r.openSince,
  }));
}

export async function loadTimeOff(
  viewer: Viewer,
  targetUserId: string,
  range: PeriodRange,
): Promise<TimeOffEntry[]> {
  await assertCanReadDetail(viewer, targetUserId);

  const rows = await db
    .select({
      date: timeOff.date,
      kind: timeOff.kind,
      deductMinutes: timeOff.deductMinutes,
    })
    .from(timeOff)
    .where(
      and(
        eq(timeOff.userId, targetUserId),
        // 승인된 것만 집계에 들어간다. 신청만으로 소정근로가 줄면
        // 본인이 자기 목표를 낮출 수 있다.
        eq(timeOff.status, "approved"),
        gte(timeOff.date, range.start),
        lte(timeOff.date, range.end),
      ),
    )
    .orderBy(asc(timeOff.date));

  return rows;
}
