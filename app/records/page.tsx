import { DateTime } from "luxon";
import { loadOrgRules, loadWorkDays } from "@/db/access";
import { listAdjustments } from "@/db/adjust";
import { isPeriodClosed } from "@/db/close";
import { resolvePeriod } from "@/lib/attendance/period";
import type { ComputedDay, DayFlag } from "@/lib/attendance/types";
import { now } from "@/lib/clock";
import { requestViewer } from "../viewer";
import { adjustAction, revertAction } from "./actions";

export const dynamic = "force-dynamic";

const WEEKDAY = ["월", "화", "수", "목", "금", "토", "일"];

const FLAG_LABEL: Record<DayFlag, string> = {
  core_time_violation: "의무근로시간대 미준수",
  outside_flex_band: "선택시간대 밖 근무",
  over_daily_limit: "1일 상한 초과",
  zero_stay: "태그 중복 인식",
  holiday_work: "휴일 근무",
};

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

export default async function RecordsPage() {
  const viewer = await requestViewer();
  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;

  const asOf = now();
  const range = resolvePeriod(
    DateTime.fromJSDate(asOf, { zone }).toISODate()!,
    {
      kind: rules.settlementKind,
      weekStartDay: rules.weekStartDay,
      timezone: zone,
    },
  );

  const days = await loadWorkDays(viewer, viewer.id, range);
  const history = await listAdjustments(viewer, viewer.id, range);
  const closed = await isPeriodClosed(viewer.orgId, range);

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

  return (
    <main className="page">
      <div className="head">
        <h1>내 기록 · 보정</h1>
        <span className="team">{viewer.teamName ?? rules.orgName}</span>
      </div>
      <p className="sub">
        {DateTime.fromISO(range.start, { zone }).toFormat("M월 d일")} ~{" "}
        {DateTime.fromISO(range.end, { zone }).toFormat("M월 d일")}
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

      {dates.map((date) => {
        const day = byDate.get(date);
        const dt = DateTime.fromISO(date, { zone });
        const dow = WEEKDAY[dt.weekday - 1];
        const needsFix = !day || day.status === "incomplete";
        const wasAdjusted = adjustedDates.has(date);

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
                    {time(day.firstInAt)}~{time(day.lastOutAt)} · 실근무{" "}
                    {hm(day.workMinutes)}
                  </span>
                )
              ) : (
                <span className="day-sum none">기록 없음</span>
              )}
              {wasAdjusted && <span className="tag">보정됨</span>}
              {day?.flags.map((f) => (
                <span className="tag" key={f}>
                  {FLAG_LABEL[f]}
                </span>
              ))}
            </div>

            {closed ? null : (
            <form action={adjustAction} className="adjust">
              <input type="hidden" name="workDate" value={date} />
              <label className="field">
                <span>출근</span>
                <input
                  type="time"
                  name="firstIn"
                  defaultValue={time(day?.firstInAt ?? null)}
                />
              </label>
              <label className="field">
                <span>퇴근</span>
                <input
                  type="time"
                  name="lastOut"
                  defaultValue={time(day?.lastOutAt ?? null)}
                />
              </label>
              <label className="field">
                <span>외근 시간(분)</span>
                <input
                  type="number"
                  name="addedMinutes"
                  min={0}
                  max={1440}
                  step={10}
                  placeholder="0"
                />
              </label>
              <label className="field grow">
                <span>
                  사유<b> *</b>
                </span>
                <input
                  type="text"
                  name="reason"
                  required
                  placeholder={
                    needsFix ? "사원증을 놓고 와서 퇴근을 못 찍었습니다" : "정정 사유"
                  }
                />
              </label>
              <button type="submit">보정</button>
            </form>
            )}

            {wasAdjusted && !closed && (
              <form action={revertAction} className="adjust">
                <input type="hidden" name="workDate" value={date} />
                <input type="hidden" name="reason" value="보정 취소" />
                <button type="submit" className="pill">
                  보정 취소 (원본으로)
                </button>
              </form>
            )}
          </section>
        );
      })}

      <section className="card">
        <h2>보정 이력</h2>
        {history.length === 0 ? (
          <p className="empty">아직 보정한 기록이 없습니다.</p>
        ) : (
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
        )}
      </section>
    </main>
  );
}
