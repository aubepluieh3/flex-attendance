import { DateTime, Interval } from "luxon";
import type {
  AdjustmentInput,
  AttendanceRules,
  BreakRule,
  ComputedDay,
  DayFlag,
  HourMinute,
  TagInput,
} from "./types";

/** "HH:MM" → 자정으로부터의 분 */
function parseHm(hm: HourMinute): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * 태그가 귀속되는 날짜(YYYY-MM-DD).
 *
 * dayBoundaryHour 이전 태그는 전날로 본다. 월요일 09시 출근 → 화요일 01시 퇴근이
 * "월요일 16시간"으로 잡혀야 하기 때문. 자정을 경계로 쓰면 야근이 두 날로 쪼개진다.
 */
export function resolveWorkDate(
  occurredAt: Date,
  rules: AttendanceRules,
): string {
  const local = DateTime.fromJSDate(occurredAt, { zone: rules.timezone });
  const shifted =
    local.hour < rules.dayBoundaryHour ? local.minus({ days: 1 }) : local;
  return shifted.toISODate()!;
}

/**
 * 휴게시간 차감분.
 *
 * 법정 기준은 '근로시간' 기반이지만(근로기준법 §54) 근로시간은 휴게를 뺀 값이라
 * 순환이 된다. 실무 시스템이 하는 대로 체류시간을 대리 지표로 쓴다.
 */
export function breakMinutesFor(
  stayMinutes: number,
  breakRules: BreakRule[],
): number {
  let deduct = 0;
  let matchedOver = -1;
  for (const rule of breakRules) {
    if (stayMinutes >= rule.overHours * 60 && rule.overHours > matchedOver) {
      matchedOver = rule.overHours;
      deduct = rule.deductMinutes;
    }
  }
  return deduct;
}

/**
 * 체류 구간과 야간시간대(22:00~06:00)가 겹친 분.
 *
 * 야간대는 자정을 넘고, 장시간 야근은 여러 밤에 걸칠 수 있다. 체류 구간이 지나가는
 * 날짜를 모두 훑어서 교집합을 더한다.
 */
export function nightMinutesFor(
  from: Date,
  to: Date,
  rules: AttendanceRules,
): number {
  const zone = rules.timezone;
  const stay = Interval.fromDateTimes(
    DateTime.fromJSDate(from, { zone }),
    DateTime.fromJSDate(to, { zone }),
  );
  if (!stay.isValid || stay.length("minutes") === 0) return 0;

  const startMin = parseHm(rules.nightWindow.start);
  const endMin = parseHm(rules.nightWindow.end);
  // 22:00~06:00 처럼 끝이 시작보다 작으면 다음 날로 넘긴다
  const spanEnd = endMin <= startMin ? endMin + 24 * 60 : endMin;

  let total = 0;
  // 체류 시작 전날의 야간대가 걸칠 수 있으므로 하루 앞에서 시작한다
  let cursor = stay.start!.startOf("day").minus({ days: 1 });
  const last = stay.end!.startOf("day");
  while (cursor <= last) {
    const night = Interval.fromDateTimes(
      cursor.plus({ minutes: startMin }),
      cursor.plus({ minutes: spanEnd }),
    );
    const hit = stay.intersection(night);
    if (hit) total += hit.length("minutes");
    cursor = cursor.plus({ days: 1 });
  }
  return Math.round(total);
}

function bandInterval(
  workDate: string,
  band: { start: HourMinute; end: HourMinute },
  zone: string,
): Interval {
  const dayStart = DateTime.fromISO(workDate, { zone }).startOf("day");
  const startMin = parseHm(band.start);
  const endMin = parseHm(band.end);
  const spanEnd = endMin <= startMin ? endMin + 24 * 60 : endMin;
  return Interval.fromDateTimes(
    dayStart.plus({ minutes: startMin }),
    dayStart.plus({ minutes: spanEnd }),
  );
}

function isHolidayDate(workDate: string, rules: AttendanceRules): boolean {
  if (rules.holidays.includes(workDate)) return true;
  const weekday = DateTime.fromISO(workDate, { zone: rules.timezone }).weekday;
  return rules.weekendDays.includes(weekday);
}

