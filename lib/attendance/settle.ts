/*
 * ⚠ 여기서 새 판정·플래그·확인 항목을 만들 때 먼저 물을 것:
 *
 *     "이 항목을 정직하게 신고하면 그 사람에게 무슨 일이 생기나?"
 *
 * 손해가 생기면 아무도 신고하지 않는다. 정직한 소수만 손해를 본다.
 * 이 프로젝트에서 같은 구조를 네 번 만들었다가 고쳤다:
 *
 *   보정 횟수로 검토       사원증을 두 번 깜빡한 사람이 안 고친 사람보다 의심받았다
 *   반차 + 근무 = 위반     반차는 반나절 일하는 게 정상인데 매번 걸렸다
 *   외근 보정을 항상 올림  고객사 방문이 잦은 사람이 정직할수록 의심받았다
 *   휴가일 근무 무조건     전일 휴가만 올리게 고쳤다
 *
 * 금지 문구를 CLAUDE.md 에만 적어두면 반복됐다. 그래서 판정을 만드는 자리인
 * 여기에 질문으로 둔다 — 위반을 알아봐야 발동하는 금지보다, 새 판정을 만들
 * 때마다 발동하는 질문이 낫다.
 */
import { DateTime } from "luxon";
import type { ComputedDay, DayFlag } from "./types";

/**
 * 정산기간 집계.
 *
 * 선택적 근로시간제(§52)의 핵심: 1일 8시간 / 1주 40시간에 묶이지 않고
 * **정산기간 총량**으로 판단한다. 따라서 연장근로도, 주 52시간 상한도
 * 개별 주가 아니라 정산기간 평균으로 계산해야 한다.
 *
 * 특정 주에 60시간 일했더라도 정산기간 평균이 넘지 않으면 위법이 아니다.
 */

export type TimeOffEntry = {
  date: string;
  kind: "full" | "half_am" | "half_pm" | "unpaid";
  /** 소정근로에서 빼는 분. 저장된 스냅샷 값을 그대로 쓴다. */
  deductMinutes: number;
};

/** 소정근로 산정 방식 */
export type TargetCalcMethod =
  /** 영업일 × 1일 소정근로. 월별 영업일 차이가 반영된다 (기본) */
  | "business_days"
  /** 정산기간당 고정 시간 */
  | "fixed";

export type SettlementRules = {
  timezone: string;
  weekendDays: number[];
  holidays: string[];
  targetCalcMethod: TargetCalcMethod;
  /** 휴가 1일이 차감하는 소정근로. business_days 방식의 기본 단위. */
  standardMinutesPerDay: number;
  /** fixed 방식에서 쓰는 정산기간 목표 */
  fixedTargetMinutes: number;
  /** 법정 주 근로시간 (40h) */
  legalWeeklyMinutes: number;
  /** 정산기간 **평균** 주 근로시간 상한 (52h) */
  maxAvgWeeklyMinutes: number;
  /** 페이스 판정 허용 오차 */
  paceToleranceMinutes: number;
};

export type PaceStatus = "ahead" | "on_track" | "behind";

export type PeriodInput = {
  /** YYYY-MM-DD */
  periodStart: string;
  /** YYYY-MM-DD, 포함 */
  periodEnd: string;
  days: ComputedDay[];
  timeOff: TimeOffEntry[];
  /** 페이스 계산 기준 시각 */
  asOf: Date;
};

export type PeriodSummary = {
  periodStart: string;
  periodEnd: string;

  businessDays: number;
  /** 소정근로 = 영업일 × 8h − 휴가 차감 */
  targetMinutes: number;
  /** 미완료 일자는 제외한 실근무 합 */
  workedMinutes: number;
  remainingMinutes: number;
  nightMinutes: number;
  holidayMinutes: number;

  elapsedBusinessDays: number;
  /**
   * 남은 영업일 (오늘 포함).
   * 주 정산에서는 이게 페이스보다 직관적이다 — 남은 일수가 1~5일이면
   * 사람이 머리로 나눌 수 있고, "하루 몇 시간"이 바로 행동 신호가 된다.
   */
  remainingBusinessDays: number;
  /** 경과한 영업일까지 채웠어야 하는 시간 (오늘 제외) */
  elapsedTargetMinutes: number;
  /** 페이스 판정에 쓴 실적 (오늘 제외). workedMinutes와 다를 수 있다 */
  pacedWorkedMinutes: number;
  /** 현재 페이스대로면 기간 말에 도달할 시간 */
  projectedMinutes: number;
  paceStatus: PaceStatus;

  /** 정산기간 평균 주 근로시간 */
  avgWeeklyMinutes: number;
  /** 정산기간 총 법정근로시간을 넘은 분 = 연장근로 */
  overtimeMinutes: number;
  /** 평균 주 52시간 초과 — 위법 소지 */
  exceedsAvgWeeklyLimit: boolean;

  /** 확인 필요 */
  incompleteDates: string[];
  flaggedDates: Array<{ date: string; flags: DayFlag[] }>;
  /** 휴가로 등록된 날에 근무 기록이 있다 */
  timeOffConflicts: string[];
  /** 연속 근무일 최대치. 6일 이상이면 주휴 미부여 위험 */
  maxConsecutiveWorkDays: number;
};

