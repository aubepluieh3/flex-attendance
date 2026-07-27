import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, viewerFromToken } from "@/db/auth";
import type { Viewer } from "@/db/access";

/**
 * 요청에서 현재 사용자를 정한다.
 *
 * 세션이 없거나 만료됐으면 로그인으로 보낸다. 권한 로직(db/access.ts)은
 * 여기서 얻은 Viewer 를 그대로 쓴다 — SSO 로 바꿔도 이 파일만 바뀐다.
 */
export async function requestViewer(): Promise<Viewer> {
  const viewer = await optionalViewer();
  if (!viewer) redirect("/login");
  return viewer;
}

/** 로그인 화면처럼 비로그인 상태를 허용하는 곳에서 쓴다 */
export async function optionalViewer(): Promise<Viewer | null> {
  const jar = await cookies();
  return viewerFromToken(jar.get(SESSION_COOKIE)?.value);
}
