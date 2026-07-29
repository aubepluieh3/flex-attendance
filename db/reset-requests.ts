import { and, asc, eq } from "drizzle-orm";
import { db } from "./client";
import { passwordResetRequests, users } from "./schema";
import { AccessDenied, type Viewer } from "./access";
import { now } from "@/lib/clock";

/**
 * 비밀번호 재설정 요청.
 *
 * 로그인하지 못하는 사람이 남기고 HR 이 처리한다.
 *
 * 왜 이런 모양인가 — 메일 발송 수단이 없다. 그런데 사번만으로 즉시 재설정하게
 * 하면 사번을 아는 누구나 남의 계정을 초기화할 수 있고, 사번은 사원증·CSV 에
 * 있는 준공개 정보다. 그래서 자동 발송 대신 **사람이 승인**하는 자리를 둔다.
 * 임시 비밀번호는 HR 이 사내에서 직접 전달한다.
 */

/**
 * 요청을 남긴다. 로그인 없이 부른다.
 *
 * ⚠ 사번이 있든 없든 **같은 결과를 돌려준다.** "그런 사번이 없습니다"를
 * 알려주면 이 화면이 사번 열거 도구가 된다 — 로그인 화면은 실패 이유를
 * "사번 또는 비밀번호"로 뭉개면서 여기서 알려주면 그 노력이 무의미해진다.
 */
export async function requestPasswordReset(employeeNo: string): Promise<void> {
  const no = employeeNo.trim();
  if (!no) return;

  const [person] = await db
    .select({ id: users.id, active: users.active })
    .from(users)
    .where(eq(users.employeeNo, no));

  // 없는 사번이거나 비활성 계정이면 아무것도 만들지 않는다. 화면은 같은 말을 한다.
  if (!person || !person.active) return;

  /*
   * 한 사람에게 pending 은 하나만.
   *
   * 이게 남용 제한을 겸한다 — 같은 사번으로 백 번 눌러도 한 건이다.
   * 그래서 IP 를 담지 않아도 되고, 담지 않으니 파기 규칙도 필요 없다.
   */
  const [existing] = await db
    .select({ id: passwordResetRequests.id })
    .from(passwordResetRequests)
    .where(
      and(
        eq(passwordResetRequests.userId, person.id),
        eq(passwordResetRequests.status, "pending"),
      ),
    );
  if (existing) return;

  await db.insert(passwordResetRequests).values({ userId: person.id });
}

export type ResetRequestRow = {
  id: string;
  userId: string;
  name: string;
  employeeNo: string;
  createdAt: Date;
};

/** 처리 대기 중인 요청 (HR) */
export async function listResetRequests(
  viewer: Viewer,
): Promise<ResetRequestRow[]> {
  if (viewer.role !== "hr") {
    throw new AccessDenied("비밀번호 재설정 요청은 HR만 볼 수 있습니다.");
  }
  return db
    .select({
      id: passwordResetRequests.id,
      userId: users.id,
      name: users.name,
      employeeNo: users.employeeNo,
      createdAt: passwordResetRequests.createdAt,
    })
    .from(passwordResetRequests)
    .innerJoin(users, eq(passwordResetRequests.userId, users.id))
    .where(
      and(
        eq(passwordResetRequests.status, "pending"),
        eq(users.orgId, viewer.orgId),
      ),
    )
    .orderBy(asc(passwordResetRequests.createdAt));
}

/**
 * 요청을 닫는다. 초기화했을 때와 무시했을 때 모두 부른다 —
 * 남겨두면 목록이 쓰레기가 되고, 그러면 HR 이 목록 자체를 안 본다.
 */
export async function closeResetRequest(
  viewer: Viewer,
  requestId: string,
  status: "done" | "dismissed",
): Promise<void> {
  if (viewer.role !== "hr") {
    throw new AccessDenied("비밀번호 재설정 요청은 HR만 처리할 수 있습니다.");
  }
  await db
    .update(passwordResetRequests)
    .set({ status, decidedBy: viewer.id, decidedAt: now() })
    .where(eq(passwordResetRequests.id, requestId));
}

/** 그 사람의 pending 요청을 닫는다 — HR 이 요청 목록을 안 거치고 초기화한 경우 */
export async function closeRequestsFor(
  viewer: Viewer,
  userId: string,
): Promise<void> {
  await db
    .update(passwordResetRequests)
    .set({ status: "done", decidedBy: viewer.id, decidedAt: now() })
    .where(
      and(
        eq(passwordResetRequests.userId, userId),
        eq(passwordResetRequests.status, "pending"),
      ),
    );
}
