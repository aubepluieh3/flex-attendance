import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { optionalViewer } from "./viewer";
import { logoutAction } from "./login/actions";
import { after } from "next/server";
import { syncIfStale, unreadCount } from "@/db/notify";
import { closeDueIfStale } from "@/db/close";
import { now } from "@/lib/clock";
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

  /*
   * 앱을 열 때 마감과 알림을 맞춘다.
   *
   * after() 로 응답 뒤에 돌린다 — 기다리면 페이지가 그만큼 늦게 뜨고,
   * 마감은 사람마다 스냅샷을 쓰므로 200명이면 몇 초가 걸린다.
   * 이번 화면은 한 번 낡을 수 있고 다음 이동에서 맞는다.
   *
   * 마감을 먼저 부른다 — 알림에는 "마감 임박"과 "마감 후 변경"이 있어서
   * 마감 상태가 정해진 뒤에 계산해야 맞는 값이 나온다.
   *
   * 쓰기 액션은 이걸 믿지 않고 각자 앞에서 await 한다. 응답 뒤에 도는 것으로는
   * "쓰기 전에 닫혔음"을 보장할 수 없다.
   */
  if (viewer) {
    after(async () => {
      const at = now();
      await closeDueIfStale(viewer.orgId, at);
      await syncIfStale(viewer.orgId, at);
    });
  }

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
