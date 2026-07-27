import { DateTime } from "luxon";
import { computePeriodSummary } from "@/lib/attendance/settle";
import { resolvePeriod } from "@/lib/attendance/period";
import type { ComputedDay, DayFlag } from "@/lib/attendance/types";
import { isDemoClock, now } from "@/lib/clock";
import { loadOrgRules, loadTimeOff, loadWorkDays } from "@/db/access";
import { requestViewer } from "./viewer";

// DB를 읽으므로 빌드 시점에 프리렌더하지 않는다
export const dynamic = "force-dynamic";

/** 차트 y축 최대 (10시간). 1일 소정근로 8시간 기준선을 그린다. */
const SCALE_MINUTES = 10 * 60;
const REFERENCE_MINUTES = 8 * 60;

const WEEKDAY = ["월", "화", "수", "목", "금", "토", "일"];

const FLAG_LABEL: Record<DayFlag, string> = {
  core_time_violation: "의무근로시간대 미준수",
  outside_flex_band: "선택시간대 밖 근무",
  over_daily_limit: "1일 상한 초과",
  zero_stay: "태그 중복 인식",
  holiday_work: "휴일 근무",
};

function hm(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}분`;
  if (m === 0) return `${sign}${h}시간`;
  return `${sign}${h}시간 ${m}분`;
}

const clock = (date: Date | null, zone: string) =>
  date ? DateTime.fromJSDate(date, { zone }).toFormat("HH:mm") : null;

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

const label = (date: string, zone: string) => {
  const dt = DateTime.fromISO(date, { zone });
  return { md: dt.toFormat("M/d"), dow: WEEKDAY[dt.weekday - 1] };
};

export default async function Page() {
  const viewer = await requestViewer();
  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;

  const asOf = now();
  const asOfDate = DateTime.fromJSDate(asOf, { zone }).toISODate()!;
  const range = resolvePeriod(asOfDate, {
    kind: rules.settlementKind,
    weekStartDay: rules.weekStartDay,
    timezone: zone,
  });

  const days = await loadWorkDays(viewer, viewer.id, range);
  const off = await loadTimeOff(viewer, viewer.id, range);

  const summary = computePeriodSummary(
    {
      periodStart: range.start,
      periodEnd: range.end,
      days,
      timeOff: off,
      asOf,
    },
    rules.settlement,
  );

  const dates = eachDate(range.start, range.end, zone);
  const byDate = new Map<string, ComputedDay>(days.map((d) => [d.workDate, d]));

  const paceGap = summary.projectedMinutes - summary.targetMinutes;
  const paceNote =
    summary.paceStatus === "behind"
      ? `이 페이스면 ${hm(-paceGap)} 부족`
      : summary.paceStatus === "ahead"
        ? `이 페이스면 ${hm(paceGap)} 초과`
        : "목표대로 가고 있음";

  /**
   * 주 정산에서는 "남은 시간 / 남은 일수"가 페이스보다 직관적이다.
   * 남은 일수가 1~5일이면 사람이 머리로 나눌 수 있고, "하루 몇 시간"이
   * 바로 행동 신호가 된다. 페이스는 정산기간이 월일 때 값어치가 생긴다.
   */
  const remainingBusinessDates = dates.filter((date) => {
    if (date < asOfDate) return false;
    const dt = DateTime.fromISO(date, { zone });
    return (
      !rules.attendance.weekendDays.includes(dt.weekday) &&
      !rules.attendance.holidays.includes(date)
    );
  });

  const requiredPerDay =
    summary.remainingBusinessDays > 0
      ? Math.ceil(summary.remainingMinutes / summary.remainingBusinessDays)
      : 0;
  const dailyLimit = rules.attendance.dailyLimitMinutes;
  const unreachable =
    dailyLimit !== null &&
    summary.remainingMinutes > 0 &&
    requiredPerDay > dailyLimit;

  const remainingLabel =
    summary.remainingBusinessDays === 0
      ? "영업일이 모두 지났습니다"
      : summary.remainingBusinessDays === 1
        ? `${label(remainingBusinessDates[0], zone).dow}요일 하루 남음 — 하루 ${hm(requiredPerDay)} 필요`
        : `영업일 ${summary.remainingBusinessDays}일 남음 — 하루 ${hm(requiredPerDay)} 필요`;

  const core = rules.attendance.coreTime;
  const from = DateTime.fromISO(range.start, { zone });
  const to = DateTime.fromISO(range.end, { zone });
  // 실제 데이터에서 뽑는다. "기준시각 - 1일"로 두면 임포트가 늦거나 빠를 때
  // 화면이 거짓말을 한다.
  const lastRecorded = days.filter((d) => d.tagCount > 0).at(-1)?.workDate;
  const importedThrough = lastRecorded
    ? `근태 기록은 ${DateTime.fromISO(lastRecorded, { zone }).toFormat("M월 d일")}까지 들어와 있음`
    : "이 기간에 들어온 근태 기록이 없음";

  return (
    <main className="page">
      <div className="head">
        <h1>{viewer.name}</h1>
        <span className="team">{viewer.teamName ?? rules.orgName}</span>
        {isDemoClock() && <span className="chip">데모 시계</span>}
      </div>
      <p className="sub">
        {from.toFormat("yyyy년 M월 d일")}({WEEKDAY[from.weekday - 1]}) ~{" "}
        {to.toFormat("M월 d일")}({WEEKDAY[to.weekday - 1]}) ·{" "}
        {rules.settlementKind === "week" ? "주" : "월"} 단위 정산
        <br />
        <span className="dim">
          {DateTime.fromJSDate(asOf, { zone }).toFormat("M월 d일 HH:mm")} 기준 ·{" "}
          {importedThrough}
        </span>
      </p>

      {/* 남은 시간 — 실제로 존재하는 숫자를 1급으로 둔다 */}
      <section className="card hero">
        {summary.remainingMinutes === 0 ? (
          <>
            <div className="label">이번 정산기간 소정근로</div>
            <div className="figure">채웠습니다</div>
            <div className="status good">
              <span className="dot" aria-hidden="true" />
              목표 달성
            </div>
            <div className="note">
              누적 {hm(summary.workedMinutes)} / 목표{" "}
              {hm(summary.targetMinutes)}
            </div>
          </>
        ) : (
          <>
            <div className="label">남은 시간</div>
            <div className="figure">{hm(summary.remainingMinutes)}</div>
            {unreachable && (
              <div className="status warn">
                <span className="dot" aria-hidden="true" />
                1일 상한 {hm(dailyLimit!)}을 넘습니다
              </div>
            )}
            <div className="note">{remainingLabel}</div>
          </>
        )}
      </section>

      <section className="card">
        <div className="tiles">
          <div className="tile">
            <div className="k">누적</div>
            <div className="v">{hm(summary.workedMinutes)}</div>
          </div>
          <div className="tile">
            <div className="k">소정근로</div>
            <div className="v">{hm(summary.targetMinutes)}</div>
          </div>
          <div className="tile">
            <div className="k">이 페이스면</div>
            <div className="v">{hm(summary.projectedMinutes)}</div>
            <div className="k" style={{ marginTop: 2 }}>
              {paceNote}
            </div>
          </div>
          <div className="tile">
            <div className="k">야간 근무</div>
            <div className="v">{hm(summary.nightMinutes)}</div>
          </div>
        </div>
        <div className="meter">
          <span
            style={{
              width: `${
                summary.targetMinutes
                  ? Math.min(
                      100,
                      (summary.workedMinutes / summary.targetMinutes) * 100,
                    )
                  : 0
              }%`,
            }}
          />
        </div>
        <div className="meter-legend">
          <span>{hm(summary.workedMinutes)}</span>
          <span>목표 {hm(summary.targetMinutes)}</span>
        </div>
      </section>

      <section className="card">
        <h2>확인 필요</h2>
        {summary.incompleteDates.length === 0 &&
        summary.flaggedDates.length === 0 &&
        summary.timeOffConflicts.length === 0 &&
        !summary.exceedsAvgWeeklyLimit ? (
          <p className="empty">확인할 항목이 없습니다.</p>
        ) : (
          <ul className="issues">
            {summary.exceedsAvgWeeklyLimit && (
              <li>
                <span className="icon crit" aria-hidden="true">
                  !
                </span>
                <span>
                  <span className="what">주 평균 52시간 초과</span>
                  <br />
                  <span className="why">
                    정산기간 평균 {hm(summary.avgWeeklyMinutes)} — 법정 한도를
                    넘었습니다.
                  </span>
                </span>
              </li>
            )}
            {summary.incompleteDates.map((date) => {
              const l = label(date, zone);
              const d = byDate.get(date);
              return (
                <li key={date}>
                  <span className="icon warn" aria-hidden="true">
                    !
                  </span>
                  <span>
                    <span className="what">
                      {l.md}({l.dow}) 퇴근 기록 없음
                    </span>
                    <br />
                    <span className="why">
                      {clock(d?.firstInAt ?? null, zone)} 출근 기록만 있습니다.
                      집계에서 빠져 있으니 퇴근 시각을 보정해 주세요.
                    </span>
                  </span>
                </li>
              );
            })}
            {summary.flaggedDates.map(({ date, flags }) => {
              const l = label(date, zone);
              const d = byDate.get(date);
              return (
                <li key={`f-${date}`}>
                  <span className="icon warn" aria-hidden="true">
                    !
                  </span>
                  <span>
                    <span className="what">
                      {l.md}({l.dow}){" "}
                      {flags.map((f) => FLAG_LABEL[f]).join(", ")}
                    </span>
                    <br />
                    <span className="why">
                      {clock(d?.firstInAt ?? null, zone)}~
                      {clock(d?.lastOutAt ?? null, zone)} 근무
                      {core
                        ? ` · 의무근로시간대는 ${core.start}~${core.end}입니다.`
                        : ""}
                    </span>
                  </span>
                </li>
              );
            })}
            {summary.timeOffConflicts.map((date) => {
              const l = label(date, zone);
              return (
                <li key={`t-${date}`}>
                  <span className="icon warn" aria-hidden="true">
                    !
                  </span>
                  <span>
                    <span className="what">
                      {l.md}({l.dow}) 휴가일에 근무 기록
                    </span>
                    <br />
                    <span className="why">
                      휴가로 등록된 날에 출입 기록이 있습니다.
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>일별 근무시간</h2>
        <div className="chart">
          <div
            className="ref"
            style={{ bottom: `${(REFERENCE_MINUTES / SCALE_MINUTES) * 100}%` }}
          >
            <span>8시간</span>
          </div>
          {dates.map((date) => {
            const d = byDate.get(date);
            const l = label(date, zone);
            if (!d) {
              return (
                <div className="col" key={date} tabIndex={0}>
                  <div className="tip">
                    {l.md}({l.dow}) · 기록 없음
                  </div>
                </div>
              );
            }
            if (d.status === "incomplete") {
              return (
                <div className="col" key={date} tabIndex={0}>
                  <div className="bar incomplete" style={{ height: "100%" }} />
                  <div className="tip">
                    {l.md}({l.dow}) · 퇴근 기록 없음 — 집계 제외
                  </div>
                </div>
              );
            }
            return (
              <div className="col" key={date} tabIndex={0}>
                <div
                  className="bar"
                  style={{
                    height: `${Math.min(100, (d.workMinutes / SCALE_MINUTES) * 100)}%`,
                  }}
                />
                <div className="tip">
                  {l.md}({l.dow}) · 실근무 {hm(d.workMinutes)}
                  <br />
                  {clock(d.firstInAt, zone)}~{clock(d.lastOutAt, zone)} · 휴게{" "}
                  {hm(d.breakMinutes)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="xaxis">
          {dates.map((date) => {
            const l = label(date, zone);
            const weekend = rules.attendance.weekendDays.includes(
              DateTime.fromISO(date, { zone }).weekday,
            );
            return (
              <div key={date} className={weekend ? "we" : undefined}>
                {l.dow}
              </div>
            );
          })}
        </div>
      </section>

      {/* 표 뷰 — 색에만 의존하지 않기 위해 항상 둔다 */}
      <section className="card">
        <h2>기록</h2>
        <table>
          <thead>
            <tr>
              <th>날짜</th>
              <th>출근</th>
              <th>퇴근</th>
              <th>체류</th>
              <th>휴게</th>
              <th>실근무</th>
              <th>비고</th>
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => {
              const d = byDate.get(date);
              const l = label(date, zone);
              if (!d) {
                return (
                  <tr key={date}>
                    <td>
                      {l.md} ({l.dow})
                    </td>
                    <td colSpan={5} className="none">
                      기록 없음
                    </td>
                    <td />
                  </tr>
                );
              }
              return (
                <tr key={date}>
                  <td>
                    {l.md} ({l.dow})
                  </td>
                  <td>{clock(d.firstInAt, zone) ?? "—"}</td>
                  <td>{clock(d.lastOutAt, zone) ?? "—"}</td>
                  <td>{d.stayMinutes ? hm(d.stayMinutes) : "—"}</td>
                  <td>{d.breakMinutes ? hm(d.breakMinutes) : "—"}</td>
                  <td>
                    {d.status === "incomplete" ? "—" : hm(d.workMinutes)}
                  </td>
                  <td>
                    {d.status === "incomplete" && (
                      <span className="tag">미완료</span>
                    )}
                    {d.flags.map((f) => (
                      <span className="tag" key={f}>
                        {FLAG_LABEL[f]}
                      </span>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
