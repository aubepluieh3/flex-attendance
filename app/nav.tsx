"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 사이드바 메뉴.
 *
 * 역할이 못 쓰는 메뉴는 아예 보여주지 않는다 — 눌러서 거부당하는 건 나쁜 경험이다.
 * 다만 메뉴를 숨기는 건 보안이 아니다. 실제 차단은 각 화면과 db/access.ts 가 한다.
 *
 * 현재 위치 표시가 필요해서 클라이언트 컴포넌트다 (usePathname).
 */
const MENU = [
  { href: "/", label: "내 근무시간", roles: ["member", "manager", "hr", "executive"] },
  { href: "/records", label: "내 기록 · 보정", roles: ["member", "manager", "hr", "executive"] },
  { href: "/notifications", label: "알림", roles: ["member", "manager", "hr", "executive"] },
  { href: "/team", label: "팀 현황", roles: ["manager", "hr"] },
  { href: "/report", label: "전사 집계", roles: ["hr", "executive"] },
  { href: "/import", label: "근태 파일 반영", roles: ["hr"] },
  { href: "/periods", label: "정산기간", roles: ["hr"] },
  { href: "/settings", label: "근태 설정", roles: ["hr"] },
  { href: "/people", label: "사용자", roles: ["hr"] },
] as const;

/**
 * 배지는 "확인할 항목 수"다. 읽어서 줄지 않고 고쳐야 줄어든다.
 *
 * 색과 숫자의 역할을 나눈다 — 숫자는 개수, 색은 심각도. 개수를 늘 빨갛게
 * 칠하면 며칠 남아 있는 개수가 그것만으로 압박이 된다.
 */
export function Nav({
  role,
  openItems,
  critical,
}: {
  role: string;
  openItems: number;
  critical: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav className="nav">
      {MENU.filter((m) => (m.roles as readonly string[]).includes(role)).map(
        (m) => {
          const active =
            m.href === "/" ? pathname === "/" : pathname.startsWith(m.href);
          return (
            <Link
              key={m.href}
              href={m.href}
              aria-current={active ? "page" : undefined}
            >
              {m.label}
              {m.href === "/notifications" && openItems > 0 && (
                <span
                  className={critical ? "badge crit" : "badge plain"}
                  aria-label={`확인할 항목 ${openItems}건`}
                >
                  {openItems}
                </span>
              )}
            </Link>
          );
        },
      )}
    </nav>
  );
}
