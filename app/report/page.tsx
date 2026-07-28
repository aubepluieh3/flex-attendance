import Link from "next/link";
import { DateTime } from "luxon";
import { loadOrgRules } from "@/db/access";
import { loadPersonRows, loadTeamAggregates } from "@/db/report";
import { resolvePeriod } from "@/lib/attendance/period";
import { now } from "@/lib/clock";
import { requestViewer } from "../viewer";
import { PeriodNav } from "../period-nav";
import { hm } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const viewer = await requestViewer("/report");
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

  if (viewer.role !== "hr" && viewer.role !== "executive") {
    return (
      <main className="page">
        <div className="head">
          <h1>전사 집계</h1>
        </div>
        <section className="card">
          <ul className="issues">
            <li>
              <span className="icon crit" aria-hidden="true">
                !
              </span>
              <span>
                <span className="what">권한이 없습니다</span>
                <br />
                <span className="why">
                  전사 집계는 HR·임원만 볼 수 있습니다. 팀장은{" "}
                  <Link href="/team">팀 현황</Link>을 보세요.
                </span>
              </span>
            </li>
          </ul>
        </section>
      </main>
    );
  }

  const aggregates = await loadTeamAggregates(viewer, range, rules, asOf);
  // 임원은 개인 상세를 볼 수 없다 — 조회 자체를 하지 않는다
  const people =
    viewer.role === "hr"
      ? await loadPersonRows(viewer, range, rules, asOf)
      : null;

  return (
    <main className="page">
      <div className="head">
        <h1>전사 집계</h1>
        <span className="team">{rules.orgName}</span>
        <span className="chip">
          {viewer.name} · {viewer.role === "hr" ? "HR" : "임원"}
        </span>
      </div>
      <p className="sub">
        {/* 다른 화면과 같은 알약을 쓴다. 여기만 맨 링크였다 */}
        <PeriodNav
          basePath="/report"
          range={range}
          kind={rules.settlementKind}
          weekStartDay={rules.weekStartDay}
          timezone={zone}
          isCurrent={isCurrent}
        />
        <br />
        <span className="dim">
          {viewer.role === "executive"
            ? "임원 권한은 팀별 집계만 조회합니다. 개인 상세 기록은 열람할 수 없습니다."
            : "이 조회는 열람 이력에 남습니다."}
        </span>
      </p>

      <section className="card">
        <h2>팀별</h2>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>팀</th>
                <th>인원</th>
                <th>기록 있음</th>
                <th>실근무 합</th>
                <th>소정근로 합</th>
                <th>야간</th>
                <th>휴일</th>
                <th>52h 초과</th>
                <th>미완료</th>
              </tr>
            </thead>
            <tbody>
              {aggregates.length === 0 ? (
                <tr>
                  <td colSpan={9} className="none">
                    집계할 데이터가 없습니다.
                  </td>
                </tr>
              ) : (
                aggregates.map((a) => (
                  <tr key={a.teamName}>
                    <td>{a.teamName}</td>
                    <td>{a.headcount}</td>
                    <td className="none">{a.activeCount}</td>
                    <td>{hm(a.workedMinutes)}</td>
                    <td className="none">{hm(a.targetMinutes)}</td>
                    <td>{a.nightMinutes ? hm(a.nightMinutes) : "—"}</td>
                    <td>{a.holidayMinutes ? hm(a.holidayMinutes) : "—"}</td>
                    <td>
                      {a.overLimitCount > 0 ? (
                        <span className="badge crit">{a.overLimitCount}</span>
                      ) : (
                        <span className="none">—</span>
                      )}
                    </td>
                    <td>
                      {a.incompleteDays > 0 ? (
                        <span className="badge">{a.incompleteDays}</span>
                      ) : (
                        <span className="none">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/*
          9열인데 좁은 화면에서는 5열만 보인다. 야간·휴일·52h 초과·미완료가
          숨어 있어서 "이게 다인가" 로 읽혔다.
        */}
        <p className="scroll-hint">
          표를 옆으로 밀면 야간 · 휴일 · 52h 초과 · 미완료가 있습니다.
        </p>
      </section>

      {people && (
        <>
          <section className="card">
            <h2>개인별</h2>
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>사번</th>
                    <th>이름</th>
                    <th>팀</th>
                    <th>실근무</th>
                    <th>소정근로</th>
                    <th>주 평균</th>
                    <th>법정초과</th>
                    <th>확인</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.userId}>
                      <td className="none">{p.employeeNo}</td>
                      <td>
                        <Link href={`/team/${p.userId}`}>{p.name}</Link>
                      </td>
                      <td className="none">{p.teamName ?? "—"}</td>
                      <td>{hm(p.summary.workedMinutes)}</td>
                      <td className="none">{hm(p.summary.targetMinutes)}</td>
                      <td>{hm(p.summary.avgWeeklyMinutes)}</td>
                      <td>
                        {p.summary.overtimeMinutes
                          ? hm(p.summary.overtimeMinutes)
                          : "—"}
                      </td>
                      <td>
                        {p.summary.exceedsAvgWeeklyLimit && (
                          <span className="tag">52h 초과</span>
                        )}
                        {p.summary.incompleteDates.length > 0 && (
                          <span className="tag">
                            미완료 {p.summary.incompleteDates.length}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="scroll-hint">
              표를 옆으로 밀면 주 평균 · 법정초과 · 확인이 있습니다.
            </p>
          </section>

          <section className="card">
            <h2>내보내기</h2>
            <p className="empty" style={{ marginTop: -6, marginBottom: 12 }}>
              엑셀에서 바로 열립니다. 급여 시스템에 넘길 원자료입니다.
            </p>
            <a
              className="button-link"
              href={`/report/export?period=${range.start}`}
            >
              CSV 내보내기
            </a>
          </section>
        </>
      )}
    </main>
  );
}
