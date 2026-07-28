"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cancelTimeOff, decideTimeOff, TIME_OFF_LABEL } from "@/db/timeoff";
import { syncNotifications } from "@/db/notify";
import { closeDueIfStale } from "@/db/close";
import { now } from "@/lib/clock";
import { requestViewer } from "../viewer";
import { rethrowControlFlow } from "../action-error";

/**
 * 팀 현황 액션 — 휴가 승인 / 반려 / 취소.
 *
 * 결과를 쿼리 파라미터로 돌려준다. 던지면 500 이 되고 프로덕션에서는 사유까지
 * 가려진다. JS 없이도 되어야 하므로 서버 컴포넌트 폼을 쓴다.
 */
const str = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function teamAction(form: FormData) {
  const period = str(form, "period");
  const back = period ? `/team?period=${period}` : "/team";
  let query: string;

  try {
    const viewer = await requestViewer();
    // 승인도 그 기간에 쓰는 것이다. 마감을 먼저 돌린다
    await closeDueIfStale(viewer.orgId, now());
    const op = str(form, "op");

    if (op === "cancelOff") {
      const r = await cancelTimeOff(viewer, str(form, "offId"));
      query = `msg=${encodeURIComponent(`${r.date} 휴가를 취소했습니다.`)}`;
    } else {
      const decision = op === "reject" ? "reject" : "approve";
      const r = await decideTimeOff(
        viewer,
        str(form, "offId"),
        decision,
        str(form, "note"),
      );
      query = `msg=${encodeURIComponent(
        `${r.userName} ${r.date} ${TIME_OFF_LABEL[r.kind]}를 ${
          decision === "approve" ? "승인했습니다" : "반려했습니다"
        }.`,
      )}`;
    }

    /*
     * 알림을 여기서 맞춘다.
     *
     * db/timeoff.ts 가 직접 부르면 notify → timeoff → notify 순환 참조가 된다.
     * 알림은 "지금 확인할 것"의 재계산이라 쓰기 액션 끝에서 부르는 게 맞다.
     */
    await syncNotifications(viewer.orgId, now());

    revalidatePath("/team");
    revalidatePath("/records");
    revalidatePath("/");
    revalidatePath("/notifications");
  } catch (e) {
    rethrowControlFlow(e);
    query = `err=${encodeURIComponent((e as Error).message)}`;
  }

  redirect(`${back}${back.includes("?") ? "&" : "?"}${query}`);
}
