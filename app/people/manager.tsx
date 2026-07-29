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

/** 비밀번호 재설정 요청 한 건 */
type ResetRequest = {
  id: string;
  userId: string;
  name: string;
  employeeNo: string;
  waited: string;
};

export function PeopleManager({
  people,
  teams,
  viewerId,
  resetRequests,
}: {
  people: PersonRow[];
  teams: Team[];
  viewerId: string;
  resetRequests: ResetRequest[];
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

      {/*
        비밀번호 재설정 요청.
        맨 위에 둔다 — 요청한 사람은 그동안 앱을 아예 쓸 수 없다. 사용자 목록
        아래에 두면 HR 이 스크롤하지 않아서 요청이 며칠씩 방치된다.
      */}
      {resetRequests.length > 0 && (
        <section className="card">
          <h2>비밀번호 재설정 요청 {resetRequests.length}건</h2>
          <p className="sub" style={{ margin: "0 0 10px" }}>
            <span className="dim">
              로그인하지 못하는 사람이 남긴 요청입니다. 초기화하면 임시
              비밀번호가 한 번 표시되니 사내에서 직접 전달하세요.
            </span>
          </p>
          <ul className="issues">
            {resetRequests.map((r) => (
              <li key={r.id}>
                <span className="icon warn" aria-hidden="true">
                  !
                </span>
                <span>
                  <span className="what">
                    {r.name} · {r.employeeNo}
                  </span>{" "}
                  <span className="dim">{r.waited}</span>
                  <br />
                  {/*
                    초기화는 사용자 목록의 그것과 같은 일을 한다 — 기존 비밀번호가
                    즉시 못 쓰게 되고 로그인이 전부 끊긴다. 요청이 있다는 것만으로
                    한 번의 클릭으로 실행되게 두면, 목록 쪽에 게이트를 둔 이유가
                    무의미해진다. 같은 게이트를 쓴다.
                  */}
                  <details className="confirm">
                    <summary>비밀번호 초기화…</summary>
                    <div className="box">
                      <span className="why">
                        {r.name} 의 기존 비밀번호가 즉시 못 쓰게 되고 로그인도
                        모두 끊깁니다. 임시 비밀번호는 <b>이 화면에 한 번만</b>{" "}
                        보이니 바로 전달해야 합니다.
                      </span>
                      <form action={action} className="inline">
                        <input type="hidden" name="op" value="reset" />
                        <input type="hidden" name="userId" value={r.userId} />
                        <input type="hidden" name="name" value={r.name} />
                        <input
                          type="hidden"
                          name="employeeNo"
                          value={r.employeeNo}
                        />
                        <button
                          type="submit"
                          className="danger"
                          disabled={pending}
                        >
                          네, 초기화합니다
                        </button>
                      </form>
                    </div>
                  </details>
                  {/* 무시는 되돌릴 수 있다 — 그 사람이 다시 요청하면 새로 올라온다 */}
                  <form action={action} className="inline">
                    <input type="hidden" name="op" value="dismissReset" />
                    <input type="hidden" name="requestId" value={r.id} />
                    <button type="submit" disabled={pending}>
                      무시
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
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
                <th>재직기간</th>
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
                  {/*
                    재직기간. 이 값이 개인 집계·적용기간을 정한다 — 조직 기간과
                    교집합을 낸 구간으로 소정근로와 52시간 분모가 계산된다.
                    비워두면 기간 전체를 재직으로 본다.
                  */}
                  <td>
                    <form action={action} className="inline">
                      <input type="hidden" name="op" value="employment" />
                      <input type="hidden" name="userId" value={p.id} />
                      <input
                        type="date"
                        name="hiredAt"
                        defaultValue={p.hiredAt ?? ""}
                        aria-label={`${p.name} 입사일`}
                      />
                      <span className="dim"> ~ </span>
                      <input
                        type="date"
                        name="resignedAt"
                        defaultValue={p.resignedAt ?? ""}
                        aria-label={`${p.name} 퇴사일`}
                      />
                      <button type="submit">저장</button>
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
                        <details className="confirm">
                          <summary>비밀번호 초기화…</summary>
                          <div className="box">
                            <span className="why">
                              {p.name} 의 기존 비밀번호가 즉시 못 쓰게 되고
                              로그인도 모두 끊깁니다. 임시 비밀번호는{" "}
                              <b>이 화면에 한 번만</b> 보이니 바로 전달해야
                              합니다.
                            </span>
                            <form action={action} className="inline">
                              <input type="hidden" name="op" value="reset" />
                              <input type="hidden" name="userId" value={p.id} />
                              <input type="hidden" name="name" value={p.name} />
                              <input
                                type="hidden"
                                name="employeeNo"
                                value={p.employeeNo}
                              />
                              <button
                                type="submit"
                                className="danger"
                                disabled={pending}
                              >
                                네, 초기화합니다
                              </button>
                            </form>
                          </div>
                        </details>
                      )}
                      {p.id !== viewerId &&
                        (p.active ? (
                          /*
                            비활성화는 그 사람을 그 순간 쫓아낸다.
                            한 번의 클릭으로 실행되면 안 된다 — 걷다가
                            실수로 눌러서 실제로 쫓아냈다.
                          */
                          <details className="confirm">
                            <summary>비활성화…</summary>
                            <div className="box">
                              <span className="why">
                                {p.name}({p.employeeNo}) 은 즉시 로그인할 수
                                없게 되고 열려 있는 세션도 끊깁니다. 근무 기록은
                                지워지지 않습니다.
                              </span>
                              <form action={action} className="inline">
                                <input type="hidden" name="op" value="active" />
                                <input type="hidden" name="userId" value={p.id} />
                                <input type="hidden" name="active" value="0" />
                                <button
                                  type="submit"
                                  className="danger"
                                  disabled={pending}
                                >
                                  네, 비활성화합니다
                                </button>
                              </form>
                            </div>
                          </details>
                        ) : (
                          <form action={action} className="inline">
                            <input type="hidden" name="op" value="active" />
                            <input type="hidden" name="userId" value={p.id} />
                            <input type="hidden" name="active" value="1" />
                            {/* 되살리는 건 부차 행동이라 확인이 필요 없다 */}
                            <button
                              type="submit"
                              className="pill"
                              disabled={pending}
                            >
                              활성화
                            </button>
                          </form>
                        ))}
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
