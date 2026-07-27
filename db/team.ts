import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "./client";
import { accessLogs, dayAdjustments, teams, timeOff, users, workDays } from "./schema";
import { AccessDenied, loadOrgRules, type OrgRules, type Viewer } from "./access";
import { openSessionsForUsers } from "./checkin";
import { computePeriodSummary, type PeriodSummary } from "@/lib/attendance/settle";
import { resolveWorkDate } from "@/lib/attendance/compute";
import type { PeriodRange } from "@/lib/attendance/period";
import type { ComputedDay } from "@/lib/attendance/types";

/**
 * 팀장·HR이 보는 팀 현황.
 *
 * 200명 전수 확인은 불가능하다는 전제로, 사람마다 "확인 필요" 건수만 뽑아서
 * 소수만 눈에 띄게 만든다. 개인 상세는 여기서 링크로 들어간다.
 */

/**
 * 지금 근무 중인지.
 *
 * "off" 를 "퇴근"이라고 쓰지 않는다 — 아직 출근을 안 한 것과 이미 끝낸 것이
 * 자율 출근제에서는 구분되지 않고, 구분하는 척하면 감시처럼 읽힌다.
 * stale 은 어제 세션이 안 닫힌 것으로, 재실이 아니라 본인이 고쳐야 할 상태다.
 */
export type Presence =
  | { state: "working"; since: Date }
  | { state: "stale"; since: Date; workDate: string }
  | { state: "off" };

export type MemberRow = {
  userId: string;
  name: string;
  employeeNo: string;
  teamName: string | null;
  presence: Presence;
  summary: PeriodSummary;
  review: {
    incomplete: number;
    violations: number;
    exceedsLegalLimit: boolean;
    /** 보정 총합이 회사 임계값을 넘었다 */
    adjustmentMinutes: number;
    adjustmentOverThreshold: boolean;
    /** 태그가 아예 없는 날에 들어온 보정 — 값과 무관하게 항상 올린다 */
    zeroTagAdjustments: number;
    total: number;
  };
};

/** 뷰어가 개인 상세까지 볼 수 있는 사람들 */
async function visibleUserIds(
  viewer: Viewer,
  rulesOrgId: string,
): Promise<string[]> {
  if (viewer.role === "hr") {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.orgId, rulesOrgId), eq(users.active, true)));
    return rows.map((r) => r.id);
  }

  if (viewer.role !== "manager" || !viewer.teamId) {
    throw new AccessDenied("팀 현황은 팀장 이상만 볼 수 있습니다.");
  }

  // 팀 하위 트리
  const teamRows = await db
    .select({ id: teams.id, parentId: teams.parentId })
    .from(teams)
    .where(eq(teams.orgId, rulesOrgId));

  const children = new Map<string, string[]>();
  for (const t of teamRows) {
    if (!t.parentId) continue;
    const list = children.get(t.parentId);
    if (list) list.push(t.id);
    else children.set(t.parentId, [t.id]);
  }

  const scope = new Set<string>();
  const queue = [viewer.teamId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (scope.has(id)) continue;
    scope.add(id);
    queue.push(...(children.get(id) ?? []));
  }

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.orgId, rulesOrgId),
        eq(users.active, true),
        inArray(users.teamId, [...scope]),
      ),
    );
  return rows.map((r) => r.id);
}

