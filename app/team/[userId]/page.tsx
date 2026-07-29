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
import { PeriodNav } from "../../period-nav";
import {
  ADJUST_KIND_LABEL as KIND_LABEL,
  dowOf,
  FLAG_LABEL,
  hm,
  ROLE_LABEL,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TeamMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { userId } = await params;
  const { period } = await searchParams;
  const viewer = await requestViewer(`/team/${userId}`);
  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;

  const [target] = await db
    .select({
      id: users.id,
      name: users.name,
      employeeNo: users.employeeNo,
      teamName: teams.name,
      hiredAt: users.hiredAt,
      resignedAt: users.resignedAt,
    })
    .from(users)
    .leftJoin(teams, eq(users.teamId, teams.id))
    .where(and(eq(users.id, userId), eq(users.orgId, viewer.orgId)));

  if (!target) notFound();

  const asOf = now();
  const opts = {
    kind: rules.settlementKind,
    weekStartDay: rules.weekStartDay,
    timezone: zone,
  };
  const today = DateTime.fromJSDate(asOf, { zone }).toISODate()!;
  const range = resolvePeriod(period ?? today, opts);
  const isCurrent = range.start === resolvePeriod(today, opts).start;

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
      employment: {
        hiredAt: target.hiredAt,
        resignedAt: target.resignedAt,
      },
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
        {/*
          사번은 제목 옆에 둔다. 오른쪽 칩은 다른 화면에서 "지금 누구로 보고
          있나"를 말하는 자리라, 여기서 대상의 사번을 넣으면 뜻이 어긋난다.
        */}
        <span className="team">
          {target.employeeNo} · {target.teamName ?? "—"}
        </span>
        <span className="chip">
          {viewer.name} · {ROLE_LABEL[viewer.role]}
        </span>
      </div>
      <p className="sub">
        {/*
          여기만 기간 이동이 없어서, 팀원의 지난주를 보려면 팀 현황으로 나가
          기간을 바꾸고 다시 들어와야 했다. 다른 화면과 같은 알약을 쓴다.
        */}
        <PeriodNav
          basePath={`/team/${userId}`}
          range={range}
          kind={rules.settlementKind}
          weekStartDay={rules.weekStartDay}
          timezone={zone}
          isCurrent={isCurrent}
        />
        <span className="after-nav">
          <Link href="/team">팀 현황으로</Link>
        </span>
        <br />
        <span className="dim">
          이 조회는 열람 이력에 남습니다. 근태는 개인정보입니다.
        </span>
        {/* 부분 재직이면 아래 숫자가 어느 구간인지 적는다 */}
        {summary.partialEmployment && (
          <>
            <br />
            <span className="dim">
              재직 {summary.applicableStart} ~ {summary.applicableEnd} — 소정근로와
              주 평균이 이 구간으로 계산됩니다
            </span>
          </>
        )}
      </p>

      {/* 재직 기간이 아니면 0 을 그리지 않는다 — 없는 미달이 생긴다 */}
      {!summary.employed && (
        <section className="card">
          <p className="empty">
            {target.name} 님은 이 정산기간에 재직 기록이 없습니다.
            {target.hiredAt && ` 입사 ${target.hiredAt}.`}
            {target.resignedAt && ` 퇴사 ${target.resignedAt}.`}
          </p>
        </section>
      )}

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
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>날짜</th>
                {/*
                  대시보드에서 고친 것과 같은 이유로 "출근/퇴근"이라고 쓰지
                  않는다. 나눠 일한 날의 09시와 21시는 하루의 양끝일 뿐이고
                  그 사이를 근무로 읽으면 안 된다.
                */}
                <th>첫 시작</th>
                <th>마지막 종료</th>
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
                      {dt.toFormat("M/d")} ({dowOf(dt.weekday)})
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
                          {d.status === "open" && (
                            <span className="tag">근무 중</span>
                          )}
                          {d.status === "adjusted" && (
                            <span className="tag">보정됨</span>
                          )}
                          {/* 나눠 일한 날은 팀장도 알아야 한다 */}
                          {d.sessionCount > 1 && (
                            <span className="tag">
                              {d.sessionCount}번 나눠 근무
                            </span>
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
        </div>
      </section>

      <section className="card">
        <h2>보정 이력</h2>
        {history.length === 0 ? (
          <p className="empty">보정한 기록이 없습니다.</p>
        ) : (
          <div className="scroll-x">
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
          </div>
        )}
      </section>
    </main>
  );
}
