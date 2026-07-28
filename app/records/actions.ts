"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdjustment, revertAdjustment } from "@/db/adjust";
import { closeSessionManually } from "@/db/checkin";
import {
  cancelTimeOff,
  requestTimeOff,
  TIME_OFF_LABEL,
  type TimeOffKind,
} from "@/db/timeoff";
import { syncNotifications } from "@/db/notify";
import { now } from "@/lib/clock";
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

    const op = str(form, "op");

    if (op === "revert") {
      await revertAdjustment(viewer, viewer.id, workDate, "보정 취소");
      query = `msg=${encodeURIComponent(`${workDate} 보정을 취소했습니다. 원본 기록으로 돌아갑니다.`)}`;
    } else if (op === "closeSession") {
      const r = await closeSessionManually(viewer, {
        sessionId: str(form, "sessionId"),
        endedAt: str(form, "endedAt"),
        note: str(form, "note"),
      });
      const h = Math.floor(r.minutes / 60);
      const m = r.minutes % 60;
      query = `msg=${encodeURIComponent(`${r.workDate} 근무를 ${h}시간 ${m}분으로 마감했습니다.`)}`;
    } else if (op === "requestOff") {
      const r = await requestTimeOff(viewer, {
        date: str(form, "offDate"),
        kind: str(form, "kind") as TimeOffKind,
        reason: str(form, "offReason"),
      });
      query = `msg=${encodeURIComponent(`${r.date} ${TIME_OFF_LABEL[r.kind]}를 신청했습니다. 승인되면 소정근로에서 빠집니다.`)}`;
    } else if (op === "cancelOff") {
      const r = await cancelTimeOff(viewer, str(form, "offId"));
      query = `msg=${encodeURIComponent(`${r.date} 휴가 ${r.wasApproved ? "승인을 취소" : "신청을 취소"}했습니다.`)}`;
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

    // 휴가 신청도 알림 대상이다 (승인자가 팀 현황을 안 열면 방치된다)
    await syncNotifications(viewer.orgId, now());

    revalidatePath("/records");
    revalidatePath("/");
    revalidatePath("/notifications");
    revalidatePath("/team");
  } catch (e) {
    rethrowControlFlow(e);
    query = `err=${encodeURIComponent((e as Error).message)}`;
  }

  redirect(`${back}${back.includes("?") ? "&" : "?"}${query}`);
}
