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
          왜 로그인 화면에 왔는지 말해준다. 설명이 없으면 사용자는 비밀번호가
          틀렸는지 계정이 잠겼는지 알 수 없고, 앱이 고장 났다고 생각한다.
        */}
        {reason === "expired" && (
          <section className="card" style={{ marginBottom: 12 }}>
            <ul className="issues">
              <li>
                <span className="icon warn" aria-hidden="true">
                  !
                </span>
                <span>
                  <span className="what">로그인이 만료되었습니다</span>
                  <br />
                  <span className="why">
                    비밀번호가 틀린 것이 아닙니다. 다시 로그인하면
                    {target ? " 보던 화면으로 돌아갑니다." : " 계속 이용할 수 있습니다."}
                  </span>
                </span>
              </li>
            </ul>
          </section>
        )}

        <section className="card">
          <LoginForm next={target} />
        </section>

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
