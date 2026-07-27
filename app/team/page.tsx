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
  const stale = rows.filter((r) => r.presence.state === "stale");

  /**
   * 목록은 이름순.
   *
   * rows 는 "확인할 게 많은 사람"순으로 와 있는데, 그건 위쪽 '확인 필요'가
   * 이미 하는 일이다. 목록은 특정 사람을 찾는 데 쓰이므로 이름순이 낫다.
   */
  const roster = [...rows].sort((a, b) => a.name.localeCompare(b.name));

  const clock = (d: Date) =>
    DateTime.fromJSDate(d, { zone }).toFormat("HH:mm");
  const pct = (n: number, of: number) =>
    of > 0 ? Math.min(100, Math.round((n / of) * 100)) : 0;

  /**
   * 재실 표시는 이번 기간을 볼 때만. 지난주 화면에 "근무 중"이 뜨면
   * 그게 지금인지 그때인지 알 수 없다.
   */
  const presenceCell = (
    p: (typeof rows)[number]["presence"],
    dash = true,
  ) => {
    if (!isCurrent) return dash ? <span className="none">—</span> : null;
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

  /** 확인할 게 있는 사람만. 재실 요약 바로 아래에 둔다 — 두 번째 질문이다. */
  const reviewSection =
    needsReview.length === 0 ? null : (
      <section className="card">
        <h2>확인 필요</h2>
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
    );

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
        {/*
          좁은 화면에서는 기간 알약이 한 줄을 다 쓰므로 이 글자가 다음 줄로
          내려간다. 선행 "·" 을 붙이면 줄 맨 앞에 점만 남아서 어색하다.
        */}
        <span className="after-nav">구성원 {rows.length}명</span>
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
        <>
          {/*
            재실 요약.
            팀장이 이 화면을 여는 이유는 "지금 누가 있나"와 "누구를 봐야 하나"
            두 개다. 그 답을 표에서 세어서 알게 하지 않는다.
          */}
          {isCurrent && (
            <section className="card">
              <div className="tiles">
                <div className="tile">
                  <div className="k">지금 근무 중</div>
                  <div className="v">{working.length}명</div>
                </div>
                <div className="tile">
                  <div className="k">오프</div>
                  <div className="v">
                    {rows.length - working.length - stale.length}명
                  </div>
                </div>
                <div className="tile">
                  <div className="k">종료 안 됨</div>
                  <div className="v">{stale.length}명</div>
                  {stale.length > 0 && (
                    <div className="k" style={{ marginTop: 2 }}>
                      본인이 종료 시각을 넣어야 집계됩니다
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {reviewSection}

          {/*
            진행률 목록.
            숫자를 눈으로 비교하지 않아도 뒤처진 사람이 튀어 보인다.
            눈금은 "지금쯤이면 여기"라는 기대선 — 없으면 월요일에 전원이
            뒤처진 것처럼 보인다.
          */}
          <section className="card">
            <h2>구성원 · 목표 대비</h2>
            <ul className="roster">
              {roster.map((r) => {
                const s = r.summary;
                const done = pct(s.workedMinutes, s.targetMinutes);
                const elapsed = s.businessDays - s.remainingBusinessDays;
                const expected = pct(elapsed, s.businessDays);
                return (
                  <li key={r.userId}>
                    <div className="who">
                      <Link href={`/team/${r.userId}`}>{r.name}</Link>
                      {presenceCell(r.presence, false)}
                      {r.review.total > 0 && (
                        <span
                          className={
                            r.review.exceedsLegalLimit ? "badge crit" : "badge"
                          }
                        >
                          확인 {r.review.total}
                        </span>
                      )}
                    </div>
                    <div
                      className="prog"
                      role="img"
                      aria-label={`목표 ${hm(s.targetMinutes)} 중 ${hm(s.workedMinutes)} (${done}%)`}
                    >
                      {/*
                        법정 한도를 넘긴 사람을 "달성" 초록으로 칠하면 안 된다.
                        목표를 채운 것과 위법 소지가 같은 색이면 화면이
                        과로를 칭찬하는 셈이 된다.
                      */}
                      <span
                        className={
                          s.exceedsAvgWeeklyLimit
                            ? "fill over"
                            : done >= 100
                              ? "fill done"
                              : "fill"
                        }
                        style={{ width: `${done}%` }}
                      />
                      {expected > 0 && expected < 100 && (
                        <i className="tick" style={{ left: `${expected}%` }} />
                      )}
                    </div>
                    <div className="nums">
                      <span>
                        {hm(s.workedMinutes)} / {hm(s.targetMinutes)}
                      </span>
                      <span
                        className={s.exceedsAvgWeeklyLimit ? "over" : "none"}
                      >
                        {s.exceedsAvgWeeklyLimit
                          ? `주 평균 ${hm(s.avgWeeklyMinutes)} · 한도 초과`
                          : s.remainingMinutes === 0
                            ? "달성"
                            : `남음 ${hm(s.remainingMinutes)}`}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="empty" style={{ marginTop: 12 }}>
              눈금은 이번 정산기간에서 지난 영업일 비율입니다 — 거기쯤이면
              페이스대로입니다.
            </p>
          </section>

          <details className="fold" style={{ marginBottom: 14 }}>
            <summary>숫자로 보기</summary>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>이름</th>
                  <th>상태</th>
                  {/*
                    좁은 화면에서는 팀·소정근로를 접는다. 팀은 대체로 다 같고
                    소정근로는 사람마다 같은 값이라 판단에 안 쓰인다.
                    "확인 필요"가 화면 밖으로 밀리는 게 훨씬 나쁘다.
                  */}
                  <th className="hide-sm">팀</th>
                  <th>실근무</th>
                  <th className="hide-sm">소정근로</th>
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
                    <td className="none hide-sm">{r.teamName ?? "—"}</td>
                    <td>{hm(r.summary.workedMinutes)}</td>
                    <td className="none hide-sm">
                      {hm(r.summary.targetMinutes)}
                    </td>
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
          </div>
          </details>
        </>
      )}

    </main>
  );
}
