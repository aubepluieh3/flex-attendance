"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdjustment, revertAdjustment } from "@/db/adjust";
import { requestViewer } from "../viewer";
import { rethrowControlFlow } from "../action-error";

/**
 * 보정 액션.
 *
 * 던지면 500 에러 페이지가 되고 프로덕션에서는 사유까지 가려진다. 그래서 결과를
 * 쿼리 파라미터로 돌려주고 페이지가 배너로 보여준다.
 *
 * useActionState 를 쓰지 않는 이유: 그러면 폼이 클라이언트 컴포넌트가 되어
 * JS 없이는 제출이 안 된다. 근태 보정은 JS 없이도 되어야 한다.
 */
const str = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function recordsAction(form: FormData) {
  const period = str(form, "period");
  const back = period ? `/records?period=${period}` : "/records";
  let query: string;

  try {
    const viewer = await requestViewer();
    const workDate = str(form, "workDate");

    if (str(form, "op") === "revert") {
      await revertAdjustment(viewer, viewer.id, workDate, "보정 취소");
      query = `msg=${encodeURIComponent(`${workDate} 보정을 취소했습니다. 원본 기록으로 돌아갑니다.`)}`;
    } else {
      const minutes = str(form, "addedMinutes").trim();
      await createAdjustment(viewer, viewer.id, {
        workDate,
        firstIn: str(form, "firstIn") || undefined,
        lastOut: str(form, "lastOut") || undefined,
        addedMinutes: minutes ? Number(minutes) : 0,
        reason: str(form, "reason"),
      });
      query = `msg=${encodeURIComponent(`${workDate} 기록을 보정했습니다.`)}`;
    }

    revalidatePath("/records");
    revalidatePath("/");
    revalidatePath("/notifications");
  } catch (e) {
    rethrowControlFlow(e);
    query = `err=${encodeURIComponent((e as Error).message)}`;
  }

  redirect(`${back}${back.includes("?") ? "&" : "?"}${query}`);
}
