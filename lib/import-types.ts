/**
 * 임포트 결과 타입. 화면(클라이언트)과 DB 레이어가 같이 쓰므로
 * 어느 쪽에도 의존하지 않는 곳에 둔다.
 */
export type ImportReport = {
  batchId: string;
  fileName: string;
  rowCount: number;
  inserted: number;
  /** 이미 있던 태그 — 같은 파일을 두 번 올려도 두 배가 되지 않는다 */
  duplicates: number;
  /** 사번이 users에 없는 행 */
  unknownEmployees: { employeeNo: string; rows: number }[];
  /** 파싱 실패한 행 */
  errors: { rowIndex: number; reason: string }[];
  recomputed: { name: string; from: string; to: string; days: number }[];
};
