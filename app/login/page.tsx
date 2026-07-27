import { redirect } from "next/navigation";
import { optionalViewer } from "../viewer";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await optionalViewer()) redirect("/");

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

        <section className="card">
          <LoginForm />
        </section>

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
