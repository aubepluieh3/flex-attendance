"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  cancelTimeOff,
  requestTimeOff,
  TIME_OFF_LABEL,
  type TimeOffKind,
} from "@/db/timeoff";
import { syncNotifications } from "@/db/notify";
import { now } from "@/lib/clock";
import { requestViewer } from "../viewer";
import { reportActionError, str } from "../action-error";

/**
 * 휴가 신청 · 취소.
 *
 * /records 에서 떼어냈다. 휴가는 근태 보정과 성격이 다르다 — 보정은 실제로
 * 일한 것을 신고하는 것이고 휴가는 근로 의무를 면제받는 것이다
 * (db/schema.ts 의 time_off 주석). 한 화면에 묶여 있었더니 휴가 신청이
 * 31일치 기록 카드 뒤 9화면째에 있었고, 메뉴 이름("내 기록 · 보정")에
 * 휴가가 없어서 기능이 있는 줄도 몰랐다.
 *
 * useActionState 를 안 쓰는 이유는 recordsAction 과 같다 — 그러면 폼이
 * 클라이언트 컴포넌트가 되어 JS 없이는 제출이 안 된다.
 */
export async function timeOffAction(form: FormData) {
  let query: string;

  try {
    const viewer = await requestViewer();
    const op = str(form, "op");

    if (op === "cancelOff") {
      const r = await cancelTimeOff(viewer, str(form, "offId"));
      query = `msg=${encodeURIComponent(`${r.date} 휴가 ${r.wasApproved ? "승인을 취소" : "신청을 취소"}했습니다.`)}`;
    } else {
      const r = await requestTimeOff(viewer, {
        date: str(form, "offDate"),
        kind: str(form, "kind") as TimeOffKind,
        reason: str(form, "offReason"),
      });
      query = `msg=${encodeURIComponent(`${r.date} ${TIME_OFF_LABEL[r.kind]}를 신청했습니다. 승인되면 소정근로에서 빠집니다.`)}`;
    }

    // 승인자가 팀 현황을 안 열면 방치되므로 알림을 만든다
    await syncNotifications(viewer.orgId, now());

    revalidatePath("/time-off");
    revalidatePath("/records");
    revalidatePath("/");
    revalidatePath("/notifications");
    revalidatePath("/team");
  } catch (e) {
    await reportActionError("timeOffAction", e);
    query = `err=${encodeURIComponent((e as Error).message)}`;
  }

  redirect(`/time-off?${query}`);
}
