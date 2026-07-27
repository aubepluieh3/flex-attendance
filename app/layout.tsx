import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { UserSwitcher } from "./user-switcher";

export const metadata: Metadata = {
  title: "내 근무시간 — flex-attendance",
  description: "자율 출근제 근무시간 대시보드",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <nav className="topbar">
          <div className="topbar-inner">
            <Link href="/">내 근무시간</Link>
            <Link href="/records">내 기록 · 보정</Link>
            <Link href="/import">근태 파일 반영</Link>
            <Link href="/periods">정산기간</Link>
            <UserSwitcher />
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
