import { DateTime } from "luxon";
import { loadOrgRules, loadWorkDays } from "@/db/access";
import { listAdjustments } from "@/db/adjust";
import { isPeriodClosed } from "@/db/close";
import { estimateFor } from "@/db/baseline";
import { sessionsByDate } from "@/db/checkin";
import { resolvePeriod } from "@/lib/attendance/period";
import type { ComputedDay, DayFlag } from "@/lib/attendance/types";
import { now } from "@/lib/clock";
import { requestViewer } from "../viewer";
import { recordsAction } from "./actions";
import { PeriodNav } from "../period-nav";

export const dynamic = "force-dynamic";

const WEEKDAY = ["월", "화", "수", "목", "금", "토", "일"];

const FLAG_LABEL: Record<DayFlag, string> = {
  core_time_violation: "의무근로시간대 미준수",
  outside_flex_band: "선택시간대 밖 근무",
  over_daily_limit: "1일 상한 초과",
  zero_stay: "태그 중복 인식",
  holiday_work: "휴일 근무",
};

const SOURCE_LABEL = {
  app: "앱에서 시작",
  badge: "사원증 기록",
  import: "가져온 기록",
  manual: "직접 입력",
} as const;

const KIND_LABEL = {
  missing_tag: "시각 보정",
  field_work: "외근·출장",
  correction: "정정",
  revert: "보정 취소",
} as const;

