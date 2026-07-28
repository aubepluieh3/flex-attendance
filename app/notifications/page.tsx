import Link from "next/link";
import { DateTime } from "luxon";
import { loadOrgRules } from "@/db/access";
import { listNotifications, syncIfStale } from "@/db/notify";
import { now } from "@/lib/clock";
import { requestViewer } from "../viewer";

export const dynamic = "force-dynamic";

const KIND_TONE: Record<string, "warn" | "crit"> = {
  incomplete_day: "warn",
  rule_violation: "warn",
  legal_limit: "crit",
  period_closing: "warn",
  post_close_change: "crit",
  team_review: "warn",
  time_off_pending: "warn",
  time_off_decided: "warn",
};

export default async function NotificationsPage() {
  const viewer = await requestViewer("/notifications");
  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;

  /*
   * 여기서는 기다린다. 알림을 보러 들어온 화면이 낡은 목록을 보여주면
   * 그게 이 화면의 유일한 일을 못 한 것이다.
   */
  await syncIfStale(viewer.orgId, now());
  const rows = await listNotifications(viewer);

  return (
    <main className="page">
      <div className="head">
        <h1>알림</h1>
        {rows.length > 0 && (
          <span className="chip">확인할 항목 {rows.length}건</span>
        )}
      </div>
      <p className="sub">
        확인이 필요한 항목이 여기 모입니다.
        <br />
        {/*
          읽음 처리가 없다는 것을 먼저 말해준다. 없으면 사용자가 "지우는
          버튼이 어디 있지"를 찾다가 못 찾는다.
        */}
        <span className="dim">
          이 화면을 열 때 다시 계산합니다. 읽음 표시는 없습니다 — 해결하면
          목록에서 저절로 사라집니다.
        </span>
      </p>

      {rows.length === 0 ? (
        <section className="card">
          <p className="empty">확인할 항목이 없습니다.</p>
        </section>
      ) : (
        <section className="card">
          <ul className="issues">
            {rows.map((n) => (
              <li key={n.id}>
                <span
                  className={`icon ${KIND_TONE[n.kind] ?? "warn"}`}
                  aria-hidden="true"
                >
                  !
                </span>
                <span>
                  <span className="what">
                    <Link href={n.href}>{n.title}</Link>
                  </span>
                  <br />
                  <span className="why">{n.body}</span>
                  <br />
                  <span className="empty" style={{ fontSize: 12 }}>
                    {DateTime.fromJSDate(n.createdAt, { zone }).toFormat(
                      "M월 d일 HH:mm",
                    )}
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
