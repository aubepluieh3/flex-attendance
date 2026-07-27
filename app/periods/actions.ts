"use server";

import { revalidatePath } from "next/cache";
import { closeDuePeriods, reopenPeriod } from "@/db/close";
import { now } from "@/lib/clock";
import { requestViewer } from "../viewer";
import { AccessDenied } from "@/db/access";

export async function reopenPeriodAction(form: FormData) {
  const viewer = await requestViewer();
  await reopenPeriod(
    viewer,
    String(form.get("periodId") ?? ""),
    String(form.get("reason") ?? ""),
  );
  revalidatePath("/periods");
  revalidatePath("/records");
  revalidatePath("/");
}

export async function closeDueAction() {
  const viewer = await requestViewer();
  if (viewer.role !== "hr") {
    throw new AccessDenied("마감 실행은 HR 권한이 필요합니다.");
  }
  await closeDuePeriods(viewer.orgId, now());
  revalidatePath("/periods");
  revalidatePath("/records");
  revalidatePath("/");
}
