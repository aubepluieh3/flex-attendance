"use client";

import { useActionState } from "react";
import { changePasswordAction, type AccountState } from "./actions";

export function PasswordForm() {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    changePasswordAction,
    {},
  );

  return (
    <form action={action}>
      <div className="fields">
        <label className="field">
          <span>현재 비밀번호</span>
          <input type="password" name="current" required autoComplete="current-password" />
        </label>
        <label className="field">
          <span>새 비밀번호 (8자 이상)</span>
          <input type="password" name="next" required minLength={8} autoComplete="new-password" />
        </label>
        <label className="field">
          <span>새 비밀번호 확인</span>
          <input type="password" name="confirm" required minLength={8} autoComplete="new-password" />
        </label>
      </div>

      {(state.error || state.message) && (
        <ul className="issues" style={{ marginTop: 14 }}>
          <li>
            <span className={`icon ${state.error ? "crit" : "warn"}`} aria-hidden="true">!</span>
            <span className="what">{state.error ?? state.message}</span>
          </li>
        </ul>
      )}

      <div style={{ marginTop: 16 }}>
        <button type="submit" disabled={pending}>
          {pending ? "변경 중…" : "비밀번호 변경"}
        </button>
      </div>
    </form>
  );
}