export async function loadTeamRows(
  viewer: Viewer,
  range: PeriodRange,
  rules: OrgRules,
  asOf: Date,
): Promise<MemberRow[]> {
  const ids = await visibleUserIds(viewer, viewer.orgId);
  if (ids.length === 0) return [];

  // N+1을 피한다. 200명이면 사람마다 쿼리하면 400번이 된다.
  const [people, dayRows, offRows, adjRows, openSessions] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        employeeNo: users.employeeNo,
        teamName: teams.name,
      })
      .from(users)
      .leftJoin(teams, eq(users.teamId, teams.id))
      .where(inArray(users.id, ids))
      .orderBy(asc(users.name)),
    db
      .select()
      .from(workDays)
      .where(
        and(
          inArray(workDays.userId, ids),
          gte(workDays.workDate, range.start),
          lte(workDays.workDate, range.end),
        ),
      )
      .orderBy(asc(workDays.workDate)),
    db
      .select({
        userId: timeOff.userId,
        date: timeOff.date,
        kind: timeOff.kind,
        deductMinutes: timeOff.deductMinutes,
      })
      .from(timeOff)
      .where(
        and(
          inArray(timeOff.userId, ids),
          gte(timeOff.date, range.start),
          lte(timeOff.date, range.end),
        ),
      ),
    db
      .select({
        userId: dayAdjustments.userId,
        workDate: dayAdjustments.workDate,
        kind: dayAdjustments.kind,
        addedMinutes: dayAdjustments.addedMinutes,
        deltaMinutes: dayAdjustments.deltaMinutes,
      })
      .from(dayAdjustments)
      .where(
        and(
          inArray(dayAdjustments.userId, ids),
          gte(dayAdjustments.workDate, range.start),
          lte(dayAdjustments.workDate, range.end),
          ne(dayAdjustments.kind, "revert"),
        ),
      ),
    openSessionsForUsers(ids),
  ]);

  const today = resolveWorkDate(asOf, rules.attendance);

  const daysByUser = new Map<string, ComputedDay[]>();
  for (const r of dayRows) {
    const list = daysByUser.get(r.userId) ?? [];
    list.push({
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
    });
    daysByUser.set(r.userId, list);
  }

  const offByUser = new Map<string, typeof offRows>();
  for (const r of offRows) {
    const list = offByUser.get(r.userId) ?? [];
    list.push(r);
    offByUser.set(r.userId, list);
  }

  const rows: MemberRow[] = people.map((person) => {
    const days = daysByUser.get(person.id) ?? [];
    const summary = computePeriodSummary(
      {
        periodStart: range.start,
        periodEnd: range.end,
        days,
        timeOff: offByUser.get(person.id) ?? [],
        asOf,
      },
      rules.settlement,
    );

    const tagCountByDate = new Map(days.map((d) => [d.workDate, d.tagCount]));
    const myAdj = adjRows.filter((a) => a.userId === person.id);

    /**
     * 보정 횟수나 총합으로 세지 않는다. 그러면 사원증을 두 번 깜빡한 사람이
     * 아예 안 고친 사람보다 의심받는다 — 정직이 손해가 되는 구조다.
     * 기대값에서 벗어난 정도(deltaMinutes)만 더한다.
     */
    const adjustmentMinutes = myAdj.reduce((sum, a) => sum + a.deltaMinutes, 0);
    const adjustmentOverThreshold =
      adjustmentMinutes > rules.reviewThresholdMinutes;

    /**
     * 태그 없는 날 보정(외근)은 사실 자체로 올리지 않는다. 고객사 방문이 잦은
     * 사람이 정직하게 등록할수록 매번 의심받게 된다.
     * 정산기간 영업일의 절반을 넘길 때만 올린다.
     */
    const zeroTagDays = myAdj.filter(
      (a) => (tagCountByDate.get(a.workDate) ?? 0) === 0,
    ).length;
    const zeroTagAdjustments =
      zeroTagDays > Math.floor(summary.businessDays / 2) ? zeroTagDays : 0;

    const review = {
      incomplete: summary.incompleteDates.length,
      violations: summary.flaggedDates.length + summary.timeOffConflicts.length,
      exceedsLegalLimit: summary.exceedsAvgWeeklyLimit,
      adjustmentMinutes,
      adjustmentOverThreshold,
      zeroTagAdjustments,
      total: 0,
    };
    review.total =
      review.incomplete +
      review.violations +
      (review.exceedsLegalLimit ? 1 : 0) +
      (review.adjustmentOverThreshold ? 1 : 0) +
      review.zeroTagAdjustments;

    const open = openSessions.get(person.id);
    const presence: Presence = !open
      ? { state: "off" }
      : open.workDate >= today
        ? { state: "working", since: open.startedAt }
        : { state: "stale", since: open.startedAt, workDate: open.workDate };

    return {
      userId: person.id,
      name: person.name,
      employeeNo: person.employeeNo,
      teamName: person.teamName,
      presence,
      summary,
      review,
    };
  });

  // 팀장이 매일 볼 이유를 만든다: 확인할 게 많은 사람이 위로
  rows.sort((a, b) => b.review.total - a.review.total || a.name.localeCompare(b.name));

  await db.insert(accessLogs).values({
    orgId: viewer.orgId,
    actorUserId: viewer.id,
    scope: viewer.role === "hr" ? "org" : "team",
    resource: "summary",
    targetTeamId: viewer.role === "hr" ? null : viewer.teamId,
    periodStart: range.start,
    periodEnd: range.end,
  });

  return rows;
}
