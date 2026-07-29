import { DateTime } from "luxon";
import { autoBreakMinutesFor } from "./compute";
import { stayForWork } from "./sessions";
import type { AttendanceRules, ComputedDay } from "./types";

/**
 * 누락된 퇴근 시각 추정.
 *
 * 미완료를 0분으로 두고 사용자가 직접 시간을 적게 하면, 정직한 사람은 실제
 * 시간을 적고 아닌 사람은 부풀린다 — 정직이 손해가 되는 구조다. 시스템이
 * 먼저 추정치를 제시하고 사용자는 확인만 하게 만든다.
 *
 * 그리고 이 추정치가 "기대값"이 되어, 검토는 보정 횟수가 아니라 기대값에서
 * 벗어난 정도로 판단할 수 있게 된다.
 */

export type Estimate = {
  lastOutAt: Date;
  workMinutes: number;
  /** history = 그 사람 평소 체류시간, standard = 소정근로 기준 */
  source: "history" | "standard";
  sampleDays: number;
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/**
 * @param history 같은 사람의 완료된 날들 (최근 것이 뒤에 오든 앞에 오든 무관)
 */
export function estimateCheckout(
  firstInAt: Date,
  history: ComputedDay[],
  rules: AttendanceRules,
  standardMinutesPerDay: number,
): Estimate {
  const stays = history
    .filter((d) => d.status !== "incomplete" && d.stayMinutes > 0)
    .slice(-10)
    .map((d) => d.stayMinutes);

  const useHistory = stays.length >= 3;
  let stay = useHistory
    ? median(stays)
    : stayForWork(standardMinutesPerDay, rules);

  // 추정치가 1일 상한을 넘으면 안 된다. 추정이 위반을 만들면 안 되니까.
  if (rules.dailyLimitMinutes !== null) {
    const maxStay = stayForWork(rules.dailyLimitMinutes, rules);
    if (stay > maxStay) stay = maxStay;
  }

  const lastOutAt = DateTime.fromJSDate(firstInAt, { zone: rules.timezone })
    .plus({ minutes: stay })
    .toJSDate();

  return {
    lastOutAt,
    workMinutes: Math.max(0, stay - autoBreakMinutesFor(stay, rules.autoBreakRules)),
    source: useHistory ? "history" : "standard",
    sampleDays: stays.length,
  };
}

/**
 * 보정이 "기대값"에서 얼마나 벗어났는지.
 *
 * 검토 대상을 보정 횟수나 총합으로 잡으면, 사원증을 두 번 깜빡한 사람이
 * 아예 안 고친 사람보다 의심받는다. 벗어난 정도로 보면 정직한 다수가 빠진다.
 *
 * - 태그가 있던 날: 원본 계산값이 기대값
 * - 태그가 없던 날(외근): 1일 소정근로가 기대값 — 평범한 8시간 외근은 0이 된다
 */
export function deviationMinutes(opts: {
  finalWorkMinutes: number;
  baselineWorkMinutes: number | null;
  standardMinutesPerDay: number;
}): number {
  const baseline = opts.baselineWorkMinutes ?? opts.standardMinutesPerDay;
  return Math.abs(opts.finalWorkMinutes - baseline);
}
