import { and, asc, desc, eq, gte, lt, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./client";
import { attendanceLogs, workDays } from "./schema";
import type { OrgRules } from "./access";
import { computeWorkDays } from "@/lib/attendance/compute";
import { estimateCheckout, type Estimate } from "@/lib/attendance/estimate";
import type { ComputedDay } from "@/lib/attendance/types";

/**
 * 보정의 "기대값".
 *
 * 검토를 보정 횟수로 하면 정직하게 고친 사람이 의심받는다. 기대값에서 벗어난
 * 정도로 판단하려면 그 기대값이 무엇인지 한 곳에서 정해야 한다.
 *
 *   태그가 정상이던 날  → 원본 계산값
 *   퇴근이 빠진 날      → 그 사람 평소 패턴 추정치
 *   태그가 아예 없는 날 → 1일 소정근로 (평범한 8시간 외근은 벗어남 0)
 */

/** 그 날 태그만으로 계산한 하루 (보정 반영 안 함) */
async function rawDay(
  userId: string,
  workDate: string,
  rules: OrgRules,
): Promise<ComputedDay | null> {
  const zone = rules.attendance.timezone;
  const from = DateTime.fromISO(workDate, { zone }).minus({ days: 1 }).toJSDate();
  const to = DateTime.fromISO(workDate, { zone }).plus({ days: 2 }).toJSDate();

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
        gte(attendanceLogs.occurredAt, from),
        lte(attendanceLogs.occurredAt, to),
      ),
    )
    .orderBy(asc(attendanceLogs.occurredAt));

  return (
    computeWorkDays(logs, rules.attendance).find((d) => d.workDate === workDate) ??
    null
  );
}

/** 추정에 쓸 최근 완료된 날들 */
async function recentCompleted(
  userId: string,
  before: string,
  rules: OrgRules,
): Promise<ComputedDay[]> {
  const zone = rules.attendance.timezone;
  const from = DateTime.fromISO(before, { zone })
    .minus({ days: 45 })
    .toISODate()!;

  const rows = await db
    .select()
    .from(workDays)
    .where(
      and(
        eq(workDays.userId, userId),
        eq(workDays.status, "computed"),
        gte(workDays.workDate, from),
        lt(workDays.workDate, before),
      ),
    )
    .orderBy(desc(workDays.workDate))
    .limit(10);

  return rows.reverse().map((r) => ({
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
}

/** 미완료인 날의 퇴근 시각 추정. 화면에 미리 채워주는 값. */
export async function estimateFor(
  userId: string,
  workDate: string,
  rules: OrgRules,
): Promise<Estimate | null> {
  const raw = await rawDay(userId, workDate, rules);
  if (!raw || raw.status !== "incomplete" || !raw.firstInAt) return null;

  const history = await recentCompleted(userId, workDate, rules);
  return estimateCheckout(
    raw.firstInAt,
    history,
    rules.attendance,
    rules.settlement.standardMinutesPerDay,
  );
}

/** null 이면 "태그가 아예 없는 날" — 호출부가 소정근로를 기대값으로 쓴다 */
export async function baselineWorkMinutes(
  userId: string,
  workDate: string,
  rules: OrgRules,
): Promise<number | null> {
  const raw = await rawDay(userId, workDate, rules);
  if (!raw) return null;
  if (raw.status !== "incomplete") return raw.workMinutes;

  const estimate = await estimateFor(userId, workDate, rules);
  return estimate?.workMinutes ?? rules.settlement.standardMinutesPerDay;
}
