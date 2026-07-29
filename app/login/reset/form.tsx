"use client";

import { useActionState } from "react";
import { resetRequestAction, type ResetState } from "./actions";

export function ResetRequestForm() {
  const [state, action, pending] = useActionState<ResetState, FormData>(
    resetRequestAction,
    {},
  );

  // 성공하면 폼을 다시 보여주지 않는다 — 같은 요청을 반복해서 누를 이유가 없다
  if (state.message) {
    return (
      <section className="card">
        <ul className="issues">
          <li>
            <span className="icon warn" aria-hidden="true">
              !
            </span>
            <span>
              <span className="what">요청을 접수했습니다</span>
              <br />
              <span className="why">{state.message}</span>
            </span>
          </li>
        </ul>
      </section>
    );
  }

  return (
    <section className="card">
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
        </div>

        {state.error && (
          <ul className="issues" style={{ marginTop: 14 }}>
            <li>
              <span className="icon crit" aria-hidden="true">
                !
              </span>
              <span className="what">{state.error}</span>
            </li>
          </ul>
        )}

        <div style={{ marginTop: 16 }}>
          <button type="submit" disabled={pending}>
            {pending ? "남기는 중…" : "재설정 요청"}
          </button>
        </div>
      </form>
    </section>
  );
}
