import { and, asc, desc, eq, gte, lt, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./client";
import {
  accessLogs,
  periodCloseEvents,
  periodSnapshots,
  settlementPeriods,
  timeOff,
  users,
  workDays,
} from "./schema";
import { AccessDenied, loadOrgRules, type OrgRules, type Viewer } from "./access";
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
import { now } from "@/lib/clock";

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
  /** 트랜잭션 안에서 부르면 같은 트랜잭션으로 읽는다 */
  executor: Pick<typeof db, "select"> = db,
) {
  const dayRows = await executor
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

  const offRows = await executor
    .select({
      date: timeOff.date,
      kind: timeOff.kind,
      deductMinutes: timeOff.deductMinutes,
    })
    .from(timeOff)
    .where(
      and(
        eq(timeOff.userId, userId),
        eq(timeOff.status, "approved"),
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
      sessionCount: r.sessionCount,
      openSince: r.openSince,
  }));

  /*
   * 재직기간. 스냅샷은 사람별이므로(userId 단위) 조직 마감 구간과 어긋나지
   * 않는다 — 7/20 입사자의 7월 스냅샷에는 7/20~7/31 값이 얼린다.
   * 안 넘기면 마감된 값이 소정근로·법정초과에서 틀린 채로 동결된다.
   */
  const [person] = await executor
    .select({ hiredAt: users.hiredAt, resignedAt: users.resignedAt })
    .from(users)
    .where(eq(users.id, userId));

  return computePeriodSummary(
    {
      periodStart: range.start,
      periodEnd: range.end,
      days,
      timeOff: offRows,
      asOf,
      employment: {
        hiredAt: person?.hiredAt ?? null,
        resignedAt: person?.resignedAt ?? null,
      },
    },
    rules.settlement,
  );
}

/** 정산기간 행이 없으면 만든다. 없는 기간은 마감 대상도 될 수 없다. */
export async function ensurePeriod(
  orgId: string,
  range: PeriodRange,
): Promise<{
  id: string;
  status: "open" | "closed";
  closedAt: Date | null;
  reopenedAt: Date | null;
}> {
  const [existing] = await db
    .select({
      id: settlementPeriods.id,
      status: settlementPeriods.status,
      closedAt: settlementPeriods.closedAt,
      reopenedAt: settlementPeriods.reopenedAt,
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
      reopenedAt: settlementPeriods.reopenedAt,
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

      // 재마감 직후에는 유예일이 다시 흐른다. 안 그러면 HR이 고칠 틈도 없이
      // 배치가 즉시 다시 마감해버린다.
      const reopenGraceLeft =
        period.reopenedAt !== null &&
        DateTime.fromJSDate(period.reopenedAt, { zone })
          .plus({ days: rules.closeGraceDays })
          .toJSDate() > asOf;

      if (period.status === "open" && !reopenGraceLeft) {
        /**
         * 마감을 원자적으로 선점한다.
         *
         * status 를 읽고 나서 업데이트하면 그 사이에 다른 실행이 끼어들어
         * 같은 기간이 여러 번 마감된다 — 스냅샷과 마감 이력이 배수로 쌓인다.
         * UPDATE ... WHERE status='open' 이 행을 잠그므로, 트랜잭션 안에서
         * 이걸 먼저 하면 한 쪽만 통과한다.
         */
        const count = await db.transaction(async (tx) => {
          const claimed = await tx
            .update(settlementPeriods)
            .set({ status: "closed", closedAt: asOf })
            .where(
              and(
                eq(settlementPeriods.id, period.id),
                eq(settlementPeriods.status, "open"),
              ),
            )
            .returning({ id: settlementPeriods.id });

          // 다른 실행이 먼저 마감했다
          if (claimed.length === 0) return null;

          let n = 0;
          for (const member of members) {
            const summary = await summaryFor(member.id, range, rules, asOf, tx);
            await tx.insert(periodSnapshots).values({
              orgId,
              periodId: period.id,
              userId: member.id,
              ...snapshotOf(summary),
            });
            n += 1;
          }

          // 자동 마감이므로 actorUserId는 없다
          await tx.insert(periodCloseEvents).values({
            periodId: period.id,
            action: "close",
            reason: `유예 ${rules.closeGraceDays}일 경과 후 자동 마감`,
          });

          return n;
        });

        if (count !== null) {
          results.push({
            periodStart: range.start,
            periodEnd: range.end,
            snapshots: count,
          });
        }
      }
    }

    // 다음 기간으로
    cursor = DateTime.fromISO(range.end, { zone }).plus({ days: 1 });
  }

  /*
   * 보존 기간이 지난 열람 이력을 여기서 지운다.
   *
   * 별도 배치를 만들지 않는 이유: 마감은 이미 주 1회 돌고, "확정된 기간의
   * 오래된 열람 로그를 정리한다"는 게 의미상 자연스럽게 붙는다. 방아쇠를
   * 늘리면 "안 돌면 조용히 실패하는 것"이 하나 더 생긴다.
   *
   * 근태 열람 기록은 개인정보다. 파기 정책 없이 무한 보관하면 안 된다.
   */
  const cutoff = DateTime.fromJSDate(asOf, { zone })
    .minus({ days: rules.accessLogRetentionDays })
    .toJSDate();
  const purged = await db
    .delete(accessLogs)
    .where(and(eq(accessLogs.orgId, orgId), lt(accessLogs.createdAt, cutoff)))
    .returning({ id: accessLogs.id });
  if (purged.length > 0) {
    console.log(
      `열람 이력 ${purged.length}건 파기 (보존 ${rules.accessLogRetentionDays}일)`,
    );
  }

  return results;
}

