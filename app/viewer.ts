import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, resolveSession } from "@/db/auth";
import type { Viewer } from "@/db/access";

/**
 * 요청에서 현재 사용자를 정한다.
 *
 * 세션이 없거나 만료됐으면 로그인으로 보낸다. 이때 이유와 원래 가려던
 * 곳(next)을 함께 넘긴다 — 아무 설명 없이 빈 로그인 화면이 나오면 사용자는
 * 자기가 뭘 잘못했는지 모르고, 하던 일로 돌아갈 방법도 없다.
 *
 * 이유를 **쿠키 유무로 가른다.** 쿠키가 아예 없으면 처음 온 사람이거나
 * 로그아웃한 사람이다. 그런 사람에게 "로그인이 만료되었습니다"라고 하면
 * 있지도 않은 세션이 끊긴 것처럼 읽히고, 앱을 처음 켠 사람은 자기가 뭘
 * 잘못했다고 생각한다. 만료는 쿠키가 있는데 세션이 죽었을 때만이다.
 *
 * 권한 로직(db/access.ts)은 여기서 얻은 Viewer 를 그대로 쓴다. SSO 로 바꿔도
 * 이 파일만 바뀐다.
 */
export async function requestViewer(nextPath?: string): Promise<Viewer> {
  const viewer = await optionalViewer();
  if (viewer) return viewer;

  const hadCookie = Boolean((await cookies()).get(SESSION_COOKIE)?.value);
  const params = new URLSearchParams();
  if (hadCookie) params.set("reason", "expired");
  if (nextPath) params.set("next", nextPath);
  const qs = params.toString();
  redirect(qs ? `/login?${qs}` : "/login");
}

/** 로그인 화면처럼 비로그인 상태를 허용하는 곳에서 쓴다 */
export async function optionalViewer(): Promise<Viewer | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const session = await resolveSession(token);
  if (!session) return null;

  // 쓰는 동안 세션이 연장됐으면 쿠키 만료도 같이 늘린다.
  // 안 늘리면 서버 세션은 살아 있는데 브라우저가 쿠키를 버려서 끊긴다.
  if (session.renewedUntil && token) {
    try {
      jar.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        expires: session.renewedUntil,
      });
    } catch {
      // 렌더 단계에서는 쿠키를 쓸 수 없다. 서버 세션은 이미 연장됐으므로
      // 다음 액션·라우트 요청에서 쿠키가 갱신된다.
    }
  }

  return session.viewer;
}
