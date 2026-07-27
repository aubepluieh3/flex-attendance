import type { Metadata } from "next";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
