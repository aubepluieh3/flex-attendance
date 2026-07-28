"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  addHoliday,
  addTimeOff,
  recomputeEveryone,
  removeHoliday,
  removeTimeOff,
  updateOrgRules,
} from "@/db/settings";
import { closeDueIfStale } from "@/db/close";
import { now } from "@/lib/clock";
import { requestViewer } from "../viewer";
import { rethrowControlFlow } from "../action-error";

/**
 * 설정 액션.
 *
 * 던지면 500 에러 페이지가 되고 프로덕션에서는 사유까지 가려진다. 여기는 폼이
 * 여섯 개가 긴 페이지에 흩어져 있어서 useActionState 로 묶으면 페이지 전체가
 * 클라이언트 컴포넌트가 된다. 그래서 결과를 쿼리 파라미터로 돌려주고 페이지가
 * 배너로 보여준다 — JS 없이도 동작한다.
 */
const num = (form: FormData, key: string, fallback = 0) => {
  const raw = String(form.get(key) ?? "").trim();
  const n = Number(raw);
  return raw === "" || Number.isNaN(n) ? fallback : n;
};
const str = (form: FormData, key: string) => String(form.get(key) ?? "");

async function done(
  fn: (viewer: Awaited<ReturnType<typeof requestViewer>>) => Promise<string>,
) {
  let query: string;
  try {
    const viewer = await requestViewer();
    query = `msg=${encodeURIComponent(await fn(viewer))}`;
    revalidatePath("/settings");
    revalidatePath("/");
    revalidatePath("/team");
    revalidatePath("/report");
  } catch (e) {
    rethrowControlFlow(e);
    query = `err=${encodeURIComponent((e as Error).message)}`;
  }
  redirect(`/settings?${query}`);
}

export async function saveRulesAction(form: FormData) {
  await done(async (viewer) => {
    await updateOrgRules(viewer, {
      settlementPeriod:
        str(form, "settlementPeriod") === "month" ? "month" : "week",
      weekStartDay: num(form, "weekStartDay", 1),
      targetCalcMethod:
        str(form, "targetCalcMethod") === "fixed" ? "fixed" : "business_days",
      targetMinutesPerPeriod: num(form, "targetHours", 40) * 60,
      standardMinutesPerDay: num(form, "standardHours", 8) * 60,
      limitMinutesPerWeek: num(form, "limitHours", 52) * 60,
      dayBoundaryHour: num(form, "dayBoundaryHour", 5),
      break4h: num(form, "break4h", 30),
      break8h: num(form, "break8h", 60),
      coreTimeStart: str(form, "coreTimeStart"),
      coreTimeEnd: str(form, "coreTimeEnd"),
      flexBandStart: str(form, "flexBandStart"),
      flexBandEnd: str(form, "flexBandEnd"),
      nightWindowStart: str(form, "nightWindowStart") || "22:00",
      nightWindowEnd: str(form, "nightWindowEnd") || "06:00",
      dailyLimitMinutes:
        str(form, "dailyLimitHours").trim() === ""
          ? null
          : num(form, "dailyLimitHours", 12) * 60,
      closeGraceDays: num(form, "closeGraceDays", 3),
      reviewThresholdMinutes: num(form, "reviewThresholdHours", 8) * 60,
    });
    const r = await recomputeEveryone(viewer);
    return `규칙을 저장하고 ${r.users}명 · ${r.days}일을 다시 계산했습니다.`;
  });
}

export async function recomputeAction() {
  await done(async (viewer) => {
    const r = await recomputeEveryone(viewer);
    return `${r.users}명 · ${r.days}일을 다시 계산했습니다.`;
  });
}

export async function addHolidayAction(form: FormData) {
  await done(async (viewer) => {
    await addHoliday(viewer, str(form, "date"), str(form, "name"));
    await recomputeEveryone(viewer);
    return `공휴일 ${str(form, "date")} 을 추가하고 다시 계산했습니다.`;
  });
}

export async function removeHolidayAction(form: FormData) {
  await done(async (viewer) => {
    await removeHoliday(viewer, str(form, "id"));
    await recomputeEveryone(viewer);
    return "공휴일을 삭제하고 다시 계산했습니다.";
  });
}

export async function addTimeOffAction(form: FormData) {
  await done(async (viewer) => {
    // 마감된 기간에 휴가를 넣지 못하게 먼저 돌린다
    await closeDueIfStale(viewer.orgId, now());
    const kind = str(form, "kind");
    await addTimeOff(viewer, {
      employeeNo: str(form, "employeeNo"),
      date: str(form, "date"),
      kind:
        kind === "half_am" || kind === "half_pm" || kind === "unpaid"
          ? kind
          : "full",
      reason: str(form, "reason"),
    });
    return `휴가 ${str(form, "date")} 을 등록했습니다.`;
  });
}

export async function removeTimeOffAction(form: FormData) {
  await done(async (viewer) => {
    await removeTimeOff(viewer, str(form, "id"));
    return "휴가를 삭제했습니다.";
  });
}