/**
 * 마감 방아쇠.
 *
 * cron 없이도 돌게 한다. 마감이 늦어도 그사이 데이터가 안 바뀌었으면 스냅샷
 * 결과가 같으므로, 데이터를 바꾸는 순간 앞에서 닫으면 cron 과 결과가 같다.
 *   임포트  → 늦게 온 파일이 확정된 과거를 덮어쓰는 것을 막는 것이 마감의 목적
 *   보정·휴가·근무 → 고치려면 앱을 열어야 하므로 그 앞에서 닫힌다
 *
 * cron 을 나중에 얹어도 이게 남아 있는 게 낫다. 스케줄러가 조용히 멈추는 게
 * 가장 흔한 실패인데, 그때 앱이 스스로 복구한다.
 *
 * 문턱: 마감은 무거운 쓰기다(사람마다 스냅샷). 유예가 3일 단위이므로 몇 분
 * 늦는 것은 결과에 영향이 없다. 임포트는 force 로 문턱을 건너뛴다.
 */
const CLOSE_THROTTLE_MS = 5 * 60_000;
const lastCloseRunAt = new Map<string, number>();

export async function closeDueIfStale(
  orgId: string,
  asOf: Date,
  opts: { force?: boolean } = {},
): Promise<CloseResult[]> {
  if (!opts.force) {
    const prev = lastCloseRunAt.get(orgId);
    if (prev !== undefined && asOf.getTime() - prev < CLOSE_THROTTLE_MS) {
      return [];
    }
  }
  lastCloseRunAt.set(orgId, asOf.getTime());
  try {
    return await closeDuePeriods(orgId, asOf);
  } catch (e) {
    // 실패했으면 문턱을 풀어 다음 요청이 다시 시도하게 둔다
    lastCloseRunAt.delete(orgId);
    throw e;
  }
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
      reopenedAt: settlementPeriods.reopenedAt,
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

  // 재마감 후 다시 마감하면 스냅샷이 쌓인다. 공식 기록은 가장 최근 것.
  const [row] = await db
    .select()
    .from(periodSnapshots)
    .where(
      and(
        eq(periodSnapshots.periodId, period.id),
        eq(periodSnapshots.userId, userId),
      ),
    )
    .orderBy(desc(periodSnapshots.capturedAt))
    .limit(1);

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

export type PeriodRow = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: "open" | "closed";
  closedAt: Date | null;
  reopenedAt: Date | null;
  snapshotCount: number;
  events: {
    action: "close" | "reopen";
    reason: string | null;
    actorName: string | null;
    createdAt: Date;
  }[];
};

