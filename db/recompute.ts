import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./client";
import { attendanceLogs, dayAdjustments, workDays } from "./schema";
import { applyAdjustment, computeWorkDays } from "@/lib/attendance/compute";
import type {
  AdjustmentInput,
  AttendanceRules,
  ComputedDay,
} from "@/lib/attendance/types";

/**
 * 원본 태그 → work_days 재계산.
 *
 * work_days는 파생 데이터라서 언제든 지우고 다시 만들 수 있다. 규칙이 바뀌면
 * 이 함수를 다시 돌리면 된다 — 그래서 계산 로직은 DB를 모르는 순수 함수로 두고,
 * DB를 만지는 건 이 파일에만 있다.
 */
export async function recomputeWorkDays(opts: {
  orgId: string;
  userId: string;
  /** YYYY-MM-DD */
  from: string;
  to: string;
  rules: AttendanceRules;
}): Promise<ComputedDay[]> {
  const { orgId, userId, from, to, rules } = opts;
  const zone = rules.timezone;

  // 귀속 기준시각(기본 05:00) 때문에 경계 밖 태그가 범위 안 날짜로 들어올 수 있다.
  // 넉넉히 읽고 계산 후에 자른다.
  const queryFrom = DateTime.fromISO(from, { zone })
    .minus({ days: 1 })
    .toJSDate();
  const queryTo = DateTime.fromISO(to, { zone })
    .plus({ days: 2 })
    .toJSDate();

  const logs = await db
    .select({
      occurredAt: attendanceLogs.occurredAt,
      direction: attendanceLogs.direction,
      deviceLabel: attendanceLogs.deviceLabel,
    })
    .from(attendanceLogs)
    .where(
      and(
        eq(attendanceLogs.userId, userId),
        gte(attendanceLogs.occurredAt, queryFrom),
        lte(attendanceLogs.occurredAt, queryTo),
      ),
    )
    .orderBy(asc(attendanceLogs.occurredAt));

  const computed = computeWorkDays(logs, rules).filter(
    (d) => d.workDate >= from && d.workDate <= to,
  );

  // 보정은 append-only로 쌓인다. (userId, workDate)별 가장 최근 1건만 적용한다.
  const adjustments = await db
    .select()
    .from(dayAdjustments)
    .where(
      and(
        eq(dayAdjustments.userId, userId),
        gte(dayAdjustments.workDate, from),
        lte(dayAdjustments.workDate, to),
      ),
    )
    .orderBy(desc(dayAdjustments.createdAt));

  const latestByDate = new Map<string, AdjustmentInput>();
  for (const row of adjustments) {
    if (latestByDate.has(row.workDate)) continue;
    latestByDate.set(row.workDate, {
      workDate: row.workDate,
      kind: row.kind,
      overrideFirstInAt: row.overrideFirstInAt,
      overrideLastOutAt: row.overrideLastOutAt,
      addedMinutes: row.addedMinutes,
    });
  }

  const byDate = new Map(computed.map((d) => [d.workDate, d]));
  // 태그가 없는 날에도 보정(외근·출장)만으로 근무 기록이 생길 수 있다
  for (const [date, adj] of latestByDate) {
    byDate.set(date, applyAdjustment(byDate.get(date) ?? null, adj, rules));
  }

  const result = [...byDate.values()].sort((a, b) =>
    a.workDate.localeCompare(b.workDate),
  );

  await db.transaction(async (tx) => {
    /**
     * 같은 사람에 대한 재계산을 직렬화한다.
     *
     * DELETE 후 INSERT 하는 구조라서, 같은 날 보정이 동시에 들어오면 양쪽이
     * 모두 지우고 모두 넣어 (user, work_date) 유니크 제약을 위반한다.
     * Postgres 에러가 사용자 화면에 그대로 나가므로 트랜잭션 잠금으로 막는다.
     */
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    await tx
      .delete(workDays)
      .where(
        and(
          eq(workDays.userId, userId),
          gte(workDays.workDate, from),
          lte(workDays.workDate, to),
        ),
      );

    if (result.length === 0) return;

    await tx.insert(workDays).values(
      result.map((d) => ({
        orgId,
        userId,
        workDate: d.workDate,
        firstInAt: d.firstInAt,
        lastOutAt: d.lastOutAt,
        stayMinutes: d.stayMinutes,
        breakMinutes: d.breakMinutes,
        workMinutes: d.workMinutes,
        nightMinutes: d.nightMinutes,
        isHoliday: d.isHoliday,
        flags: d.flags,
        status: d.status,
        tagCount: d.tagCount,
      })),
    );
  });

  return result;
}
