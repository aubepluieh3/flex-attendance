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
