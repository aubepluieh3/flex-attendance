"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { login, logout, SESSION_COOKIE } from "@/db/auth";

export type LoginState = {
  message?: string;
  /**
   * 실패했을 때 사번을 되돌려준다.
   *
   * React 는 서버 액션이 끝나면 폼을 초기화하므로, 안 돌려주면 비밀번호만
   * 틀렸는데 사번까지 다시 타야 한다. 모바일에서 `F2019-041` 재입력이다.
   * 비밀번호는 절대 돌려주지 않는다.
   */
  employeeNo?: string;
};

export async function loginAction(
  _prev: LoginState,
  form: FormData,
): Promise<LoginState> {
  // 프록시 뒤에서는 x-forwarded-for 첫 값이 클라이언트다. 로컬에선 없을 수 있다.
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    null;

  const employeeNo = String(form.get("employeeNo") ?? "");
  const result = await login(
    employeeNo,
    String(form.get("password") ?? ""),
    ip,
  );

  if (!result.ok) return { message: result.message, employeeNo };

  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: result.expiresAt,
  });

  // 원래 가려던 곳으로 돌려보낸다. 열린 리다이렉트를 막으려고 같은 앱 경로만 허용.
  const raw = String(form.get("next") ?? "");
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  redirect(next);
}

export async function logoutAction() {
  const jar = await cookies();
  await logout(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
