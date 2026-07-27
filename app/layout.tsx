import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { optionalViewer } from "./viewer";
import { logoutAction } from "./login/actions";
import { unreadCount } from "@/db/notify";

export const metadata: Metadata = {
  title: "내 근무시간 — flex-attendance",
  description: "자율 출근제 근무시간 대시보드",
};

const ROLE_LABEL = {
  member: "사원",
  manager: "팀장",
  hr: "HR",
  executive: "임원",
} as const;

/**
 * 역할이 못 쓰는 메뉴는 아예 보여주지 않는다. 눌러서 거부당하는 건 나쁜 경험이다.
 * 실제 차단은 각 화면과 db/access.ts 가 한다 — 메뉴를 숨기는 건 보안이 아니다.
 */
const MENU = [
  { href: "/", label: "내 근무시간", roles: ["member", "manager", "hr", "executive"] },
  { href: "/records", label: "내 기록 · 보정", roles: ["member", "manager", "hr", "executive"] },
  { href: "/team", label: "팀 현황", roles: ["manager", "hr"] },
  { href: "/report", label: "전사 집계", roles: ["hr", "executive"] },
  { href: "/import", label: "근태 파일 반영", roles: ["hr"] },
  { href: "/periods", label: "정산기간", roles: ["hr"] },
  { href: "/settings", label: "설정", roles: ["hr"] },
  { href: "/people", label: "사용자", roles: ["hr"] },
] as const;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await optionalViewer();
  const unread = viewer ? await unreadCount(viewer) : 0;

  return (
    <html lang="ko">
      <body>
        {viewer && (
          <nav className="topbar">
            <div className="topbar-inner">
              {MENU.filter((m) =>
                (m.roles as readonly string[]).includes(viewer.role),
              ).map((m) => (
                <Link key={m.href} href={m.href}>
                  {m.label}
                </Link>
              ))}
              <Link href="/notifications">
                알림
                {unread > 0 && <span className="badge"> {unread} </span>}
              </Link>
              <Link href="/account" className="whoami">
                {viewer.name} · {ROLE_LABEL[viewer.role]}
              </Link>
              <form action={logoutAction}>
                <button type="submit" className="pill">
                  로그아웃
                </button>
              </form>
            </div>
          </nav>
        )}
        {children}
      </body>
    </html>
  );
}
