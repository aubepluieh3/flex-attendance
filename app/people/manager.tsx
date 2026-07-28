"use client";

import { useActionState } from "react";
import { peopleAction, type PeopleState } from "./actions";
import type { PersonRow } from "@/db/people";

const ROLES = [
  ["member", "사원"],
  ["manager", "팀장"],
  ["hr", "HR"],
  ["executive", "임원"],
] as const;

type Team = { id: string; name: string; parentId: string | null };

export function PeopleManager({
  people,
  teams,
  viewerId,
}: {
  people: PersonRow[];
  teams: Team[];
  viewerId: string;
}) {
  const [state, action, pending] = useActionState<PeopleState, FormData>(
    peopleAction,
    {},
  );

  const teamOptions = (
    <>
      <option value="">(미배정)</option>
      {teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </>
  );

  return (
    <>
      {(state.error || state.message) && (
        <section className="card">
          <ul className="issues">
            <li>
              <span
                className={`icon ${state.error ? "crit" : "warn"}`}
                aria-hidden="true"
              >
                !
              </span>
              <span className="what">{state.error ?? state.message}</span>
            </li>
          </ul>
        </section>
      )}

      {state.secret && (
        <section className="card">
          <h2>임시 비밀번호</h2>
          <p className="sub" style={{ margin: "0 0 10px" }}>
            {state.secret.name} ({state.secret.employeeNo})
          </p>
          <div className="secret">{state.secret.password}</div>
          <p className="empty" style={{ marginTop: 10 }}>
            <b>지금 전달하세요.</b> 이 값은 어디에도 저장되지 않아 화면을 벗어나면
            다시 볼 수 없습니다. 놓치면 다시 초기화해야 합니다. 받은 사람은 로그인
            후 <code>내 계정</code>에서 비밀번호를 바꿔야 합니다.
          </p>
        </section>
      )}

      <section className="card">
        <h2>사용자 추가</h2>
        <form action={action} className="adjust">
          <input type="hidden" name="op" value="add" />
          <label className="field">
            <span>
              이름<b> *</b>
            </span>
            <input type="text" name="name" required placeholder="김도윤" />
          </label>
          <label className="field">
            <span>
              사번<b> *</b>
            </span>
            <input
              type="text"
              name="employeeNo"
              required
              placeholder="F2026-001"
            />
          </label>
          <label className="field">
            <span>이메일</span>
            <input type="email" name="email" placeholder="(선택)" />
          </label>
          <label className="field">
            <span>역할</span>
            <select name="role" defaultValue="member">
              {ROLES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>팀</span>
            <select name="teamId">{teamOptions}</select>
          </label>
          <button type="submit" disabled={pending}>
            추가
          </button>
        </form>
        <p className="empty" style={{ marginTop: 10 }}>
          사번은 근태 파일의 사번과 같아야 합니다. 다르면 그 사람의 태그가
          &quot;등록된 사용자가 없음&quot;으로 버려집니다.
        </p>
      </section>

      <section className="card">
        <h2>팀 추가</h2>
        <form action={action} className="adjust">
          <input type="hidden" name="op" value="addTeam" />
          <label className="field grow">
            <span>
              팀 이름<b> *</b>
            </span>
            <input type="text" name="name" required placeholder="플랫폼팀" />
          </label>
          <label className="field">
            <span>상위 팀</span>
            <select name="parentId">{teamOptions}</select>
          </label>
          <button type="submit" disabled={pending}>
            추가
          </button>
        </form>
      </section>

      <section className="card">
        <h2>사용자 {people.length}명</h2>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>사번</th>
                <th>이름</th>
                <th>팀</th>
                <th>역할</th>
                <th>상태</th>
                <th>세션</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
                  <td className="none">{p.employeeNo}</td>
                  <td>
                    {p.name}
                    {p.id === viewerId && <span className="tag">나</span>}
                  </td>
                  <td>
                    <form action={action} className="inline">
                      <input type="hidden" name="op" value="team" />
                      <input type="hidden" name="userId" value={p.id} />
                      <select
                        name="teamId"
                        defaultValue={p.teamId ?? ""}
                        onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      >
                        {teamOptions}
                      </select>
                    </form>
                  </td>
                  <td>
                    <form action={action} className="inline">
                      <input type="hidden" name="op" value="role" />
                      <input type="hidden" name="userId" value={p.id} />
                      <select
                        name="role"
                        defaultValue={p.role}
                        onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      >
                        {ROLES.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </form>
                  </td>
                  <td>
                    {p.active ? (
                      "활성"
                    ) : (
                      <span className="none">비활성</span>
                    )}
                    {!p.hasPassword && <span className="tag">로그인 불가</span>}
                  </td>
                  <td className="none">{p.sessionCount}</td>
                  <td>
                    <div className="row-actions">
                      {/*
                        본인 줄에는 초기화 버튼을 두지 않는다.
                        누르면 세션이 끊겨서 임시 비밀번호를 보기 전에 로그인
                        화면으로 튕기고, HR 이 스스로 잠긴다. 실제로 걸려봤다.
                      */}
                      {p.id === viewerId ? (
                        <span className="none" style={{ fontSize: 12 }}>
                          비밀번호는 내 계정에서 변경
                        </span>
                      ) : (
                        <form action={action} className="inline">
                          <input type="hidden" name="op" value="reset" />
                          <input type="hidden" name="userId" value={p.id} />
                          <input type="hidden" name="name" value={p.name} />
                          <input
                            type="hidden"
                            name="employeeNo"
                            value={p.employeeNo}
                          />
                          {/* 누르면 그 사람의 기존 비밀번호가 즉시 못 쓰게 된다 */}
                          <button
                            type="submit"
                            className="danger"
                            disabled={pending}
                          >
                            비밀번호 초기화
                          </button>
                        </form>
                      )}
                      {p.id !== viewerId && (
                        <form action={action} className="inline">
                          <input type="hidden" name="op" value="active" />
                          <input type="hidden" name="userId" value={p.id} />
                          <input
                            type="hidden"
                            name="active"
                            value={p.active ? "0" : "1"}
                          />
                          {/* 비활성화는 로그인을 막는다. 되살리는 건 그냥 부차 행동 */}
                          <button
                            type="submit"
                            className={p.active ? "danger" : "pill"}
                            disabled={pending}
                          >
                            {p.active ? "비활성화" : "활성화"}
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
