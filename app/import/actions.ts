"use server";

import { requestViewer } from "../viewer";
import { applyImport, type ImportReport } from "@/db/import";
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
    const report = await applyImport({
      viewer,
      fileName: file.name,
      text: await file.text(),
      mapping,
    });
    return { kind: "done", report };
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
}
