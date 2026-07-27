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
 * 시각이 확정된 하루를 요약한다. computeWorkDays와 applyAdjustment가 같은 계산을
 * 쓰도록 여기 한 군데로 모은다.
 */
function summarize(
  workDate: string,
  firstInAt: Date,
  lastOutAt: Date,
  tagCount: number,
  status: "computed" | "adjusted",
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

  // 의무근로시간대는 체류 구간에 완전히 포함되어야 한다.
  // 휴일에는 코어타임이 적용되지 않는다.
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
    status,
    tagCount,
  };
}

/** 퇴근 시각을 모르는 하루. 집계에서 제외하고 본인이 보정하게 한다. */
function incompleteDay(
  workDate: string,
  firstInAt: Date | null,
  tagCount: number,
  rules: AttendanceRules,
  extraFlags: DayFlag[] = [],
): ComputedDay {
  return {
    workDate,
    firstInAt,
    lastOutAt: null,
    stayMinutes: 0,
    breakMinutes: 0,
    workMinutes: 0,
    nightMinutes: 0,
    isHoliday: isHolidayDate(workDate, rules),
    flags: extraFlags,
    status: "incomplete",
    tagCount,
  };
}

/**
 * 원본 태그 → 일별 근무 집계.
 *
 * 규칙: 일별 첫 태그 = 시작, 마지막 태그 = 종료. 중간 이탈(점심·흡연·층간 이동)은
 * 무시한다. 하루에 태그가 6~10번 찍히는 게 정상이고, 그걸 다 쪼개면 분 단위 감시가
 * 되어 자율출근제 취지와 정반대가 된다.
 */
export function computeWorkDays(
  tags: TagInput[],
  rules: AttendanceRules,
): ComputedDay[] {
  const groups = new Map<string, TagInput[]>();
  for (const tag of tags) {
    const workDate = resolveWorkDate(tag.occurredAt, rules);
    const bucket = groups.get(workDate);
    if (bucket) bucket.push(tag);
    else groups.set(workDate, [tag]);
  }

  const days: ComputedDay[] = [];
  for (const [workDate, dayTags] of groups) {
    const sorted = [...dayTags].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
    );
    const first = sorted[0].occurredAt;
    const last = sorted[sorted.length - 1].occurredAt;

    // 태그가 1개면 퇴근 시각을 모른다. 8시간 같은 값을 임의로 채우면 근태 데이터
    // 신뢰가 통째로 깨진다. 미완료로 남기고 집계에서 제외한다.
    if (sorted.length === 1) {
      days.push(incompleteDay(workDate, first, 1, rules));
      continue;
    }

    // 지문이 두 번 인식되는 등으로 태그는 여럿인데 체류가 0분인 경우.
    // 태그 1개와 사실상 같으므로 미완료로 두되, 사유를 구분해 남긴다.
    if (last.getTime() === first.getTime()) {
      days.push(
        incompleteDay(workDate, first, sorted.length, rules, ["zero_stay"]),
      );
      continue;
    }

    days.push(
      summarize(workDate, first, last, sorted.length, "computed", rules),
    );
  }

  return days.sort((a, b) => a.workDate.localeCompare(b.workDate));
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
  const fallback = incompleteDay(adj.workDate, null, 0, rules);

  // 취소는 삭제가 아니라 새 행이다. 원본 계산 결과로 되돌린다.
  if (adj.kind === "revert") return base ?? fallback;

  const day = base ?? fallback;
  const firstInAt = adj.overrideFirstInAt ?? day.firstInAt;
  const lastOutAt = adj.overrideLastOutAt ?? day.lastOutAt;
  const addedMinutes = adj.addedMinutes ?? 0;

  // 시각이 확정됐으면 체류·휴게·야간·위반을 전부 다시 계산한다
  if (firstInAt && lastOutAt) {
    const recomputed = summarize(
      adj.workDate,
      firstInAt,
      lastOutAt,
      day.tagCount,
      "adjusted",
      rules,
    );
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
  };
}
