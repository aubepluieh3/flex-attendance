import Link from "next/link";
import { DateTime } from "luxon";
import { loadOrgRules } from "@/db/access";
import { listPeriods } from "@/db/close";
import { closeDateFor } from "@/lib/attendance/settle";
import { now } from "@/lib/clock";
import { requestViewer } from "../viewer";
import { closeDueAction, reopenPeriodAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PeriodsPage() {
  const viewer = await requestViewer();
  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;

  if (viewer.role !== "hr") {
    return (
      <main className="page">
        <div className="head">
          <h1>정산기간 관리</h1>
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
                  마감·재마감은 HR 권한이 필요합니다. 확정된 전 직원 근태가
                  바뀌는 작업입니다.
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

  const periods = await listPeriods(viewer.orgId);
  const asOf = now();
  const fmt = (d: Date | null) =>
    d ? DateTime.fromJSDate(d, { zone }).toFormat("M/d HH:mm") : "—";
  const day = (s: string) => DateTime.fromISO(s, { zone }).toFormat("M/d");

  return (
    <main className="page">
      <div className="head">
        <h1>정산기간 관리</h1>
        <span className="team">{rules.orgName}</span>
        <span className="chip">{viewer.name} · HR</span>
      </div>
      <p className="sub">
        정산기간이 끝나고 유예 {rules.closeGraceDays}일이 지나면 마감됩니다.
        <br />
        <span className="dim">
          마감된 기간의 숫자는 스냅샷으로 고정되어 규칙이 바뀌어도 흔들리지
          않습니다. 늦게 온 태그는 계속 받되 &quot;마감 후 변경&quot;으로
          표시됩니다.
        </span>
      </p>

      <section className="card">
        <h2>마감 실행</h2>
        <form action={closeDueAction}>
          <button type="submit">유예 지난 기간 마감하기</button>
        </form>
        <p className="empty" style={{ marginTop: 10 }}>
          평소에는 배치(<code>npm run db:close-periods</code>)로 하루 한 번
          돌립니다. 이 버튼은 같은 일을 지금 실행합니다.
        </p>
      </section>

      {periods.length === 0 ? (
        <section className="card">
          <p className="empty">아직 정산기간 기록이 없습니다.</p>
        </section>
      ) : (
        periods.map((p) => {
          const closesAt = closeDateFor(p.periodEnd, rules.closeGraceDays, zone);
          return (
            <section className="card" key={p.id}>
              <div className="day-head">
                <strong>
                  {day(p.periodStart)} ~ {day(p.periodEnd)}
                </strong>
                <span className="tag">
                  {p.status === "closed" ? "마감됨" : "열림"}
                </span>
                {p.status === "closed" ? (
                  <span className="day-sum">
                    {fmt(p.closedAt)} 마감 · 스냅샷 {p.snapshotCount}건
                  </span>
                ) : (
                  <span className="day-sum none">
                    마감 예정 {day(closesAt)} 이후
                    {p.reopenedAt && ` · ${fmt(p.reopenedAt)} 재마감됨`}
                  </span>
                )}
              </div>

              {p.status === "closed" && (
                <form action={reopenPeriodAction} className="adjust">
                  <input type="hidden" name="periodId" value={p.id} />
                  <label className="field grow">
                    <span>
                      재마감 사유<b> *</b>
                    </span>
                    <input
                      type="text"
                      name="reason"
                      required
                      placeholder="7/22 누락 태그 반영을 위해 다시 엽니다"
                    />
                  </label>
                  <button type="submit" className="pill">
                    재마감 (다시 열기)
                  </button>
                </form>
              )}

              {p.events.length > 0 && (
                <table style={{ marginTop: 14 }}>
                  <thead>
                    <tr>
                      <th>시각</th>
                      <th>동작</th>
                      <th>처리</th>
                      <th>사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.events.map((e, i) => (
                      <tr key={i}>
                        <td>{fmt(e.createdAt)}</td>
                        <td>{e.action === "close" ? "마감" : "재마감"}</td>
                        <td className="none">{e.actorName ?? "자동"}</td>
                        <td>{e.reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })
      )}

      <p className="empty" style={{ marginTop: 4 }}>
        기준 시각 {DateTime.fromJSDate(asOf, { zone }).toFormat("M월 d일 HH:mm")}
      </p>
    </main>
  );
}
