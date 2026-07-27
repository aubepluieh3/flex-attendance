import { and, asc, eq, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./client";
import {
  periodCloseEvents,
  periodSnapshots,
  settlementPeriods,
  timeOff,
  users,
  workDays,
} from "./schema";
import { loadOrgRules, type OrgRules } from "./access";
import { resolvePeriod, type PeriodRange } from "@/lib/attendance/period";
import {
  computePeriodSummary,
  diffAgainstSnapshot,
  isClosable,
  snapshotOf,
  type PeriodSnapshot,
  type SnapshotDiff,
} from "@/lib/attendance/settle";
import type { ComputedDay } from "@/lib/attendance/types";

/**
 * 정산기간 마감.
 *
 * 마감이 없으면 지난 기간 CSV를 다시 올릴 때 확정된 과거 근무시간이 조용히
 * 바뀐다. 계산은 만들어뒀지만 호출하는 곳이 없어서 효과가 0이었다.
 *
 * 배치로 돈다: npm run db:close-periods [YYYY-MM-DD]
 */

/** 기간 안의 한 사람 집계를 시스템 권한으로 읽는다 (배치용, 열람 로그 대상 아님) */
async function summaryFor(
  userId: string,
  range: PeriodRange,
  rules: OrgRules,
  asOf: Date,
) {
  const dayRows = await db
    .select()
    .from(workDays)
    .where(
      and(
        eq(workDays.userId, userId),
        gte(workDays.workDate, range.start),
        lte(workDays.workDate, range.end),
      ),
    )
    .orderBy(asc(workDays.workDate));

  const offRows = await db
    .select({
      date: timeOff.date,
      kind: timeOff.kind,
      deductMinutes: timeOff.deductMinutes,
    })
    .from(timeOff)
    .where(
      and(
        eq(timeOff.userId, userId),
        gte(timeOff.date, range.start),
        lte(timeOff.date, range.end),
      ),
    );

  const days: ComputedDay[] = dayRows.map((r) => ({
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
  }));

  return computePeriodSummary(
    {
      periodStart: range.start,
      periodEnd: range.end,
      days,
      timeOff: offRows,
      asOf,
    },
    rules.settlement,
  );
}

/** 정산기간 행이 없으면 만든다. 없는 기간은 마감 대상도 될 수 없다. */
export async function ensurePeriod(
  orgId: string,
  range: PeriodRange,
): Promise<{ id: string; status: "open" | "closed"; closedAt: Date | null }> {
  const [existing] = await db
    .select({
      id: settlementPeriods.id,
      status: settlementPeriods.status,
      closedAt: settlementPeriods.closedAt,
    })
    .from(settlementPeriods)
    .where(
      and(
        eq(settlementPeriods.orgId, orgId),
        eq(settlementPeriods.periodStart, range.start),
      ),
    );
  if (existing) return existing;

  const [created] = await db
    .insert(settlementPeriods)
    .values({
      orgId,
      periodStart: range.start,
      periodEnd: range.end,
      status: "open",
    })
    .onConflictDoNothing()
    .returning({
      id: settlementPeriods.id,
      status: settlementPeriods.status,
      closedAt: settlementPeriods.closedAt,
    });

  if (created) return created;
  // 동시 실행으로 다른 쪽이 먼저 넣었으면 다시 읽는다
  return ensurePeriod(orgId, range);
}

export type CloseResult = {
  periodStart: string;
  periodEnd: string;
  snapshots: number;
};

/**
 * 유예기간이 지난 열린 기간을 모두 마감한다.
 * 마감 시점 집계를 사람별 스냅샷으로 얼려서, 나중에 규칙이 바뀌어도
 * 확정된 과거 숫자가 흔들리지 않게 한다.
 */
export async function closeDuePeriods(
  orgId: string,
  asOf: Date,
): Promise<CloseResult[]> {
  const rules = await loadOrgRules(orgId);
  const zone = rules.attendance.timezone;

  // 데이터가 있는 가장 이른 날부터 현재까지의 기간을 훑는다
  const [earliest] = await db
    .select({ workDate: workDays.workDate })
    .from(workDays)
    .where(eq(workDays.orgId, orgId))
    .orderBy(asc(workDays.workDate))
    .limit(1);
  if (!earliest) return [];

  const members = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.active, true)));

  const results: CloseResult[] = [];
  let cursor = DateTime.fromISO(earliest.workDate, { zone });
  const stop = DateTime.fromJSDate(asOf, { zone });

  while (cursor <= stop) {
    const range = resolvePeriod(cursor.toISODate()!, {
      kind: rules.settlementKind,
      weekStartDay: rules.weekStartDay,
      timezone: zone,
    });

    if (isClosable(range.end, rules.closeGraceDays, asOf, zone)) {
      const period = await ensurePeriod(orgId, range);
      if (period.status === "open") {
        let count = 0;
        for (const member of members) {
          const summary = await summaryFor(member.id, range, rules, asOf);
          const snap = snapshotOf(summary);
          await db
            .insert(periodSnapshots)
            .values({
              orgId,
              periodId: period.id,
              userId: member.id,
              ...snap,
            })
            .onConflictDoNothing();
          count += 1;
        }

        await db
          .update(settlementPeriods)
          .set({ status: "closed", closedAt: asOf })
          .where(eq(settlementPeriods.id, period.id));

        // 자동 마감이므로 actorUserId는 없다
        await db.insert(periodCloseEvents).values({
          periodId: period.id,
          action: "close",
          reason: `유예 ${rules.closeGraceDays}일 경과 후 자동 마감`,
        });

        results.push({
          periodStart: range.start,
          periodEnd: range.end,
          snapshots: count,
        });
      }
    }

    // 다음 기간으로
    cursor = DateTime.fromISO(range.end, { zone }).plus({ days: 1 });
  }

  return results;
}

