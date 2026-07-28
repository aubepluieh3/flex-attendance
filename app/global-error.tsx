"use client";

import "./globals.css";

/**
 * 렌더 중 터진 오류의 마지막 그물.
 *
 * 이게 없으면 Next 의 기본 오류 화면이 뜨고, 프로덕션에서는 메시지가 가려져서
 * 사용자는 흰 화면에 영어 한 줄을 본다. 근태를 확인하러 온 사람에게
 * "무엇을 하면 되는지"는 말해줘야 한다.
 *
 * digest 는 서버 로그와 짝을 맞추는 값이다. 메시지 자체는 보여주지 않는다 —
 * 내부 구조나 값이 새어나갈 수 있다.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ko">
      <body>
        <main className="auth">
          <div className="auth-box">
            <div className="auth-brand">
              <span className="mark" aria-hidden="true">
                F
              </span>
              flex-attendance
            </div>
            <section className="card">
              <ul className="issues">
                <li>
                  <span className="icon crit" aria-hidden="true">
                    !
                  </span>
                  <span>
                    <span className="what">화면을 열지 못했습니다</span>
                    <br />
                    <span className="why">
                      근무 기록은 그대로 있습니다. 잠시 뒤 다시 시도해 주세요.
                      계속 안 되면 HR에 알려주세요.
                    </span>
                  </span>
                </li>
              </ul>
              <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
                <button type="button" onClick={reset}>
                  다시 시도
                </button>
                <a className="pill button-link" href="/">
                  내 근무시간으로
                </a>
              </div>
              {error.digest && (
                <p className="empty" style={{ marginTop: 14 }}>
                  HR에 알릴 때 이 번호를 함께 알려주세요:{" "}
                  <code>{error.digest}</code>
                </p>
              )}
            </section>
          </div>
        </main>
      </body>
    </html>
  );
}
