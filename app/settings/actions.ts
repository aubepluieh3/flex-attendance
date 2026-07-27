"use server";

import { revalidatePath } from "next/cache";
import {
  addHoliday,
  addTimeOff,
  recomputeEveryone,
  removeHoliday,
  removeTimeOff,
  updateOrgRules,
} from "@/db/settings";
import { requestViewer } from "../viewer";

const num = (form: FormData, key: string, fallback = 0) => {
  const raw = String(form.get(key) ?? "").trim();
  const n = Number(raw);
  return raw === "" || Number.isNaN(n) ? fallback : n;
};
const str = (form: FormData, key: string) => String(form.get(key) ?? "");

/** 규칙을 저장한 뒤 전원 재계산한다. work_days 는 파생 데이터라 낡으면 안 된다. */
export async function saveRulesAction(form: FormData) {
  const viewer = await requestViewer();

  await updateOrgRules(viewer, {
    settlementPeriod: str(form, "settlementPeriod") === "month" ? "month" : "week",
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

  await recomputeEveryone(viewer);
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/team");
  revalidatePath("/report");
}

export async function recomputeAction() {
  const viewer = await requestViewer();
  await recomputeEveryone(viewer);
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function addHolidayAction(form: FormData) {
  const viewer = await requestViewer();
  await addHoliday(viewer, str(form, "date"), str(form, "name"));
  await recomputeEveryone(viewer);
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function removeHolidayAction(form: FormData) {
  const viewer = await requestViewer();
  await removeHoliday(viewer, str(form, "id"));
  await recomputeEveryone(viewer);
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function addTimeOffAction(form: FormData) {
  const viewer = await requestViewer();
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
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function removeTimeOffAction(form: FormData) {
  const viewer = await requestViewer();
  await removeTimeOff(viewer, str(form, "id"));
  revalidatePath("/settings");
  revalidatePath("/");
}
