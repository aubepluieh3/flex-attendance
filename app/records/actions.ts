"use server";

import { revalidatePath } from "next/cache";
import { createAdjustment, revertAdjustment } from "@/db/adjust";
import { requestViewer } from "../viewer";

export async function adjustAction(form: FormData) {
  const viewer = await requestViewer();

  const minutes = String(form.get("addedMinutes") ?? "").trim();

  await createAdjustment(viewer, viewer.id, {
    workDate: String(form.get("workDate") ?? ""),
    firstIn: String(form.get("firstIn") ?? "") || undefined,
    lastOut: String(form.get("lastOut") ?? "") || undefined,
    addedMinutes: minutes ? Number(minutes) : 0,
    reason: String(form.get("reason") ?? ""),
  });

  revalidatePath("/records");
  revalidatePath("/");
}

export async function revertAction(form: FormData) {
  const viewer = await requestViewer();
  await revertAdjustment(
    viewer,
    viewer.id,
    String(form.get("workDate") ?? ""),
    String(form.get("reason") ?? ""),
  );
  revalidatePath("/records");
  revalidatePath("/");
}
