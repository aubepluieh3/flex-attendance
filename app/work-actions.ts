"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { startWork, stopWork } from "@/db/checkin";
import { requestViewer } from "./viewer";
import { rethrowControlFlow } from "./action-error";

/**
 * 근무 시작 / 종료.
 *
 * 결과를 쿼리 파라미터로 돌려준다. 던지면 500 에러 페이지가 되고 프로덕션에서는
 * 사유까지 가려진다. JS 없이도 동작해야 하므로 useActionState 를 쓰지 않는다.
 */
async function done(fn: () => Promise<string>) {
  let query: string;
  try {
    query = `msg=${encodeURIComponent(await fn())}`;
    revalidatePath("/");
    revalidatePath("/records");
    revalidatePath("/team");
    revalidatePath("/notifications");
  } catch (e) {
    rethrowControlFlow(e);
    query = `err=${encodeURIComponent((e as Error).message)}`;
  }
  redirect(`/?${query}`);
}

export async function startWorkAction() {
  await done(async () => {
    const viewer = await requestViewer("/");
    await startWork(viewer);
    return "근무를 시작했습니다.";
  });
}

export async function stopWorkAction() {
  await done(async () => {
    const viewer = await requestViewer("/");
    const r = await stopWork(viewer);
    const h = Math.floor(r.minutes / 60);
    const m = r.minutes % 60;
    return `근무를 종료했습니다. 이번 세션 ${h > 0 ? `${h}시간 ` : ""}${m}분.`;
  });
}
