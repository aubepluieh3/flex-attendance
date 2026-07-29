import { redirect } from "next/navigation";
import Link from "next/link";
import { optionalViewer } from "../viewer";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";

/** 열린 리다이렉트를 막는다. 같은 앱 안의 경로만 허용한다. */
function safeNext(next: string | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; next?: string }>;
}) {
  const { reason, next } = await searchParams;
  if (await optionalViewer()) redirect(safeNext(next) ?? "/");

  const target = safeNext(next);

  return (
    <main className="auth">
      <div className="auth-box">
        <div className="auth-brand">
          <span className="mark" aria-hidden="true">
            F
          </span>
          flex-attendance
        </div>
        <p className="sub" style={{ marginBottom: 18 }}>
          자율 출근제 근무시간 관리
          <br />
          <span className="dim">사번과 비밀번호로 로그인합니다.</span>
        </p>

        {/*
          왜 이 화면에 왔는지는 폼이 말한다 (app/login/form.tsx).
          로그인 실패 메시지와 서로를 부정하지 않게 한 곳에 모았다.

          reason 이 없으면 처음 온 사람이거나 로그아웃한 사람이다 — 만료를
          말하지 않는다. requestViewer() 가 쿠키 유무로 갈라서 넘긴다.
        */}
        <LoginForm next={target} expired={reason === "expired"} />

        {/* 처음 온 사람은 이게 무슨 앱인지부터 알아야 한다 */}
        <p className="empty" style={{ marginTop: 14 }}>
          <Link href="/intro">자율 출근제가 이 앱에서 어떻게 되는지 보기</Link>
        </p>

        {process.env.NODE_ENV !== "production" && (
          <p className="empty" style={{ lineHeight: 1.9 }}>
            개발용 계정 — 비밀번호는 모두 <code>flex-demo-1234</code>
            <br />
            <code>F2019-041</code> 사원 · <code>F2016-008</code> 팀장 ·{" "}
            <code>F2014-002</code> HR · <code>F2009-001</code> 임원
          </p>
        )}
      </div>
    </main>
  );
}
