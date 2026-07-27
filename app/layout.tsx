import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { optionalViewer } from "./viewer";
import { logoutAction } from "./login/actions";
import { unreadCount } from "@/db/notify";
import { Nav } from "./nav";

export const metadata: Metadata = {
  title: "flex-attendance — 자율 출근제",
  description: "자율 출근제 근무시간 관리",
};

const ROLE_LABEL = {
  member: "사원",
  manager: "팀장",
  hr: "HR",
  executive: "임원",
} as const;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await optionalViewer();
  const unread = viewer ? await unreadCount(viewer) : 0;

  // 로그인 전에는 사이드바를 두지 않는다
  if (!viewer) {
    return (
      <html lang="ko">
        <body>{children}</body>
      </html>
    );
  }

  return (
    <html lang="ko">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <Link href="/" className="brand">
              <span className="mark" aria-hidden="true">
                F
              </span>
              flex-attendance
            </Link>

            <Nav role={viewer.role} unread={unread} />

            <div className="sidebar-foot">
              <Link href="/account" className="whoami">
                <b>{viewer.name}</b>
                <span className="role">
                  {ROLE_LABEL[viewer.role]}
                  {viewer.teamName ? ` · ${viewer.teamName}` : ""}
                </span>
              </Link>
              <form action={logoutAction}>
                <button type="submit" className="pill">
                  로그아웃
                </button>
              </form>
            </div>
          </aside>

          <div>{children}</div>
        </div>
      </body>
    </html>
  );
}
