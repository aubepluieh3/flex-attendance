import Link from "next/link";
import { DateTime } from "luxon";
import { shiftPeriod, type PeriodKind, type PeriodRange } from "@/lib/attendance/period";
import { dowOf } from "@/lib/format";

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
      {/*
        좁은 화면에서는 연도를 뺀 짧은 표기를 쓴다. 긴 쪽을 그냥 두면 알약이
        화면보다 넓어져서 뒤에 붙는 글자("· 구성원 3명")가 밖으로 밀려 나간다.
      */}
      <span className="wide">
        {from.toFormat("yyyy년 M월 d일")}({dowOf(from.weekday)}) ~{" "}
        {to.toFormat("M월 d일")}({dowOf(to.weekday)})
      </span>
      <span className="narrow">
        {from.toFormat("M/d")}({dowOf(from.weekday)}) ~{" "}
        {to.toFormat("M/d")}({dowOf(to.weekday)})
      </span>
      {link(next, "다음 →")}
      {!isCurrent && <Link href={basePath}>이번 기간으로</Link>}
    </span>
  );
}
