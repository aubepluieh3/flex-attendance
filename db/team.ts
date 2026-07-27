import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db } from "./client";
import { accessLogs, dayAdjustments, teams, timeOff, users, workDays } from "./schema";
import { AccessDenied, loadOrgRules, type OrgRules, type Viewer } from "./access";
import { computePeriodSummary, type PeriodSummary } from "@/lib/attendance/settle";
import type { PeriodRange } from "@/lib/attendance/period";
import type { ComputedDay } from "@/lib/attendance/types";

/**
 * 팀장·HR이 보는 팀 현황.
 *
 * 200명 전수 확인은 불가능하다는 전제로, 사람마다 "확인 필요" 건수만 뽑아서
 * 소수만 눈에 띄게 만든다. 개인 상세는 여기서 링크로 들어간다.
 */

export type MemberRow = {
  userId: string;
  name: string;
  employeeNo: string;
  teamName: string | null;
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
  const [people, dayRows, offRows, adjRows] = await Promise.all([
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
        overrideFirstInAt: dayAdjustments.overrideFirstInAt,
        overrideLastOutAt: dayAdjustments.overrideLastOutAt,
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
  ]);

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

    // 시각을 덮어쓴 보정은 "얼마"를 세기 어려우므로 건당 소정근로 1일로 본다.
    // 정확한 값보다 "이 사람 보정이 과한가"를 판단하는 게 목적이다.
    const adjustmentMinutes = myAdj.reduce(
      (sum, a) =>
        sum +
        a.addedMinutes +
        (a.overrideFirstInAt || a.overrideLastOutAt
          ? rules.settlement.standardMinutesPerDay
          : 0),
      0,
    );
    const zeroTagAdjustments = myAdj.filter(
      (a) => (tagCountByDate.get(a.workDate) ?? 0) === 0,
    ).length;
    const adjustmentOverThreshold =
      adjustmentMinutes > rules.reviewThresholdMinutes;

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

    return {
      userId: person.id,
      name: person.name,
      employeeNo: person.employeeNo,
      teamName: person.teamName,
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