/** 마감 시점에 얼려두는 개인별 집계값 */
export type PeriodSnapshot = {
  targetMinutes: number;
  workedMinutes: number;
  nightMinutes: number;
  holidayMinutes: number;
  overtimeMinutes: number;
  /** 반올림한 분 */
  avgWeeklyMinutes: number;
};

export type SnapshotDiff = {
  changed: boolean;
  /** 현재값 − 스냅샷. 0인 항목은 담지 않는다. */
  deltas: Partial<Record<keyof PeriodSnapshot, number>>;
};

export function snapshotOf(s: PeriodSummary): PeriodSnapshot {
  return {
    targetMinutes: s.targetMinutes,
    workedMinutes: s.workedMinutes,
    nightMinutes: s.nightMinutes,
    holidayMinutes: s.holidayMinutes,
    overtimeMinutes: s.overtimeMinutes,
    avgWeeklyMinutes: Math.round(s.avgWeeklyMinutes),
  };
}

/** 자동 마감 예정일. 정산기간 종료 + 유예일. */
export function closeDateFor(
  periodEnd: string,
  graceDays: number,
  zone: string,
): string {
  return DateTime.fromISO(periodEnd, { zone })
    .plus({ days: graceDays })
    .toISODate()!;
}

export function isClosable(
  periodEnd: string,
  graceDays: number,
  asOf: Date,
  zone: string,
): boolean {
  const asOfDate = DateTime.fromJSDate(asOf, { zone }).toISODate()!;
  return asOfDate > closeDateFor(periodEnd, graceDays, zone);
}

/**
 * 마감 후 값이 바뀌었는지. 늦게 도착한 태그나 설정 변경으로 발생한다.
 *
 * 임포트를 막지 않는 이유: 원본은 append-only여야 하고, 막으면 데이터가 유실된다.
 * 대신 공식 기록은 스냅샷을 쓰고 차이를 눈에 보이게 만든다.
 */
export function diffAgainstSnapshot(
  snapshot: PeriodSnapshot,
  current: PeriodSummary,
): SnapshotDiff {
  const now = snapshotOf(current);
  const deltas: Partial<Record<keyof PeriodSnapshot, number>> = {};

  for (const key of Object.keys(snapshot) as Array<keyof PeriodSnapshot>) {
    const delta = now[key] - snapshot[key];
    if (delta !== 0) deltas[key] = delta;
  }

  return { changed: Object.keys(deltas).length > 0, deltas };
}

function eachDate(start: string, end: string, zone: string): string[] {
  const out: string[] = [];
  let cursor = DateTime.fromISO(start, { zone });
  const last = DateTime.fromISO(end, { zone });
  while (cursor <= last) {
    out.push(cursor.toISODate()!);
    cursor = cursor.plus({ days: 1 });
  }
  return out;
}

function isBusinessDay(date: string, rules: SettlementRules): boolean {
  if (rules.holidays.includes(date)) return false;
  const weekday = DateTime.fromISO(date, { zone: rules.timezone }).weekday;
  return !rules.weekendDays.includes(weekday);
}

/** 날짜가 연속인지 (YYYY-MM-DD 기준) */
function isNextDay(prev: string, next: string, zone: string): boolean {
  return (
    DateTime.fromISO(prev, { zone }).plus({ days: 1 }).toISODate() === next
  );
}

