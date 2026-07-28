"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { closeDuePeriods, reopenPeriod } from "@/db/close";
import { AccessDenied } from "@/db/access";
import { now } from "@/lib/clock";
import { requestViewer } from "../viewer";
import { reportActionError } from "../action-error";

/**
 * 마감·재마감 액션.
 *
 * 결과를 쿼리 파라미터로 돌려주고 페이지가 배너로 보여준다. 던지면 500 에러
 * 페이지가 되고 프로덕션에서는 사유까지 가려진다.
 *
 * useActionState 를 쓰지 않는 이유: 그러면 폼이 클라이언트 컴포넌트가 되어
 * JS 없이는 제출이 안 된다.
 */
async function done(fn: () => Promise<string>) {
  let query: string;
  try {
    query = `msg=${encodeURIComponent(await fn())}`;
    revalidatePath("/periods");
    revalidatePath("/records");
    revalidatePath("/");
  } catch (e) {
    await reportActionError("periodsAction", e);
    query = `err=${encodeURIComponent((e as Error).message)}`;
  }
  redirect(`/periods?${query}`);
}

export async function closeDueAction() {
  await done(async () => {
    const viewer = await requestViewer();
    if (viewer.role !== "hr") {
      throw new AccessDenied("마감 실행은 HR 권한이 필요합니다.");
    }
    const closed = await closeDuePeriods(viewer.orgId, now());
    if (closed.length === 0) {
      return "마감할 기간이 없습니다. 정산기간 종료 후 유예일이 지나야 마감됩니다.";
    }
    return closed
      .map(
        (c) => `${c.periodStart}~${c.periodEnd} 마감 (스냅샷 ${c.snapshots}명)`,
      )
      .join(" · ");
  });
}

export async function reopenPeriodAction(form: FormData) {
  await done(async () => {
    const viewer = await requestViewer();
    await reopenPeriod(
      viewer,
      String(form.get("periodId") ?? ""),
      String(form.get("reason") ?? ""),
    );
    return "재마감했습니다. 유예일이 다시 시작되므로 그 동안 보정할 수 있습니다.";
  });
}
