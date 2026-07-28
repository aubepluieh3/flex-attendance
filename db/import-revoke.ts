import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./client";
import { attendanceLogs, importBatches, users } from "./schema";
import { AccessDenied, loadOrgRules, type Viewer } from "./access";
import { assertPeriodOpen } from "./close";
import { recomputeWorkDays } from "./recompute";
import { syncNotifications } from "./notify";
import { resolveWorkDate } from "@/lib/attendance/compute";
import { now } from "@/lib/clock";

/**
 * CSV 임포트 무효화.
 *
 * 잘못 올린 파일을 되돌릴 방법이 없으면 HR 이 임포트를 두려워하게 되고, 그러면
 * 근태가 안 들어온다. 원본 append-only 원칙의 예외를 여기 하나만 둔다 —
 * 잘못 올린 파일은 "있었던 사실"이 아니라 실수다.
 *
 * 마감된 기간이 걸린 배치는 거부한다. 확정된 공식 기록이 흔들리면 안 된다.
 */

export type BatchRow = {
  id: string;
  fileName: string;
  rowCount: number;
  insertedCount: number;
  skippedCount: number;
  uploadedByName: string;
  createdAt: Date;
  revokedAt: Date | null;
  revokedByName: string | null;
  /** 아직 남아 있는 태그 수 (무효화하면 0) */
  liveTags: number;
};

export async function listBatches(
  viewer: Viewer,
  limit = 10,
): Promise<BatchRow[]> {
  if (viewer.role !== "hr") {
    throw new AccessDenied("임포트 이력은 HR만 볼 수 있습니다.");
  }

  const rows = await db
    .select({
      id: importBatches.id,
      fileName: importBatches.fileName,
      rowCount: importBatches.rowCount,
      insertedCount: importBatches.insertedCount,
      skippedCount: importBatches.skippedCount,
      uploadedBy: importBatches.uploadedBy,
      createdAt: importBatches.createdAt,
      revokedAt: importBatches.revokedAt,
      revokedBy: importBatches.revokedBy,
      liveTags: sql<number>`(
        select count(*)::int from ${attendanceLogs}
        where ${attendanceLogs.importBatchId} = ${importBatches.id}
      )`,
    })
    .from(importBatches)
    .where(eq(importBatches.orgId, viewer.orgId))
    .orderBy(desc(importBatches.createdAt))
    .limit(limit);

  const ids = [
    ...new Set(
      rows.flatMap((r) => [r.uploadedBy, r.revokedBy].filter((x) => x !== null)),
    ),
  ] as string[];
  const names = new Map(
    ids.length === 0
      ? []
      : (
          await db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(sql`${users.id} = any(${ids})`)
        ).map((u) => [u.id, u.name] as const),
  );

  return rows.map((r) => ({
    id: r.id,
    fileName: r.fileName,
    rowCount: r.rowCount,
    insertedCount: r.insertedCount,
    skippedCount: r.skippedCount,
    uploadedByName: names.get(r.uploadedBy) ?? "",
    createdAt: r.createdAt,
    revokedAt: r.revokedAt,
    revokedByName: r.revokedBy ? (names.get(r.revokedBy) ?? "") : null,
    liveTags: r.liveTags,
  }));
}

export async function revokeBatch(
  viewer: Viewer,
  batchId: string,
): Promise<{ fileName: string; removed: number; people: number }> {
  if (viewer.role !== "hr") {
    throw new AccessDenied("임포트 무효화는 HR 권한이 필요합니다.");
  }

  const [batch] = await db
    .select({
      id: importBatches.id,
      orgId: importBatches.orgId,
      fileName: importBatches.fileName,
      revokedAt: importBatches.revokedAt,
    })
    .from(importBatches)
    .where(eq(importBatches.id, batchId));

  if (!batch || batch.orgId !== viewer.orgId) {
    throw new Error("해당 임포트 이력을 찾을 수 없습니다.");
  }
  if (batch.revokedAt) throw new Error("이미 무효화된 임포트입니다.");

  const rules = await loadOrgRules(viewer.orgId);

  // 어떤 사람의 어떤 날이 영향을 받는지 먼저 모은다
  const tags = await db
    .select({
      userId: attendanceLogs.userId,
      occurredAt: attendanceLogs.occurredAt,
    })
    .from(attendanceLogs)
    .where(eq(attendanceLogs.importBatchId, batchId));

  if (tags.length === 0) {
    await db
      .update(importBatches)
      .set({ revokedAt: now(), revokedBy: viewer.id })
      .where(eq(importBatches.id, batchId));
    return { fileName: batch.fileName, removed: 0, people: 0 };
  }

  const spanByUser = new Map<string, { from: string; to: string }>();
  for (const t of tags) {
    const d = resolveWorkDate(t.occurredAt, rules.attendance);
    const cur = spanByUser.get(t.userId);
    if (!cur) spanByUser.set(t.userId, { from: d, to: d });
    else {
      if (d < cur.from) cur.from = d;
      if (d > cur.to) cur.to = d;
    }
  }

  /*
   * 마감된 기간이 걸려 있으면 전부 거부한다.
   * 일부만 지우면 그 배치가 "반쯤 무효"인 상태가 되어 무엇이 반영된 건지
   * 아무도 설명할 수 없게 된다.
   */
  for (const { from, to } of spanByUser.values()) {
    for (const d of [from, to]) {
      await assertPeriodOpen(viewer.orgId, d, rules, "임포트를 무효화할");
    }
  }

  const removed = await db
    .delete(attendanceLogs)
    .where(eq(attendanceLogs.importBatchId, batchId))
    .returning({ id: attendanceLogs.id });

  await db
    .update(importBatches)
    .set({ revokedAt: now(), revokedBy: viewer.id })
    .where(eq(importBatches.id, batchId));

  // 지운 만큼 파생 집계를 다시 만든다
  for (const [userId, span] of spanByUser) {
    await recomputeWorkDays({
      orgId: viewer.orgId,
      userId,
      from: span.from,
      to: span.to,
      rules: rules.attendance,
      asOf: now(),
    });
  }
  await syncNotifications(viewer.orgId, now());

  return {
    fileName: batch.fileName,
    removed: removed.length,
    people: spanByUser.size,
  };
}

/** 아직 무효화되지 않은 최근 배치 (화면 기본 표시용) */
export const activeBatchCount = async (orgId: string) =>
  (
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(importBatches)
      .where(and(eq(importBatches.orgId, orgId), isNull(importBatches.revokedAt)))
  )[0].n;

export const fmtWhen = (d: Date, zone: string) =>
  DateTime.fromJSDate(d, { zone }).toFormat("M월 d일 HH:mm");
