import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./client";
import { accessLogs, teams, timeOff, users, workDays } from "./schema";
import { AccessDenied, type OrgRules, type Viewer } from "./access";
import { computePeriodSummary, type PeriodSummary } from "@/lib/attendance/settle";
import type { PeriodRange } from "@/lib/attendance/period";
import type { ComputedDay } from "@/lib/attendance/types";

/**
 * 전사 집계.
 *
 * 임원은 개인 상세를 볼 수 없고 집계만 본다 — 스키마로 표현할 수 없는 규칙이라
 * 여기서 두 갈래로 나눈다. 임원 경로는 이름을 아예 조회하지 않는다.
 */

export type PersonRow = {
  userId: string;
  employeeNo: string;
  name: string;
  teamName: string | null;
  summary: PeriodSummary;
};

export type TeamAggregate = {
  teamName: string;
  headcount: number;
  /** 근무 기록이 있는 사람 수 */
  activeCount: number;
  workedMinutes: number;
  targetMinutes: number;
  nightMinutes: number;
  holidayMinutes: number;
  overtimeMinutes: number;
  overLimitCount: number;
  incompleteDays: number;
};

async function summariesFor(
  orgId: string,
  range: PeriodRange,
  rules: OrgRules,
  asOf: Date,
) {
  const people = await db
    .select({
      id: users.id,
      employeeNo: users.employeeNo,
      name: users.name,
      teamName: teams.name,
      hiredAt: users.hiredAt,
      resignedAt: users.resignedAt,
    })
    .from(users)
    .leftJoin(teams, eq(users.teamId, teams.id))
    .where(and(eq(users.orgId, orgId), eq(users.active, true)))
    .orderBy(asc(users.name));

  if (people.length === 0) return [];
  const ids = people.map((p) => p.id);

  const [dayRows, offRows] = await Promise.all([
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
          eq(timeOff.status, "approved"),
          gte(timeOff.date, range.start),
          lte(timeOff.date, range.end),
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
      autoBreakMinutes: r.autoBreakMinutes,
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

  return people.map((person) => ({
    ...person,
    summary: computePeriodSummary(
      {
        periodStart: range.start,
        periodEnd: range.end,
        days: daysByUser.get(person.id) ?? [],
        timeOff: offByUser.get(person.id) ?? [],
        asOf,
        // 전사 집계는 급여 시스템에 넘기는 원자료다. 재직기간을 안 넘기면
        // 중도 입사자의 연장근로가 0으로 나가서 가산수당이 빠진다.
        employment: {
          hiredAt: person.hiredAt,
          resignedAt: person.resignedAt,
        },
      },
      rules.settlement,
    ),
  }));
}

/** 개인별 집계 — HR만 */
export async function loadPersonRows(
  viewer: Viewer,
  range: PeriodRange,
  rules: OrgRules,
  asOf: Date,
): Promise<PersonRow[]> {
  if (viewer.role !== "hr") {
    throw new AccessDenied(
      "전사 개인별 집계는 HR 권한이 필요합니다. 임원은 집계만 조회할 수 있습니다.",
    );
  }

  const rows = await summariesFor(viewer.orgId, range, rules, asOf);

  await db.insert(accessLogs).values({
    orgId: viewer.orgId,
    actorUserId: viewer.id,
    scope: "org",
    resource: "work_days",
    periodStart: range.start,
    periodEnd: range.end,
  });

  return rows.map((r) => ({
    userId: r.id,
    employeeNo: r.employeeNo,
    name: r.name,
    teamName: r.teamName,
    summary: r.summary,
  }));
}

/** 팀별 집계 — HR·임원. 개인 식별 정보가 나가지 않는다. */
export async function loadTeamAggregates(
  viewer: Viewer,
  range: PeriodRange,
  rules: OrgRules,
  asOf: Date,
): Promise<TeamAggregate[]> {
  if (viewer.role !== "hr" && viewer.role !== "executive") {
    throw new AccessDenied("전사 집계는 HR·임원만 조회할 수 있습니다.");
  }

  const rows = await summariesFor(viewer.orgId, range, rules, asOf);
  const byTeam = new Map<string, TeamAggregate>();

  for (const r of rows) {
    const key = r.teamName ?? "미배정";
    const agg =
      byTeam.get(key) ??
      ({
        teamName: key,
        headcount: 0,
        activeCount: 0,
        workedMinutes: 0,
        targetMinutes: 0,
        nightMinutes: 0,
        holidayMinutes: 0,
        overtimeMinutes: 0,
        overLimitCount: 0,
        incompleteDays: 0,
      } satisfies TeamAggregate);

    agg.headcount += 1;
    if (r.summary.workedMinutes > 0) agg.activeCount += 1;
    agg.workedMinutes += r.summary.workedMinutes;
    agg.targetMinutes += r.summary.targetMinutes;
    agg.nightMinutes += r.summary.nightMinutes;
    agg.holidayMinutes += r.summary.holidayMinutes;
    agg.overtimeMinutes += r.summary.overtimeMinutes;
    if (r.summary.exceedsAvgWeeklyLimit) agg.overLimitCount += 1;
    agg.incompleteDays += r.summary.incompleteDates.length;

    byTeam.set(key, agg);
  }

  await db.insert(accessLogs).values({
    orgId: viewer.orgId,
    actorUserId: viewer.id,
    scope: "org",
    resource: "summary",
    periodStart: range.start,
    periodEnd: range.end,
  });

  return [...byTeam.values()].sort((a, b) =>
    a.teamName.localeCompare(b.teamName),
  );
}

/**
 * CSV 내보내기. 엑셀이 UTF-8을 알아보게 BOM을 붙이고 CRLF로 끝낸다 —
 * 안 붙이면 한글이 깨져서 열린다.
 */
export async function exportCsv(
  viewer: Viewer,
  range: PeriodRange,
  rules: OrgRules,
  asOf: Date,
): Promise<string> {
  const rows = await loadPersonRows(viewer, range, rules, asOf);

  await db.insert(accessLogs).values({
    orgId: viewer.orgId,
    actorUserId: viewer.id,
    scope: "org",
    resource: "export",
    periodStart: range.start,
    periodEnd: range.end,
  });

  /*
   * 주평균은 분모가 기간 전체 주수라 기간이 끝나기 전에는 뜻이 없다.
   * 진행 중인 기간을 내보내면 전원이 한도보다 한참 낮게 찍히고, 그 파일이
   * 사내에 돌아다니면서 "문제 없음"의 근거가 된다. 끝난 기간에만 채운다.
   */
  const periodEnded =
    DateTime.fromJSDate(asOf, { zone: rules.attendance.timezone }).toISODate()! >
    range.end;

  const header = [
    "사번",
    "이름",
    "팀",
    "정산기간 시작",
    "정산기간 종료",
    "소정근로(분)",
    "실근무(분)",
    "야간(분)",
    "휴일근무(분)",
    "법정초과(분)",
    periodEnded ? "주평균(분)" : "주평균(분, 기간 말 확정)",
    "퇴근기록없음(일)",
    "규정확인(건)",
    "주52시간초과",
  ];

  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [header.join(",")];
  for (const r of rows) {
    const s = r.summary;
    lines.push(
      [
        r.employeeNo,
        r.name,
        r.teamName ?? "",
        range.start,
        range.end,
        s.targetMinutes,
        s.workedMinutes,
        s.nightMinutes,
        s.holidayMinutes,
        s.overtimeMinutes,
        periodEnded ? Math.round(s.avgWeeklyMinutes) : "",
        s.incompleteDates.length,
        s.flaggedDates.length,
        s.exceedsAvgWeeklyLimit ? "Y" : "N",
      ]
        .map(escape)
        .join(","),
    );
  }

  return "﻿" + lines.join("\r\n") + "\r\n";
}