export function computePeriodSummary(
  input: PeriodInput,
  rules: SettlementRules,
): PeriodSummary {
  const { periodStart, periodEnd, days, timeOff, asOf } = input;
  const zone = rules.timezone;

  const allDates = eachDate(periodStart, periodEnd, zone);
  const businessDates = allDates.filter((d) => isBusinessDay(d, rules));

  const inPeriod = new Set(allDates);
  const periodTimeOff = timeOff.filter((t) => inPeriod.has(t.date));
  const timeOffDeduct = periodTimeOff.reduce(
    (sum, t) => sum + t.deductMinutes,
    0,
  );

  const grossTarget =
    rules.targetCalcMethod === "fixed"
      ? rules.fixedTargetMinutes
      : businessDates.length * rules.standardMinutesPerDay;
  const targetMinutes = Math.max(0, grossTarget - timeOffDeduct);

  const periodDays = days.filter((d) => inPeriod.has(d.workDate));
  const counted = periodDays.filter((d) => d.status !== "incomplete");

  const workedMinutes = counted.reduce((s, d) => s + d.workMinutes, 0);
  const nightMinutes = counted.reduce((s, d) => s + d.nightMinutes, 0);
  const holidayMinutes = counted
    .filter((d) => d.isHoliday)
    .reduce((s, d) => s + d.workMinutes, 0);

  // ── 페이스 ──
  //
  // 오늘은 아직 진행 중이므로 페이스 판정에서 제외한다. 오늘을 경과로 세면
  // 아침에는 항상 "뒤처짐", 저녁에는 "앞섬"으로 나와서 지표를 믿을 수 없게 된다.
  // 오늘 실적은 누적(workedMinutes)에는 그대로 들어간다.
  const asOfDate = DateTime.fromJSDate(asOf, { zone }).toISODate()!;
  const paceCutoff =
    asOfDate < periodStart
      ? null
      : asOfDate > periodEnd
        ? periodEnd
        : DateTime.fromISO(asOfDate, { zone }).minus({ days: 1 }).toISODate()!;

  const elapsedBusinessDates =
    paceCutoff !== null ? businessDates.filter((d) => d <= paceCutoff) : [];
  const elapsedTimeOffDeduct = periodTimeOff
    .filter((t) => paceCutoff !== null && t.date <= paceCutoff)
    .reduce((s, t) => s + t.deductMinutes, 0);

  const elapsedTargetMinutes = Math.max(
    0,
    elapsedBusinessDates.length * rules.standardMinutesPerDay -
      elapsedTimeOffDeduct,
  );

  /** 페이스 판정에 쓰는 실적 — 오늘 이전까지 */
  const pacedWorkedMinutes = counted
    .filter((d) => paceCutoff !== null && d.workDate <= paceCutoff)
    .reduce((s, d) => s + d.workMinutes, 0);

  // 목표에 대한 비율로 투사한다. 휴가가 목표에서 이미 빠져 있으므로
  // 휴가 낀 기간에도 페이스가 왜곡되지 않는다.
  // 나눗셈을 마지막에 둔다. 먼저 나누면 부동소수점 때문에 헤드라인 숫자가
  // 1분씩 깎인다 (1438/1920*2400 → 1797.4999…).
  const projectedMinutes =
    elapsedTargetMinutes > 0
      ? Math.round((pacedWorkedMinutes * targetMinutes) / elapsedTargetMinutes)
      : workedMinutes;

  const gap = pacedWorkedMinutes - elapsedTargetMinutes;
  const paceStatus: PaceStatus =
    gap > rules.paceToleranceMinutes
      ? "ahead"
      : gap < -rules.paceToleranceMinutes
        ? "behind"
        : "on_track";

  // ── 법정 한도: 개별 주가 아니라 정산기간 평균으로 본다 ──
  const weeks = allDates.length / 7;
  const avgWeeklyMinutes = weeks > 0 ? workedMinutes / weeks : 0;
  const legalTotalMinutes = weeks * rules.legalWeeklyMinutes;
  const overtimeMinutes = Math.max(
    0,
    Math.round(workedMinutes - legalTotalMinutes),
  );
  const exceedsAvgWeeklyLimit = avgWeeklyMinutes > rules.maxAvgWeeklyMinutes;

  // ── 확인 필요 ──
  const incompleteDates = periodDays
    .filter((d) => d.status === "incomplete")
    .map((d) => d.workDate)
    .sort();

  const flaggedDates = periodDays
    .filter((d) => d.flags.length > 0)
    .map((d) => ({ date: d.workDate, flags: d.flags }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const workedDates = new Set(
    counted.filter((d) => d.workMinutes > 0).map((d) => d.workDate),
  );
  /*
   * 휴가일에 근무 기록이 있으면 올린다 — 단 반차는 뺀다.
   *
   * 반차는 반나절 일하는 게 정상인데 걸리게 두면, 정직하게 반차를 신청한
   * 사람만 매번 확인 대상이 된다. 그러면 아무도 반차를 신청하지 않는다.
   * (자기신고에 불이익을 붙이는 설계)
   */
  const timeOffConflicts = periodTimeOff
    .filter(
      (t) =>
        workedDates.has(t.date) &&
        t.kind !== "half_am" &&
        t.kind !== "half_pm",
    )
    .map((t) => t.date)
    .sort();

  let maxConsecutiveWorkDays = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of [...workedDates].sort()) {
    run = prev && isNextDay(prev, date, zone) ? run + 1 : 1;
    if (run > maxConsecutiveWorkDays) maxConsecutiveWorkDays = run;
    prev = date;
  }

  return {
    periodStart,
    periodEnd,
    businessDays: businessDates.length,
    targetMinutes,
    workedMinutes,
    remainingMinutes: Math.max(0, targetMinutes - workedMinutes),
    nightMinutes,
    holidayMinutes,
    elapsedBusinessDays: elapsedBusinessDates.length,
    remainingBusinessDays: businessDates.length - elapsedBusinessDates.length,
    elapsedTargetMinutes,
    pacedWorkedMinutes,
    projectedMinutes,
    paceStatus,
    avgWeeklyMinutes,
    overtimeMinutes,
    exceedsAvgWeeklyLimit,
    incompleteDates,
    flaggedDates,
    timeOffConflicts,
    maxConsecutiveWorkDays,
  };
}
