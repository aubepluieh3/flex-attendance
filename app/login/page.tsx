import { redirect } from "next/navigation";
import { optionalViewer } from "../viewer";
import { LoginForm } from "./form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await optionalViewer()) redirect("/");

  return (
    <main className="page" style={{ maxWidth: 420, paddingTop: 64 }}>
      <div className="head">
        <h1>flex-attendance</h1>
      </div>
      <p className="sub">
        사번과 비밀번호로 로그인합니다.
        <br />
        <span className="dim">자율 출근제 근무시간 관리</span>
      </p>

      <section className="card">
        <LoginForm />
      </section>

      {process.env.NODE_ENV !== "production" && (
        <p className="empty">
          개발용 계정: <code>F2019-041</code>(사원) · <code>F2016-008</code>(팀장)
          · <code>F2014-002</code>(HR) — 비밀번호는 모두{" "}
          <code>flex-demo-1234</code>
        </p>
      )}
    </main>
  );
}
