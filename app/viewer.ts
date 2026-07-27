import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, resolveSession } from "@/db/auth";
import type { Viewer } from "@/db/access";

/**
 * 요청에서 현재 사용자를 정한다.
 *
 * 세션이 없거나 만료됐으면 로그인으로 보낸다. 이때 이유(expired)와 원래 가려던
 * 곳(next)을 함께 넘긴다 — 아무 설명 없이 빈 로그인 화면이 나오면 사용자는
 * 자기가 뭘 잘못했는지 모르고, 하던 일로 돌아갈 방법도 없다.
 *
 * 권한 로직(db/access.ts)은 여기서 얻은 Viewer 를 그대로 쓴다. SSO 로 바꿔도
 * 이 파일만 바뀐다.
 */
export async function requestViewer(nextPath?: string): Promise<Viewer> {
  const viewer = await optionalViewer();
  if (viewer) return viewer;

  const params = new URLSearchParams({ reason: "expired" });
  if (nextPath) params.set("next", nextPath);
  redirect(`/login?${params.toString()}`);
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
