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
import { loadOrgRules } from "@/db/access";
import { findTargetOverStatutory } from "@/lib/attendance/target-vs-statutory";
import { hm } from "@/lib/format";
import { now } from "@/lib/clock";
import { requestViewer } from "../viewer";
import { num, reportActionError, str } from "../action-error";

/**
 * 설정 액션.
 *
 * 던지면 500 에러 페이지가 되고 프로덕션에서는 사유까지 가려진다. 여기는 폼이
 * 여섯 개가 긴 페이지에 흩어져 있어서 useActionState 로 묶으면 페이지 전체가
 * 클라이언트 컴포넌트가 된다. 그래서 결과를 쿼리 파라미터로 돌려주고 페이지가
 * 배너로 보여준다 — JS 없이도 동작한다.
 */

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
    await reportActionError("settingsAction", e);
    query = `err=${encodeURIComponent((e as Error).message)}`;
  }
  redirect(`/settings?${query}`);
}

export async function saveRulesAction(form: FormData) {
  await done(async (viewer) => {
    const targetCalcMethod =
      str(form, "targetCalcMethod") === "fixed" ? "fixed" : "business_days";
    await updateOrgRules(viewer, {
      settlementPeriod:
        str(form, "settlementPeriod") === "month" ? "month" : "week",
      weekStartDay: num(form, "weekStartDay", 1),
      targetCalcMethod,
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
    const saved = `규칙을 저장하고 ${r.users}명 · ${r.days}일을 다시 계산했습니다.`;

    /*
     * 저장할 때 한 번 더 강조한다. 화면 상시 표시(settings/page.tsx)는 스크롤
     * 하면 지나치므로, 이 성질을 만들거나 바꾼 순간에 배너로 말한다.
     *
     * 앱은 소정근로를 법정 총량으로 자동 보정하지 않는다 — §2①7호로 소정근로
     * 산정은 당사자가 정하는 것이라 코드가 상한을 씌우면 회사 정책이 된다.
     */
    if (targetCalcMethod !== "business_days") return saved;

    const rules = await loadOrgRules(viewer.orgId);
    const over = findTargetOverStatutory({
      kind: rules.settlementKind,
      weekStartDay: rules.weekStartDay,
      timezone: rules.attendance.timezone,
      weekendDays: rules.settlement.weekendDays,
      holidays: rules.settlement.holidays,
      standardMinutesPerDay: rules.settlement.standardMinutesPerDay,
      legalWeeklyMinutes: rules.settlement.legalWeeklyMinutes,
      from: now(),
    });
    if (over.length === 0) return saved;

    const first = over[0]!;
    return (
      `${saved} ⚠ 현재 산정 방식에서는 월별 영업일 수에 따라 소정근로시간이 ` +
      `법정근로 총량을 초과할 수 있습니다 — ${first.label}: 소정근로 ` +
      `${hm(first.targetMinutes)} / 법정근로 총량 약 ${hm(first.statutoryMinutes)}` +
      `${over.length > 1 ? ` (앞으로 1년 중 ${over.length}개 기간)` : ""}. ` +
      `초과분은 연장근로이며 가산수당 대상입니다.`
    );
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
