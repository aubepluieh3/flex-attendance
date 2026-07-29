import { DateTime } from "luxon";
import { resolvePeriod, type PeriodKind } from "./period";

/**
 * 소정근로가 법정근로 총량을 넘는 정산기간을 찾는다.
 *
 * 두 값의 **기준이 다르다** —
 *   소정근로   = 영업일 수 × 1일 소정근로   (business_days 방식)
 *   법정 총량  = 역일 ÷ 7 × 40시간          (§50)
 *
 * 그래서 영업일이 많은 달에는 소정근로를 정확히 채우기만 해도 연장근로가
 * 발생한다. 7월(영업일 23일)은 184시간 vs 177시간 9분으로 6시간 51분 차이다.
 *
 * ⚠ 앱은 이걸 이유로 소정근로를 깎지 않는다. 소정근로 산정은 §2①7호로
 * 당사자가 정하는 것이고, 코드가 상한을 씌우면 그게 곧 회사 정책이 된다.
 * 그래서 값을 고치는 대신 **HR 에게 성질을 알려준다.**
 */

export type TargetOverStatutory = {
  /** "2026-07" */
  key: string;
  /** "2026년 7월" 또는 "2026-07-13 주" */
  label: string;
  periodStart: string;
  periodEnd: string;
  businessDays: number;
  targetMinutes: number;
  statutoryMinutes: number;
  /** targetMinutes − statutoryMinutes. 양수면 넘는다 */
  overMinutes: number;
};

export function findTargetOverStatutory(opts: {
  kind: PeriodKind;
  weekStartDay: number;
  timezone: string;
  weekendDays: number[];
  holidays: string[];
  standardMinutesPerDay: number;
  legalWeeklyMinutes: number;
  /** 이 날이 속한 기간부터 훑는다 */
  from: Date;
  /** 훑을 기간 수 (월이면 12 = 1년) */
  count?: number;
}): TargetOverStatutory[] {
  const {
    kind,
    weekStartDay,
    timezone: zone,
    weekendDays,
    holidays,
    standardMinutesPerDay,
    legalWeeklyMinutes,
    from,
    count = kind === "month" ? 12 : 12,
  } = opts;

  const out: TargetOverStatutory[] = [];
  let cursor = DateTime.fromJSDate(from, { zone }).startOf("day");

  for (let i = 0; i < count; i++) {
    const range = resolvePeriod(cursor.toISODate()!, {
      kind,
      weekStartDay,
      timezone: zone,
    });

    let days = 0;
    let businessDays = 0;
    let d = DateTime.fromISO(range.start, { zone });
    const end = DateTime.fromISO(range.end, { zone });
    while (d <= end) {
      days += 1;
      const iso = d.toISODate()!;
      if (!weekendDays.includes(d.weekday) && !holidays.includes(iso)) {
        businessDays += 1;
      }
      d = d.plus({ days: 1 });
    }

    const targetMinutes = businessDays * standardMinutesPerDay;
    const statutoryMinutes = Math.round((days / 7) * legalWeeklyMinutes);
    const overMinutes = targetMinutes - statutoryMinutes;

    if (overMinutes > 0) {
      const start = DateTime.fromISO(range.start, { zone });
      out.push({
        key: kind === "month" ? start.toFormat("yyyy-MM") : range.start,
        label:
          kind === "month"
            ? `${start.year}년 ${start.month}월`
            : `${range.start} 주`,
        periodStart: range.start,
        periodEnd: range.end,
        businessDays,
        targetMinutes,
        statutoryMinutes,
        overMinutes,
      });
    }

    // 경계를 직접 더하지 않고 다음 날짜를 다시 resolve 한다 (기간 길이가 달라도 안전)
    cursor = DateTime.fromISO(range.end, { zone }).plus({ days: 1 });
  }

  return out;
}
