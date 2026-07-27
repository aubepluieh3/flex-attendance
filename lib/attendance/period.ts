import { DateTime } from "luxon";

export type PeriodKind = "week" | "month";
export type PeriodRange = { start: string; end: string };

/**
 * 어떤 날짜가 속한 정산기간을 구한다.
 *
 * 주 시작일이 설정이라서 계산으로 풀어야 한다 — 저장해두면 설정을 바꾼 순간
 * 과거 기간 경계가 전부 어긋난다.
 */
export function resolvePeriod(
  date: string,
  opts: { kind: PeriodKind; weekStartDay: number; timezone: string },
): PeriodRange {
  const dt = DateTime.fromISO(date, { zone: opts.timezone });

  if (opts.kind === "month") {
    return {
      start: dt.startOf("month").toISODate()!,
      end: dt.endOf("month").toISODate()!,
    };
  }

  // weekStartDay: 1=월 … 7=일 (Luxon 기준)
  const back = (dt.weekday - opts.weekStartDay + 7) % 7;
  const start = dt.minus({ days: back });
  return {
    start: start.toISODate()!,
    end: start.plus({ days: 6 }).toISODate()!,
  };
}

/**
 * 앞뒤 정산기간. 경계를 직접 더하지 않고 인접한 날짜를 다시 resolve 한다 —
 * 월 정산에서 기간 길이가 달라도 어긋나지 않는다.
 */
export function shiftPeriod(
  range: PeriodRange,
  delta: number,
  opts: { kind: PeriodKind; weekStartDay: number; timezone: string },
): PeriodRange {
  let current = range;
  for (let i = 0; i < Math.abs(delta); i++) {
    const anchor =
      delta > 0
        ? DateTime.fromISO(current.end, { zone: opts.timezone }).plus({ days: 1 })
        : DateTime.fromISO(current.start, { zone: opts.timezone }).minus({
            days: 1,
          });
    current = resolvePeriod(anchor.toISODate()!, opts);
  }
  return current;
}
