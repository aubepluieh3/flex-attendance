"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {},
  );

  return (
    <form action={action}>
      <div className="fields">
        <label className="field">
          <span>사번</span>
          <input
            type="text"
            name="employeeNo"
            required
            autoComplete="username"
            autoFocus
            placeholder="F2019-041"
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
            <span className="what">{state.message}</span>
          </li>
        </ul>
      )}

      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={pending}>
          {pending ? "확인 중…" : "로그인"}
        </button>
      </div>
    </form>
  );
}
