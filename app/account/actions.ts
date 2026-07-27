"use server";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { changeOwnPassword } from "@/db/people";
import { SESSION_COOKIE } from "@/db/auth";
import { requestViewer } from "../viewer";

export type AccountState = { message?: string; error?: string };

export async function changePasswordAction(
  _prev: AccountState,
  form: FormData,
): Promise<AccountState> {
  const next = String(form.get("next") ?? "");
  if (next !== String(form.get("confirm") ?? "")) {
    return { error: "새 비밀번호 확인이 일치하지 않습니다." };
  }

  try {
    const viewer = await requestViewer();
    // 지금 쓰는 세션은 남긴다 — 바꾸자마자 로그아웃되면 당황한다
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const keep = token
      ? createHash("sha256").update(token).digest("hex")
      : null;
    await changeOwnPassword(
      viewer,
      String(form.get("current") ?? ""),
      next,
      keep,
    );
    return {
      message: "비밀번호를 바꿨습니다. 다른 기기의 로그인은 모두 끊겼습니다.",
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