/** 정산기간 목록 (HR 관리 화면용) */
export async function listPeriods(orgId: string): Promise<PeriodRow[]> {
  const periods = await db
    .select()
    .from(settlementPeriods)
    .where(eq(settlementPeriods.orgId, orgId))
    .orderBy(desc(settlementPeriods.periodStart));

  const rows: PeriodRow[] = [];
  for (const p of periods) {
    const snaps = await db
      .select({ id: periodSnapshots.id })
      .from(periodSnapshots)
      .where(eq(periodSnapshots.periodId, p.id));

    const events = await db
      .select({
        action: periodCloseEvents.action,
        reason: periodCloseEvents.reason,
        actorName: users.name,
        createdAt: periodCloseEvents.createdAt,
      })
      .from(periodCloseEvents)
      .leftJoin(users, eq(periodCloseEvents.actorUserId, users.id))
      .where(eq(periodCloseEvents.periodId, p.id))
      .orderBy(desc(periodCloseEvents.createdAt));

    rows.push({
      id: p.id,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      status: p.status,
      closedAt: p.closedAt,
      reopenedAt: p.reopenedAt,
      snapshotCount: snaps.length,
      events,
    });
  }
  return rows;
}

/**
 * 재마감. 화면이 "HR에 재마감을 요청하세요"라고 안내하니 실제로 할 수 있어야 한다.
 *
 * 스냅샷은 지우지 않는다 — 그 시점에 무엇이 공식 기록이었는지가 감사 대상이다.
 * 다시 마감되면 새 스냅샷이 쌓이고 최신 것이 공식 기록이 된다.
 */
export async function reopenPeriod(
  viewer: Viewer,
  periodId: string,
  reason: string,
): Promise<void> {
  if (viewer.role !== "hr") {
    throw new AccessDenied("재마감은 HR 권한이 필요합니다.");
  }
  const text = reason.trim();
  if (!text) {
    throw new Error("재마감 사유를 적어 주세요. 확정된 기록을 되돌리는 일입니다.");
  }

  const [period] = await db
    .select({ id: settlementPeriods.id, status: settlementPeriods.status })
    .from(settlementPeriods)
    .where(
      and(
        eq(settlementPeriods.id, periodId),
        eq(settlementPeriods.orgId, viewer.orgId),
      ),
    );
  if (!period) throw new Error("정산기간을 찾을 수 없습니다.");
  if (period.status === "open") throw new Error("이미 열려 있는 기간입니다.");

  // lib/clock 의 now()를 쓴다. new Date()를 쓰면 앱 안에 시계가 두 개가 되어
  // FLEX_CLOCK 이나 테스트 기준 시각과 어긋난다.
  await db
    .update(settlementPeriods)
    .set({ status: "open", closedAt: null, reopenedAt: now() })
    .where(eq(settlementPeriods.id, periodId));

  await db.insert(periodCloseEvents).values({
    periodId,
    action: "reopen",
    actorUserId: viewer.id,
    reason: text,
  });
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

/**
 * 그 날짜가 속한 정산기간이 열려 있는지 확인하고, 닫혀 있으면 던진다.
 *
 * 예전에는 adjust·checkin·timeoff·settings 가 각자 같은 검사를 갖고 있었다.
 * 이름이 assertPeriodOpen / assertOpenPeriod 로 갈리고 문구가 넷 다 달랐다.
 * 유예 규칙이나 문구를 바꿀 때 네 곳을 찾아야 했다.
 *
 * @param action "보정할" 처럼 무엇을 못 하는지. 메시지에 그대로 들어간다.
 */
export async function assertPeriodOpen(
  orgId: string,
  date: string,
  rules: OrgRules,
  action: string,
): Promise<void> {
  const range = resolvePeriod(date, {
    kind: rules.settlementKind,
    weekStartDay: rules.weekStartDay,
    timezone: rules.attendance.timezone,
  });
  if (await isPeriodClosed(orgId, range)) {
    throw new AccessDenied(
      `${range.start} ~ ${range.end} 정산기간은 마감되어 ${action} 수 없습니다. 고쳐야 할 게 있으면 HR에 재마감을 요청하세요.`,
    );
  }
}
