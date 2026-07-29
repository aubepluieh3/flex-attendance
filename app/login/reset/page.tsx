import Link from "next/link";
import { redirect } from "next/navigation";
import { optionalViewer } from "../../viewer";
import { ResetRequestForm } from "./form";

export const dynamic = "force-dynamic";

/**
 * 비밀번호 재설정 요청 화면.
 *
 * 자동 발송이 아니라 HR 이 처리하는 이유는 db/reset-requests.ts 상단에 있다.
 * 요약하면 — 메일 발송 수단이 없고, 사번만으로 즉시 재설정하게 하면
 * 사번을 아는 누구나 남의 계정을 초기화할 수 있다.
 */
export default async function ResetRequestPage() {
  // 이미 로그인했으면 여기 올 이유가 없다. 내 계정에서 직접 바꾸면 된다.
  if (await optionalViewer()) redirect("/account");

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
          비밀번호 재설정 요청
          <br />
          <span className="dim">
            사번을 남기면 HR이 임시 비밀번호를 발급해 사내에서 전달합니다.
            이 화면에서 바로 재설정되지는 않습니다.
          </span>
        </p>

        <ResetRequestForm />

        <p className="empty" style={{ marginTop: 14 }}>
          <Link href="/login">로그인으로 돌아가기</Link>
        </p>
        <p className="empty">
          비밀번호를 아는데 바꾸고 싶은 것뿐이라면 로그인한 뒤{" "}
          <strong>내 계정</strong>에서 바꾸면 됩니다.
        </p>
      </div>
    </main>
  );
}