/**
 * 보정용 하루 요약.
 *
 * 세션 기반 계산은 sessions.ts 가 한다. 여기는 보정이 시각을 덮어썼을 때
 * 하나의 구간으로 다시 계산하는 경우만 다룬다 — 보정은 "이 날 이 시각부터
 * 이 시각까지" 형태이므로 구간이 하나다.
 */
function summarize(
  workDate: string,
  firstInAt: Date,
  lastOutAt: Date,
  base: ComputedDay | null,
  rules: AttendanceRules,
): ComputedDay {
  const zone = rules.timezone;
  const stayMinutes = Math.round(
    (lastOutAt.getTime() - firstInAt.getTime()) / 60_000,
  );
  const breakMinutes = breakMinutesFor(stayMinutes, rules.breakRules);
  const workMinutes = Math.max(0, stayMinutes - breakMinutes);
  const isHoliday = isHolidayDate(workDate, rules);

  const inAt = DateTime.fromJSDate(firstInAt, { zone });
  const outAt = DateTime.fromJSDate(lastOutAt, { zone });
  const flags: DayFlag[] = [];

  if (rules.coreTime && !isHoliday) {
    const core = bandInterval(workDate, rules.coreTime, zone);
    if (inAt > core.start! || outAt < core.end!) {
      flags.push("core_time_violation");
    }
  }
  if (rules.flexBand) {
    const band = bandInterval(workDate, rules.flexBand, zone);
    if (inAt < band.start! || outAt > band.end!) {
      flags.push("outside_flex_band");
    }
  }
  if (rules.dailyLimitMinutes !== null && workMinutes > rules.dailyLimitMinutes) {
    flags.push("over_daily_limit");
  }
  if (isHoliday) flags.push("holiday_work");

  return {
    workDate,
    firstInAt,
    lastOutAt,
    stayMinutes,
    breakMinutes,
    workMinutes,
    nightMinutes: nightMinutesFor(firstInAt, lastOutAt, rules),
    isHoliday,
    flags,
    status: "adjusted",
    tagCount: base?.tagCount ?? 0,
    sessionCount: base?.sessionCount ?? 1,
    // 보정으로 시각이 확정되면 더는 진행 중이 아니다
    openSince: null,
  };
}

/** 기록이 아예 없는 날 (외근·출장 보정의 바탕) */
function emptyDay(workDate: string, rules: AttendanceRules): ComputedDay {
  return {
    workDate,
    firstInAt: null,
    lastOutAt: null,
    stayMinutes: 0,
    breakMinutes: 0,
    workMinutes: 0,
    nightMinutes: 0,
    isHoliday: isHolidayDate(workDate, rules),
    flags: [],
    status: "incomplete",
    tagCount: 0,
    sessionCount: 0,
    openSince: null,
  };
}
/**
 * 보정 적용. base가 null이면 태그가 아예 없는 날(외근·출장)이다.
 *
 * 보정은 append-only로 쌓이고 (userId, workDate)별 가장 최근 1건만 적용한다.
 * 누적 적용하지 않는 이유는, 여러 건이 겹쳤을 때 결과를 사람이 예측할 수 없기 때문.
 */
export function applyAdjustment(
  base: ComputedDay | null,
  adj: AdjustmentInput,
  rules: AttendanceRules,
): ComputedDay {
  const fallback = emptyDay(adj.workDate, rules);

  // 취소는 삭제가 아니라 새 행이다. 원본 계산 결과로 되돌린다.
  if (adj.kind === "revert") return base ?? fallback;

  const day = base ?? fallback;
  const firstInAt = adj.overrideFirstInAt ?? day.firstInAt;
  const lastOutAt = adj.overrideLastOutAt ?? day.lastOutAt;
  const addedMinutes = adj.addedMinutes ?? 0;

  // 시각이 확정됐으면 체류·휴게·야간·위반을 전부 다시 계산한다
  if (firstInAt && lastOutAt) {
    const recomputed = summarize(adj.workDate, firstInAt, lastOutAt, day, rules);
    return {
      ...recomputed,
      workMinutes: recomputed.workMinutes + addedMinutes,
    };
  }

  // 시각을 모르는 채 시간만 더하는 경우(외근). 휴게는 사용자가 이미 뺀 값으로 본다.
  return {
    ...day,
    workDate: adj.workDate,
    firstInAt,
    lastOutAt,
    workMinutes: Math.max(0, addedMinutes),
    status: "adjusted",
    openSince: null,
  };
}