function hm(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; msg?: string; err?: string }>;
}) {
  const { period, msg, err } = await searchParams;
  const viewer = await requestViewer("/records");
  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;

  const asOf = now();
  const opts = {
    kind: rules.settlementKind,
    weekStartDay: rules.weekStartDay,
    timezone: zone,
  };
  const today = DateTime.fromJSDate(asOf, { zone }).toISODate()!;
  const range = resolvePeriod(period ?? today, opts);
  const isCurrent = range.start === resolvePeriod(today, opts).start;

  const days = await loadWorkDays(viewer, viewer.id, range);
  const history = await listAdjustments(viewer, viewer.id, range);
  const closed = await isPeriodClosed(viewer.orgId, range);
  const sessions = await sessionsByDate(
    viewer.id,
    range.start,
    range.end,
    rules,
  );

  const byDate = new Map<string, ComputedDay>(days.map((d) => [d.workDate, d]));
  const adjustedDates = new Set(
    history.filter((h) => h.kind !== "revert").map((h) => h.workDate),
  );

  const dates: string[] = [];
  let cursor = DateTime.fromISO(range.start, { zone });
  const last = DateTime.fromISO(range.end, { zone });
  while (cursor <= last) {
    dates.push(cursor.toISODate()!);
    cursor = cursor.plus({ days: 1 });
  }

  const time = (d: Date | null) =>
    d ? DateTime.fromJSDate(d, { zone }).toFormat("HH:mm") : "";

  /**
   * 미완료인 날은 퇴근 시각을 미리 채워준다.
   *
   * 0분으로 두고 직접 적게 하면 정직한 사람만 실제 시간을 적고 아닌 사람은
   * 부풀린다. 시스템이 먼저 제시하면 정직한 쪽은 확인만 하면 되고, 부풀리려면
   * 제시값을 벗어나야 해서 그 차이가 검토 대상이 된다.
   */
  const estimates = new Map<string, Awaited<ReturnType<typeof estimateFor>>>();
  for (const d of days) {
    if (d.status !== "incomplete") continue;
    estimates.set(d.workDate, await estimateFor(viewer.id, d.workDate, rules));
  }


  return (
    <main className="page">
      <div className="head">
        <h1>내 기록 · 보정</h1>
        <span className="team">{viewer.teamName ?? rules.orgName}</span>
      </div>
      <p className="sub">
        <PeriodNav
          basePath="/records"
          range={range}
          kind={rules.settlementKind}
          weekStartDay={rules.weekStartDay}
          timezone={zone}
          isCurrent={isCurrent}
        />
        <br />
        <span className="dim">
          사원증 기록이 빠졌거나 외근을 한 날을 보정합니다. 원본 기록은 지우지
          않고 보정 이력만 쌓입니다.
        </span>
      </p>

      {closed && (
        <section className="card">
          <ul className="issues">
            <li>
              <span className="icon warn" aria-hidden="true">
                !
              </span>
              <span>
                <span className="what">마감된 정산기간입니다</span>
                <br />
                <span className="why">
                  확정된 기록은 더 바뀌지 않습니다. 고쳐야 할 게 있으면 HR에
                  재마감을 요청하세요.
                </span>
              </span>
            </li>
          </ul>
        </section>
      )}

      {(msg || err) && (
        <section className="card">
          <ul className="issues">
            <li>
              <span className={`icon ${err ? "crit" : "warn"}`} aria-hidden="true">
                !
              </span>
              <span className="what">{err ?? msg}</span>
            </li>
          </ul>
        </section>
      )}

      {dates.map((date) => {
        const day = byDate.get(date);
        const dt = DateTime.fromISO(date, { zone });
        const dow = WEEKDAY[dt.weekday - 1];
        const needsFix = !day || day.status === "incomplete";
        const wasAdjusted = adjustedDates.has(date);
        const daySessions = sessions.get(date) ?? [];
        /**
         * 닫아야 할 앱 세션. 사원증에서 유도된 구간(id 없음)은 여기 들어오지
         * 않는다 — 원본 태그를 고칠 수는 없으므로 그건 보정으로 간다.
         */
        const toClose =
          date < today
            ? daySessions.filter((s) => s.id !== null && !s.endedAt)
            : [];
        // 세션을 닫으면 저절로 맞는 날이다. 보정 안내까지 띄우면 길이 두 개로 보인다.
        const dangling = toClose.length > 0;

        return (
          <section className="card" key={date}>
            <div className="day-head">
              <strong>
                {dt.toFormat("M월 d일")} ({dow})
              </strong>
              {day ? (
                day.status === "incomplete" ? (
                  <span className="tag">미완료</span>
                ) : (
                  <span className="day-sum">
                    {/*
                      나눠 일한 날은 "첫 출근~마지막 퇴근"을 보여주면 안 된다.
                      09~12 + 19~21 을 09~21 로 쓰면 사이 7시간까지 일한 것처럼 읽힌다.
                    */}
                    {day.sessionCount > 1
                      ? `${day.sessionCount}번 나눠 근무`
                      : `${time(day.firstInAt)}~${time(day.lastOutAt)}`}{" "}
                    · 실근무 {hm(day.workMinutes)}
                  </span>
                )
              ) : (
                <span className="day-sum none">기록 없음</span>
              )}
              {day?.status === "open" && (
                <span className="status good inline">
                  <span className="dot" aria-hidden="true" />
                  근무 중
                </span>
              )}
              {wasAdjusted && <span className="tag">보정됨</span>}
              {day?.flags.map((f) => (
                <span className="tag" key={f}>
                  {FLAG_LABEL[f]}
                </span>
              ))}
            </div>

            {daySessions.length > 0 && (
              <ul className="sessions">
                {daySessions.map((s, i) => (
                  <li key={s.id ?? `badge-${i}`}>
                    <span className="span">
                      {time(s.startedAt)}~
                      {/*
                        지난 날의 열린 구간은 "진행 중"이 아니다. 사원증을 한 번만
                        찍고 퇴근한 날에 "진행 중"이라고 쓰면 나흘 전부터 일하는
                        중이라는 뜻이 된다.
                      */}
                      {s.endedAt ? (
                        time(s.endedAt)
                      ) : date >= today ? (
                        <b>진행 중</b>
                      ) : (
                        <b>종료 기록 없음</b>
                      )}
                    </span>
                    <span className="none">
                      {SOURCE_LABEL[s.source]}
                      {s.closedManually && ` · 종료 시각 직접 입력: ${s.closedNote}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/*
              어제 종료를 깜빡한 세션. 기획서 1번 "체크아웃을 깜빡한 경우 나중에 수정".
              하루 전체를 덮어쓰는 보정과 달리 그 세션만 닫으므로, 같은 날의 다른
              세션과 사원증 기록은 그대로 남는다.
            */}
            {!closed &&
              toClose.map((s) => (
                <form action={recordsAction} className="adjust" key={s.id}>
                  <input type="hidden" name="op" value="closeSession" />
                  <input type="hidden" name="sessionId" value={s.id!} />
                  <input type="hidden" name="workDate" value={date} />
                  <input type="hidden" name="period" value={range.start} />
                  <label className="field">
                    <span>{time(s.startedAt)} 시작 · 종료 시각</span>
                    <input
                      type="time"
                      name="endedAt"
                      required
                      defaultValue={time(estimates.get(date)?.lastOutAt ?? null)}
                    />
                  </label>
                  <label className="field grow">
                    <span>
                      사유<b> *</b>
                    </span>
                    <input
                      type="text"
                      name="note"
                      required
                      placeholder="종료 버튼을 누르지 않고 퇴근했습니다"
                    />
                  </label>
                  <button type="submit">이 근무 종료</button>
                </form>
              ))}

            {!closed && !dangling && estimates.get(date) && (
              <p className="empty" style={{ marginBottom: 10 }}>
                {estimates.get(date)!.source === "history"
                  ? `평소 근무 패턴(최근 ${estimates.get(date)!.sampleDays}일)으로 퇴근 시각을 채워뒀습니다. 맞으면 사유만 적고 보정하세요.`
                  : "소정근로 기준으로 퇴근 시각을 채워뒀습니다. 맞으면 사유만 적고 보정하세요."}
              </p>
            )}

            {!closed && (
              <>
                <form action={recordsAction} className="adjust">
                  <input type="hidden" name="op" value="adjust" />
                  <input type="hidden" name="workDate" value={date} />
                  <input type="hidden" name="period" value={range.start} />
                  <label className="field">
                    <span>출근</span>
                    <input type="time" name="firstIn" defaultValue={time(day?.firstInAt ?? null)} />
                  </label>
                  <label className="field">
                    <span>퇴근{estimates.get(date) ? " (추정)" : ""}</span>
                    <input
                      type="time"
                      name="lastOut"
                      defaultValue={
                        time(day?.lastOutAt ?? null) ||
                        time(estimates.get(date)?.lastOutAt ?? null)
                      }
                    />
                  </label>
                  <label className="field">
                    <span>외근 시간(분)</span>
                    <input type="number" name="addedMinutes" min={0} max={1440} step={10} placeholder="예: 480 = 8시간" />
                  </label>
                  <label className="field grow">
                    <span>
                      사유<b> *</b>
                    </span>
                    <input
                      type="text"
                      name="reason"
                      required
                      placeholder={needsFix ? "사원증을 놓고 와서 퇴근을 못 찍었습니다" : "정정 사유"}
                    />
                  </label>
                  <button type="submit">보정</button>
                </form>

                {wasAdjusted && (
                  <form action={recordsAction} className="adjust">
                    <input type="hidden" name="op" value="revert" />
                    <input type="hidden" name="workDate" value={date} />
                    <input type="hidden" name="period" value={range.start} />
                    <button type="submit" className="pill">
                      보정 취소 (원본으로)
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
        );
      })}

      <section className="card">
        <h2>보정 이력</h2>
        {history.length === 0 ? (
          <p className="empty">아직 보정한 기록이 없습니다.</p>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>대상 날짜</th>
                  <th>종류</th>
                  <th>내용</th>
                  <th>사유</th>
                  <th>기록</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>
                      {DateTime.fromISO(h.workDate, { zone }).toFormat("M/d")}
                    </td>
                    <td>{KIND_LABEL[h.kind]}</td>
                    <td>
                      {h.kind === "revert"
                        ? "—"
                        : [
                            h.overrideFirstInAt || h.overrideLastOutAt
                              ? `${time(h.overrideFirstInAt)}~${time(h.overrideLastOutAt)}`
                              : null,
                            h.addedMinutes ? `+${hm(h.addedMinutes)}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                    </td>
                    <td>{h.reason}</td>
                    <td className="none">
                      {h.createdByName} ·{" "}
                      {DateTime.fromJSDate(h.createdAt, { zone }).toFormat(
                        "M/d HH:mm",
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
