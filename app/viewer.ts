import { cookies } from "next/headers";
import { currentViewer, type Viewer } from "@/db/access";

export const DEMO_USER_COOKIE = "demo_user";

/**
 * 요청에서 현재 사용자를 정한다.
 *
 * 인증이 없으므로 데모 계정 선택(쿠키)으로 대체한다. SSO가 붙으면 이 파일만
 * 바뀌고 db/access.ts 의 권한 로직은 그대로 쓴다.
 */
export async function requestViewer(): Promise<Viewer> {
  const jar = await cookies();
  return currentViewer(jar.get(DEMO_USER_COOKIE)?.value);
}
