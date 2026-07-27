import Link from "next/link";
import { DateTime } from "luxon";
import { loadOrgRules } from "@/db/access";
import { loadTeamRows } from "@/db/team";
import { resolvePeriod } from "@/lib/attendance/period";
import { now } from "@/lib/clock";
import { requestViewer } from "../viewer";
import { PeriodNav } from "../period-nav";

export const dynamic = "force-dynamic";

const WEEKDAY = ["월", "화", "수", "목", "금", "토", "일"];

function hm(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const viewer = await requestViewer("/team");
  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;

  if (viewer.role !== "manager" && viewer.role !== "hr") {
    return (
      <main className="page">
        <div className="head">
          <h1>팀 현황</h1>
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
                  팀 현황은 팀장 이상만 볼 수 있습니다. 사원은 본인 기록만
                  조회합니다.
                </span>
              </span>
            </li>
          </ul>
          <p className="empty" style={{ marginTop: 12 }}>
            <Link href="/">내 근무시간으로 돌아가기</Link>
          </p>
        </section>
      </main>
    );
  }

  const asOf = now();
  const opts = {
    kind: rules.settlementKind,
    weekStartDay: rules.weekStartDay,
    timezone: zone,
  };
  const today = DateTime.fromJSDate(asOf, { zone }).toISODate()!;
  const range = resolvePeriod(period ?? today, opts);
  const isCurrent = range.start === resolvePeriod(today, opts).start;
  const rows = await loadTeamRows(viewer, range, rules, asOf);

  const from = DateTime.fromISO(range.start, { zone });
  const to = DateTime.fromISO(range.end, { zone });
  const needsReview = rows.filter((r) => r.review.total > 0);
  const working = rows.filter((r) => r.presence.state === "working");

  const clock = (d: Date) =>
    DateTime.fromJSDate(d, { zone }).toFormat("HH:mm");

  /**
   * 재실 표시는 이번 기간을 볼 때만. 지난주 화면에 "근무 중"이 뜨면
   * 그게 지금인지 그때인지 알 수 없다.
   */
  const presenceCell = (p: (typeof rows)[number]["presence"]) => {
    if (!isCurrent) return <span className="none">—</span>;
    if (p.state === "working") {
      return (
        <span className="status good inline">
          <span className="dot" aria-hidden="true" />
          근무 중 · {clock(p.since)}~
        </span>
      );
    }
    if (p.state === "stale") {
      return (
        <span className="status warn inline">
          <span className="dot" aria-hidden="true" />
          종료 안 됨
        </span>
      );
    }
    return (
      <span className="status muted inline">
        <span className="dot" aria-hidden="true" />
        오프
      </span>
    );
  };

  return (
    <main className="page">
      <div className="head">
        <h1>팀 현황</h1>
        <span className="team">
          {viewer.role === "hr" ? rules.orgName : (viewer.teamName ?? "")}
        </span>
        <span className="chip">
          {viewer.name} · {viewer.role === "hr" ? "HR" : "팀장"}
        </span>
      </div>
      <p className="sub">
        <PeriodNav
          basePath="/team"
          range={range}
          kind={rules.settlementKind}
          weekStartDay={rules.weekStartDay}
          timezone={zone}
          isCurrent={isCurrent}
        />
        {" · 구성원 "}{rows.length}명
        {isCurrent && ` · 지금 근무 중 ${working.length}명`}
        <br />
        <span className="dim">
          {needsReview.length > 0
            ? `${needsReview.length}명에게 확인할 항목이 있습니다. 전수 확인이 아니라 이상값만 올립니다.`
            : "확인할 항목이 있는 사람이 없습니다."}
        </span>
      </p>

      {rows.length === 0 ? (
        <section className="card">
          <p className="empty">조회할 구성원이 없습니다.</p>
        </section>
      ) : (
        <section className="card">
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th>상태</th>
                <th>팀</th>
                <th>실근무</th>
                <th>소정근로</th>
                <th>남음</th>
                <th>확인 필요</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td>
                    <Link href={`/team/${r.userId}`}>{r.name}</Link>
                  </td>
                  <td>{presenceCell(r.presence)}</td>
                  <td className="none">{r.teamName ?? "—"}</td>
                  <td>{hm(r.summary.workedMinutes)}</td>
                  <td className="none">{hm(r.summary.targetMinutes)}</td>
                  <td>
                    {r.summary.remainingMinutes === 0
                      ? "달성"
                      : hm(r.summary.remainingMinutes)}
                  </td>
                  <td>
                    {r.review.total === 0 ? (
                      <span className="none">—</span>
                    ) : (
                      <span
                        className={
                          r.review.exceedsLegalLimit ? "badge crit" : "badge"
                        }
                      >
                        {r.review.total}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {needsReview.length > 0 && (
        <section className="card">
          <h2>확인 필요 상세</h2>
          <ul className="issues">
            {needsReview.map((r) => (
              <li key={r.userId}>
                <span
                  className={
                    r.review.exceedsLegalLimit ? "icon crit" : "icon warn"
                  }
                  aria-hidden="true"
                >
                  !
                </span>
                <span>
                  <span className="what">
                    <Link href={`/team/${r.userId}`}>{r.name}</Link>
                  </span>
                  <br />
                  <span className="why">
                    {[
                      r.review.exceedsLegalLimit &&
                        `주 평균 52시간 초과 (${hm(r.summary.avgWeeklyMinutes)})`,
                      r.review.incomplete > 0 &&
                        `퇴근 기록 없는 날 ${r.review.incomplete}일`,
                      r.review.violations > 0 &&
                        `규정 확인 ${r.review.violations}건`,
                      r.review.zeroTagAdjustments > 0 &&
                        `출입 기록 없는 날의 보정 ${r.review.zeroTagAdjustments}건`,
                      r.review.adjustmentOverThreshold &&
                        `보정 합계 ${hm(r.review.adjustmentMinutes)} (기준 ${hm(rules.reviewThresholdMinutes)} 초과)`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
