"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { login, logout, SESSION_COOKIE } from "@/db/auth";

export type LoginState = { message?: string };

export async function loginAction(
  _prev: LoginState,
  form: FormData,
): Promise<LoginState> {
  const result = await login(
    String(form.get("employeeNo") ?? ""),
    String(form.get("password") ?? ""),
  );

  if (!result.ok) return { message: result.message };

  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: result.expiresAt,
  });

  redirect("/");
}

export async function logoutAction() {
  const jar = await cookies();
  await logout(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
