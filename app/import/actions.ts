"use server";

import { requestViewer } from "../viewer";
import { rethrowControlFlow } from "../action-error";
import { applyImport, type ImportReport } from "@/db/import";
import { closeDueIfStale } from "@/db/close";
import { now } from "@/lib/clock";
import type { ColumnMapping } from "@/lib/csv";

export type ImportState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "done"; report: ImportReport };

export async function importAction(
  _prev: ImportState,
  form: FormData,
): Promise<ImportState> {
  const file = form.get("file");
  const mappingJson = form.get("mapping");

  if (!(file instanceof File) || file.size === 0) {
    return { kind: "error", message: "파일을 선택해 주세요." };
  }
  if (typeof mappingJson !== "string") {
    return { kind: "error", message: "컬럼 매핑이 없습니다." };
  }

  let mapping: ColumnMapping;
  try {
    mapping = JSON.parse(mappingJson) as ColumnMapping;
  } catch {
    return { kind: "error", message: "컬럼 매핑을 읽을 수 없습니다." };
  }

  if (!mapping.employeeNo) {
    return { kind: "error", message: "사번 컬럼을 지정해 주세요." };
  }
  if (!mapping.timestamp && !(mapping.date && mapping.time)) {
    return {
      kind: "error",
      message: "일시 컬럼, 또는 날짜와 시각 컬럼을 지정해 주세요.",
    };
  }

  try {
    const viewer = await requestViewer();

    /*
     * 임포트 전에 마감을 돌린다. 문턱을 건너뛴다(force).
     *
     * 늦게 온 파일이 확정된 과거를 덮어쓰는 것을 막는 게 마감의 목적이다.
     * 여기서 몇 분 늦으면 바로 그 사고가 난다. 임포트는 드물고 수동이므로
     * 매번 돌려도 비싸지 않다.
     */
    await closeDueIfStale(viewer.orgId, now(), { force: true });

    const report = await applyImport({
      viewer,
      fileName: file.name,
      text: await file.text(),
      mapping,
    });
    return { kind: "done", report };
  } catch (e) {
    rethrowControlFlow(e);
    return { kind: "error", message: (e as Error).message };
  }
}
