import { eq, inArray } from "drizzle-orm";
import { db } from "./client";
import { attendanceLogs, importBatches, users } from "./schema";
import { AccessDenied, loadOrgRules, type Viewer } from "./access";
import { recomputeWorkDays } from "./recompute";
import { syncNotifications } from "./notify";
import { mapRows, parseCsv, type ColumnMapping } from "@/lib/csv";
import { resolveWorkDate } from "@/lib/attendance/compute";

import type { ImportReport } from "@/lib/import-types";

export type { ImportReport };

const CHUNK = 500;

/**
 * CSV 반영. 브라우저에서 미리보기를 했더라도 서버가 다시 파싱한다 —
 * 클라이언트가 보낸 파싱 결과를 믿으면 안 된다.
 */
export async function applyImport(opts: {
  viewer: Viewer;
  fileName: string;
  text: string;
  mapping: ColumnMapping;
}): Promise<ImportReport> {
  const { viewer, fileName, text, mapping } = opts;

  if (viewer.role !== "hr") {
    throw new AccessDenied("근태 파일 반영은 HR 권한이 필요합니다.");
  }

  const rules = await loadOrgRules(viewer.orgId);
  const table = parseCsv(text);
  const { tags, errors } = mapRows(table, mapping, rules.attendance.timezone);

  // 사번 → 사용자
  const employeeNos = [...new Set(tags.map((t) => t.employeeNo))];
  const known =
    employeeNos.length > 0
      ? await db
          .select({
            id: users.id,
            name: users.name,
            employeeNo: users.employeeNo,
          })
          .from(users)
          .where(inArray(users.employeeNo, employeeNos))
      : [];

  const userByEmployeeNo = new Map(known.map((u) => [u.employeeNo, u]));

  const unknownCounts = new Map<string, number>();
  const resolvable: typeof tags = [];
  for (const tag of tags) {
    if (userByEmployeeNo.has(tag.employeeNo)) resolvable.push(tag);
    else
      unknownCounts.set(
        tag.employeeNo,
        (unknownCounts.get(tag.employeeNo) ?? 0) + 1,
      );
  }

  const [batch] = await db
    .insert(importBatches)
    .values({
      orgId: viewer.orgId,
      uploadedBy: viewer.id,
      fileName,
      columnMapping: mapping as Record<string, string>,
      rowCount: table.rows.length,
    })
    .returning();

  let inserted = 0;
  for (let i = 0; i < resolvable.length; i += CHUNK) {
    const slice = resolvable.slice(i, i + CHUNK);
    const written = await db
      .insert(attendanceLogs)
      .values(
        slice.map((tag) => ({
          orgId: viewer.orgId,
          userId: userByEmployeeNo.get(tag.employeeNo)!.id,
          occurredAt: tag.occurredAt,
          direction: tag.direction,
          deviceLabel: tag.deviceLabel ?? "",
          source: "import" as const,
          importBatchId: batch.id,
          raw: tag.raw,
        })),
      )
      // 같은 파일을 두 번 올려도 중복이 쌓이지 않는다
      .onConflictDoNothing()
      .returning({ id: attendanceLogs.id });
    inserted += written.length;
  }

  const duplicates = resolvable.length - inserted;

  await db
    .update(importBatches)
    .set({
      insertedCount: inserted,
      skippedCount: duplicates + errors.length + (tags.length - resolvable.length),
    })
    .where(eq(importBatches.id, batch.id));

  // 태그가 들어온 사람·기간만 다시 계산한다
  const spans = new Map<string, { from: string; to: string; name: string }>();
  for (const tag of resolvable) {
    const user = userByEmployeeNo.get(tag.employeeNo)!;
    const workDate = resolveWorkDate(tag.occurredAt, rules.attendance);
    const span = spans.get(user.id);
    if (!span) {
      spans.set(user.id, { from: workDate, to: workDate, name: user.name });
    } else {
      if (workDate < span.from) span.from = workDate;
      if (workDate > span.to) span.to = workDate;
    }
  }

  const recomputed: ImportReport["recomputed"] = [];
  for (const [userId, span] of spans) {
    const days = await recomputeWorkDays({
      orgId: viewer.orgId,
      userId,
      from: span.from,
      to: span.to,
      rules: rules.attendance,
    });
    recomputed.push({
      name: span.name,
      from: span.from,
      to: span.to,
      days: days.length,
    });
  }

  // 임포트로 미완료·위반이 생겼을 수 있으니 알림을 다시 맞춘다
  await syncNotifications(viewer.orgId);

  return {
    batchId: batch.id,
    fileName,
    rowCount: table.rows.length,
    inserted,
    duplicates,
    unknownEmployees: [...unknownCounts.entries()]
      .map(([employeeNo, rows]) => ({ employeeNo, rows }))
      .sort((a, b) => b.rows - a.rows),
    errors: errors.map((e) => ({ rowIndex: e.rowIndex, reason: e.reason })),
    recomputed: recomputed.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
