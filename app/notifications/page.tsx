import Link from "next/link";
import { DateTime } from "luxon";
import { loadOrgRules } from "@/db/access";
import { listNotifications, markAllRead } from "@/db/notify";
import { requestViewer } from "../viewer";

export const dynamic = "force-dynamic";

const KIND_TONE: Record<string, "warn" | "crit"> = {
  incomplete_day: "warn",
  rule_violation: "warn",
  legal_limit: "crit",
  period_closing: "warn",
  post_close_change: "crit",
  team_review: "warn",
};

export default async function NotificationsPage() {
  const viewer = await requestViewer();
  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;
  const rows = await listNotifications(viewer);
  const unread = rows.filter((r) => !r.readAt).length;

  async function readAll() {
    "use server";
    const v = await requestViewer();
    await markAllRead(v);
  }

  return (
    <main className="page">
      <div className="head">
        <h1>알림</h1>
        {unread > 0 && <span className="chip">읽지 않음 {unread}건</span>}
      </div>
      <p className="sub">
        확인이 필요한 항목이 여기 모입니다.
        <br />
        <span className="dim">
          근태 기록은 파일로 들어오므로 실시간 알림은 없습니다. 파일이 반영되거나
          기록을 보정할 때 다시 계산됩니다. 해결하면 목록에서 사라집니다.
        </span>
      </p>

      {rows.length === 0 ? (
        <section className="card">
          <p className="empty">확인할 항목이 없습니다.</p>
        </section>
      ) : (
        <>
          {unread > 0 && (
            <form action={readAll} style={{ marginBottom: 12 }}>
              <button type="submit" className="pill">
                모두 읽음으로 표시
              </button>
            </form>
          )}
          <section className="card">
            <ul className="issues">
              {rows.map((n) => (
                <li key={n.id} style={{ opacity: n.readAt ? 0.55 : 1 }}>
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
                      {n.readAt ? " · 읽음" : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
