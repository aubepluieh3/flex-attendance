"use server";

import { requestPasswordReset } from "@/db/reset-requests";
import { reportActionError, str } from "../../action-error";

export type ResetState = { message?: string; error?: string };

/**
 * 비밀번호 재설정 요청.
 *
 * ⚠ 사번이 있든 없든 **같은 메시지**를 돌려준다. "그런 사번이 없습니다"를
 * 알려주면 이 화면이 사번 열거 도구가 된다 — 로그인 실패 문구를 "사번 또는
 * 비밀번호"로 뭉갠 노력이 여기서 무의미해진다.
 */
export async function resetRequestAction(
  _prev: ResetState,
  form: FormData,
): Promise<ResetState> {
  try {
    await requestPasswordReset(str(form, "employeeNo"));
  } catch (e) {
    await reportActionError("resetRequestAction", e);
    return { error: "요청을 남기지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }

  return {
    message:
      "요청을 남겼습니다. HR이 확인하면 임시 비밀번호를 받게 됩니다. 이미 요청한 적이 있으면 그 요청이 그대로 처리됩니다.",
  };
}
