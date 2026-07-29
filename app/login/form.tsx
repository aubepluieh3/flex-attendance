"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

/**
 * 로그인 폼.
 *
 * "왜 이 화면에 왔는지"(reason)를 함께 렌더한다. 서버 컴포넌트에 두면
 * 로그인을 실패했을 때 만료 안내와 실패 안내가 같이 떠서 서로를 부정한다 —
 * "비밀번호가 틀린 것이 아닙니다" 와 "비밀번호가 올바르지 않습니다" 가
 * 한 화면에 있었다. 실패 메시지가 생기면 만료 안내는 물러난다.
 */
export function LoginForm({
  next,
  expired,
}: {
  next: string | null;
  expired: boolean;
}) {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {},
  );

  return (
    <>
      {expired && !state.message && (
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
                  {next ? " 보던 화면으로 돌아갑니다." : " 계속 이용할 수 있습니다."}
                </span>
              </span>
            </li>
          </ul>
        </section>
      )}

      <section className="card">
        <form action={action}>
          {next && <input type="hidden" name="next" value={next} />}
          <div className="fields">
            <label className="field">
              <span>사번</span>
              {/*
                실패해도 사번은 남긴다. React 가 액션 후 폼을 초기화하면서
                defaultValue 로 되돌리므로, 돌려받은 값을 여기 넣으면 유지된다.
              */}
              <input
                type="text"
                name="employeeNo"
                required
                autoComplete="username"
                autoFocus
                placeholder="F2019-041"
                defaultValue={state.employeeNo ?? ""}
              />
            </label>
            <label className="field">
              <span>비밀번호</span>
              <input
                type="password"
                name="password"
                required
                autoComplete="current-password"
              />
            </label>
          </div>

          {state.message && (
            <ul className="issues" style={{ marginTop: 14 }}>
              <li>
                <span className="icon crit" aria-hidden="true">
                  !
                </span>
                <span>
                  <span className="what">{state.message}</span>
                  <br />
                  {/*
                    막힌 사람에게 다음 행동을 준다. 셀프서비스 재설정 화면은
                    없다 (메일 발송 수단이 없고, 드문 상황에 상시 공격면을
                    여는 셈이 된다) — 그래서 사람에게 보낸다.
                  */}
                  <span className="why">
                    비밀번호를 잊었다면 HR에 초기화를 요청하세요. 이 화면에서
                    직접 재설정할 수는 없습니다.
                  </span>
                </span>
              </li>
            </ul>
          )}

          <div style={{ marginTop: 16 }}>
            <button type="submit" disabled={pending}>
              {pending ? "확인 중…" : "로그인"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
