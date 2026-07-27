import Link from "next/link";
import { DateTime } from "luxon";
import { shiftPeriod, type PeriodKind, type PeriodRange } from "@/lib/attendance/period";

const WEEKDAY = ["월", "화", "수", "목", "금", "토", "일"];

/**
 * 정산기간 앞뒤 이동.
 *
 * 이게 없으면 "지난주에 내가 몇 시간 일했지?"에 답할 수 없다. 마감된 기간도
 * 볼 수 있어야 한다 — 고칠 수는 없어도 확인은 해야 하니까.
 */
export function PeriodNav({
  basePath,
  range,
  kind,
  weekStartDay,
  timezone,
  isCurrent,
}: {
  basePath: string;
  range: PeriodRange;
  kind: PeriodKind;
  weekStartDay: number;
  timezone: string;
  isCurrent: boolean;
}) {
  const opts = { kind, weekStartDay, timezone };
  const prev = shiftPeriod(range, -1, opts);
  const next = shiftPeriod(range, 1, opts);
  const from = DateTime.fromISO(range.start, { zone: timezone });
  const to = DateTime.fromISO(range.end, { zone: timezone });

  const link = (r: PeriodRange, label: string) => (
    <Link href={`${basePath}?period=${r.start}`}>{label}</Link>
  );

  return (
    <span className="period-nav">
      {link(prev, "← 이전")}
      <span>
        {from.toFormat("yyyy년 M월 d일")}({WEEKDAY[from.weekday - 1]}) ~{" "}
        {to.toFormat("M월 d일")}({WEEKDAY[to.weekday - 1]})
      </span>
      {link(next, "다음 →")}
      {!isCurrent && <Link href={basePath}>이번 기간으로</Link>}
    </span>
  );
}