export type PeriodState = {
  status: "open" | "closed";
  closedAt: Date | null;
  /** 마감된 기간의 공식 기록 */
  snapshot: PeriodSnapshot | null;
  /** 마감 후 값이 바뀌었는지 (늦게 온 태그, 설정 변경) */
  diff: SnapshotDiff | null;
};

/**
 * 화면에서 쓰는 마감 상태. 마감된 기간은 스냅샷이 공식 기록이고,
 * 현재 재계산값과 다르면 "마감 후 변경"으로 드러낸다.
 */
export async function loadPeriodState(
  orgId: string,
  userId: string,
  range: PeriodRange,
  current: ReturnType<typeof computePeriodSummary>,
): Promise<PeriodState> {
  const [period] = await db
    .select({
      id: settlementPeriods.id,
      status: settlementPeriods.status,
      closedAt: settlementPeriods.closedAt,
    })
    .from(settlementPeriods)
    .where(
      and(
        eq(settlementPeriods.orgId, orgId),
        eq(settlementPeriods.periodStart, range.start),
      ),
    );

  if (!period || period.status === "open") {
    return { status: "open", closedAt: null, snapshot: null, diff: null };
  }

  const [row] = await db
    .select()
    .from(periodSnapshots)
    .where(
      and(
        eq(periodSnapshots.periodId, period.id),
        eq(periodSnapshots.userId, userId),
      ),
    );

  if (!row) {
    return {
      status: "closed",
      closedAt: period.closedAt,
      snapshot: null,
      diff: null,
    };
  }

  const snapshot: PeriodSnapshot = {
    targetMinutes: row.targetMinutes,
    workedMinutes: row.workedMinutes,
    nightMinutes: row.nightMinutes,
    holidayMinutes: row.holidayMinutes,
    overtimeMinutes: row.overtimeMinutes,
    avgWeeklyMinutes: row.avgWeeklyMinutes,
  };

  return {
    status: "closed",
    closedAt: period.closedAt,
    snapshot,
    diff: diffAgainstSnapshot(snapshot, current),
  };
}

/** 마감된 기간인지 (보정 차단용) */
export async function isPeriodClosed(
  orgId: string,
  range: PeriodRange,
): Promise<boolean> {
  const [period] = await db
    .select({ status: settlementPeriods.status })
    .from(settlementPeriods)
    .where(
      and(
        eq(settlementPeriods.orgId, orgId),
        eq(settlementPeriods.periodStart, range.start),
      ),
    );
  return period?.status === "closed";
}
