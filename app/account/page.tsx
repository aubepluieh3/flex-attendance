import { requestViewer } from "../viewer";
import { PasswordForm } from "./form";

export const dynamic = "force-dynamic";

const ROLE_LABEL = {
  member: "사원",
  manager: "팀장",
  hr: "HR",
  executive: "임원",
} as const;

export default async function AccountPage() {
  const viewer = await requestViewer();

  return (
    <main className="page" style={{ maxWidth: 560 }}>
      <div className="head">
        <h1>내 계정</h1>
        <span className="team">
          {viewer.name} · {ROLE_LABEL[viewer.role]}
        </span>
      </div>
      <p className="sub">
        {viewer.teamName ?? "미배정"}
        <br />
        <span className="dim">
          임시 비밀번호를 받았다면 여기서 바꿔 주세요. 바꾸면 다른 기기의 로그인은
          끊깁니다.
        </span>
      </p>
      <section className="card">
        <h2>비밀번호 변경</h2>
        <PasswordForm />
      </section>
    </main>
  );
}
