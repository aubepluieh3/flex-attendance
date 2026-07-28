import { desc, lt } from "drizzle-orm";
import { db } from "./client";
import { errorLogs, users } from "./schema";
import { AccessDenied, type Viewer } from "./access";
import { now } from "@/lib/clock";
import { DateTime } from "luxon";
import { eq, sql } from "drizzle-orm";

/**
 * 오류 기록.
 *
 * 외부 모니터링(Sentry 등)으로 보내지 않는다 — 스택트레이스에 사번·이름이
 * 섞이기 쉽고, 근태 데이터를 외부 인프라로 내보내는 판단이 따라온다.
 * 사내 배포 전제와 맞지 않는다.
 *
 * 스택트레이스를 저장하지 않는 이유도 같다. 디버깅에 실제로 필요한 건 대부분
 * "어디서 무슨 메시지"이고, 스택은 개인정보가 새는 통로가 된다.
 *
 * 기록 자체가 실패해도 원래 오류를 가리면 안 된다. 그래서 절대 던지지 않는다.
 */

const RETENTION_DAYS = 30;

export async function recordError(opts: {
  where: string;
  error: unknown;
  orgId?: string | null;
  userId?: string | null;
}): Promise<void> {
  try {
    const raw =
      opts.error instanceof Error
        ? opts.error.message
        : String(opts.error ?? "알 수 없는 오류");

    await db.insert(errorLogs).values({
      orgId: opts.orgId ?? null,
      userId: opts.userId ?? null,
      where: opts.where.slice(0, 200),
      // 메시지에 값이 길게 붙는 경우가 있어 자른다
      message: raw.slice(0, 1000),
    });

    // 30일 지난 것은 지운다. 오류 기록도 무한히 쌓이면 안 된다.
    await db
      .delete(errorLogs)
      .where(
        lt(
          errorLogs.createdAt,
          DateTime.fromJSDate(now()).minus({ days: RETENTION_DAYS }).toJSDate(),
        ),
      );
  } catch {
    // 기록 실패가 원래 오류를 덮으면 디버깅이 더 어려워진다. 조용히 넘긴다.
  }
}

export type ErrorRow = {
  id: string;
  where: string;
  message: string;
  userName: string | null;
  createdAt: Date;
};

/** 최근 오류 (HR만) */
export async function listErrors(
  viewer: Viewer,
  limit = 30,
): Promise<ErrorRow[]> {
  if (viewer.role !== "hr") {
    throw new AccessDenied("오류 기록은 HR만 볼 수 있습니다.");
  }

  const rows = await db
    .select({
      id: errorLogs.id,
      where: errorLogs.where,
      message: errorLogs.message,
      userName: users.name,
      createdAt: errorLogs.createdAt,
    })
    .from(errorLogs)
    .leftJoin(users, eq(users.id, errorLogs.userId))
    .orderBy(desc(errorLogs.createdAt))
    .limit(limit);

  return rows;
}

/** 최근 24시간 오류 건수 (설정 화면 배지용) */
export async function recentErrorCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(errorLogs)
    .where(
      sql`${errorLogs.createdAt} > ${DateTime.fromJSDate(now()).minus({ hours: 24 }).toJSDate()}`,
    );
  return row?.n ?? 0;
}
