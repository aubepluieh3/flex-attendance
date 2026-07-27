import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { teams, users } from "@/db/schema";
import {
  AccessDenied,
  loadOrgRules,
  loadTimeOff,
  loadWorkDays,
} from "@/db/access";
import { listAdjustments } from "@/db/adjust";
import { computePeriodSummary } from "@/lib/attendance/settle";
import { resolvePeriod } from "@/lib/attendance/period";
import type { DayFlag } from "@/lib/attendance/types";
import { now } from "@/lib/clock";
import { requestViewer } from "../../viewer";

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

export default async function TeamMemberPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const viewer = await requestViewer();
  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;

  const [target] = await db
    .select({
      id: users.id,
      name: users.name,
      employeeNo: users.employeeNo,
      teamName: teams.name,
    })
    .from(users)
    .leftJoin(teams, eq(users.teamId, teams.id))
    .where(and(eq(users.id, userId), eq(users.orgId, viewer.orgId)));

  if (!target) notFound();

  const asOf = now();
  const range = resolvePeriod(DateTime.fromJSDate(asOf, { zone }).toISODate()!, {
    kind: rules.settlementKind,
    weekStartDay: rules.weekStartDay,
    timezone: zone,
  });

  // 권한 검사와 열람 로그는 loadWorkDays 안에서 일어난다
  let days;
  try {
    days = await loadWorkDays(viewer, userId, range);
  } catch (e) {
    if (e instanceof AccessDenied) {
      return (
        <main className="page">
          <div className="head">
            <h1>{target.name}</h1>
          </div>
          <section className="card">
            <ul className="issues">
              <li>
                <span className="icon crit" aria-hidden="true">
                  !
                </span>
                <span>
                  <span className="what">조회 권한이 없습니다</span>
                  <br />
                  <span className="why">{e.message}</span>
                </span>
              </li>
            </ul>
            <p className="empty" style={{ marginTop: 12 }}>
              <Link href="/team">팀 현황으로</Link>
            </p>
          </section>
        </main>
      );
    }
    throw e;
  }

  const off = await loadTimeOff(viewer, userId, range);
  const history = await listAdjustments(viewer, userId, range);
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

  const byDate = new Map(days.map((d) => [d.workDate, d]));
  const dates: string[] = [];
  let cursor = DateTime.fromISO(range.start, { zone });
  const last = DateTime.fromISO(range.end, { zone });
  while (cursor <= last) {
    dates.push(cursor.toISODate()!);
    cursor = cursor.plus({ days: 1 });
  }

  const time = (d: Date | null) =>
    d ? DateTime.fromJSDate(d, { zone }).toFormat("HH:mm") : "—";

  return (
    <main className="page">
      <div className="head">
        <h1>{target.name}</h1>
        <span className="team">{target.teamName ?? "—"}</span>
        <span className="chip">{target.employeeNo}</span>
      </div>
      <p className="sub">
        {DateTime.fromISO(range.start, { zone }).toFormat("M월 d일")} ~{" "}
        {DateTime.fromISO(range.end, { zone }).toFormat("M월 d일")} ·{" "}
        <Link href="/team">팀 현황으로</Link>
        <br />
        <span className="dim">
          이 조회는 열람 이력에 남습니다. 근태는 개인정보입니다.
        </span>
      </p>

      <section className="card">
        <div className="tiles">
          <div className="tile">
            <div className="k">실근무</div>
            <div className="v">{hm(summary.workedMinutes)}</div>
          </div>
          <div className="tile">
            <div className="k">소정근로</div>
            <div className="v">{hm(summary.targetMinutes)}</div>
          </div>
          <div className="tile">
            <div className="k">주 평균</div>
            <div className="v">{hm(summary.avgWeeklyMinutes)}</div>
            {summary.exceedsAvgWeeklyLimit && (
              <div className="k" style={{ marginTop: 2 }}>
                52시간 초과
              </div>
            )}
          </div>
          <div className="tile">
            <div className="k">야간 · 휴일</div>
            <div className="v">{hm(summary.nightMinutes)}</div>
            <div className="k" style={{ marginTop: 2 }}>
              휴일 {hm(summary.holidayMinutes)}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>일별 기록</h2>
        <table>
          <thead>
            <tr>
              <th>날짜</th>
              <th>출근</th>
              <th>퇴근</th>
              <th>실근무</th>
              <th>비고</th>
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => {
              const d = byDate.get(date);
              const dt = DateTime.fromISO(date, { zone });
              return (
                <tr key={date}>
                  <td>
                    {dt.toFormat("M/d")} ({WEEKDAY[dt.weekday - 1]})
                  </td>
                  {d ? (
                    <>
                      <td>{time(d.firstInAt)}</td>
                      <td>{time(d.lastOutAt)}</td>
                      <td>
                        {d.status === "incomplete" ? "—" : hm(d.workMinutes)}
                      </td>
                      <td>
                        {d.status === "incomplete" && (
                          <span className="tag">미완료</span>
                        )}
                        {d.status === "adjusted" && (
                          <span className="tag">보정됨</span>
                        )}
                        {d.flags.map((f) => (
                          <span className="tag" key={f}>
                            {FLAG_LABEL[f]}
                          </span>
                        ))}
                      </td>
                    </>
                  ) : (
                    <>
                      <td colSpan={3} className="none">
                        기록 없음
                      </td>
                      <td />
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>보정 이력</h2>
        {history.length === 0 ? (
          <p className="empty">보정한 기록이 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>대상</th>
                <th>종류</th>
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
