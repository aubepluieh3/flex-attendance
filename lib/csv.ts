import { DateTime } from "luxon";

/**
 * 근태 시스템 CSV 파싱.
 *
 * 벤더 포맷을 모른다는 게 전제다. 컬럼명·구분자·날짜 형식이 회사마다 다르므로
 * 자동 감지는 "제안"까지만 하고, 최종 매핑은 사람이 확인한다.
 * 여기서 잘못 매핑하면 200명 근태가 통째로 틀어진다.
 */

export type Table = { headers: string[]; rows: string[][] };

/** 구분자 감지 — 헤더 줄에서 가장 많이 나오는 것 */
function detectDelimiter(headerLine: string): string {
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    const count = headerLine.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/**
 * RFC4180 기준 파싱. 따옴표 안의 구분자·줄바꿈·이중따옴표를 처리한다.
 * 엑셀에서 저장한 파일은 BOM이 붙고 줄바꿈이 CRLF인 경우가 많다.
 */
export function parseCsv(text: string): Table {
  const clean = text.replace(/^﻿/, "");
  const firstBreak = clean.search(/\r?\n/);
  const headerLine = firstBreak === -1 ? clean : clean.slice(0, firstBreak);
  const delimiter = detectDelimiter(headerLine);

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];

    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // CRLF의 CR은 버린다
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim());
  return { headers, rows: nonEmpty.slice(1) };
}

// ─────────────────────────────────────────────────────────────

export type ColumnMapping = {
  employeeNo: string;
  /** 날짜와 시각이 한 컬럼일 때 */
  timestamp?: string;
  /** 날짜와 시각이 나뉘어 있을 때 */
  date?: string;
  time?: string;
  direction?: string;
  deviceLabel?: string;
};

const KEYWORDS = {
  employeeNo: ["사번", "사원번호", "직원번호", "사원코드", "empno", "employee"],
  timestamp: ["일시", "인증시각", "인증일시", "발생일시", "출입시각", "datetime", "timestamp"],
  date: ["날짜", "근무일", "출입일", "일자", "date"],
  time: ["시각", "시간", "time"],
  direction: ["출입구분", "구분", "방향", "인증구분", "direction", "type", "inout"],
  deviceLabel: ["단말", "장치", "리더", "게이트", "출입문", "위치", "device", "terminal", "reader"],
} as const;

const normalize = (s: string) => s.toLowerCase().replace(/[\s_()-]/g, "");

function findHeader(headers: string[], keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const target = normalize(key);
    const hit = headers.find((h) => normalize(h).includes(target));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * 헤더 이름으로 매핑을 제안한다. 확정이 아니라 제안이다 — 화면에서 사람이 고친다.
 */
export function suggestMapping(headers: string[]): Partial<ColumnMapping> {
  const timestamp = findHeader(headers, KEYWORDS.timestamp);
  const date = findHeader(headers, KEYWORDS.date);
  const time = findHeader(headers, KEYWORDS.time);

  const suggestion: Partial<ColumnMapping> = {
    employeeNo: findHeader(headers, KEYWORDS.employeeNo),
    direction: findHeader(headers, KEYWORDS.direction),
    deviceLabel: findHeader(headers, KEYWORDS.deviceLabel),
  };

  // 한 컬럼에 날짜+시각이 같이 있는 쪽을 우선한다
  if (timestamp) {
    suggestion.timestamp = timestamp;
  } else if (date && time && date !== time) {
    suggestion.date = date;
    suggestion.time = time;
  } else if (date) {
    suggestion.timestamp = date;
  }

  return suggestion;
}

// ─────────────────────────────────────────────────────────────

/** 벤더별로 흔한 형식들. 위에서부터 시도한다. */
const DATE_FORMATS = [
  "yyyy-MM-dd HH:mm:ss",
  "yyyy-MM-dd HH:mm",
  "yyyy-MM-dd H:mm",
  "yyyy/MM/dd HH:mm:ss",
  "yyyy/MM/dd HH:mm",
  "yyyy.MM.dd HH:mm:ss",
  "yyyy.MM.dd HH:mm",
  "yyyyMMddHHmmss",
  "yyyyMMdd HHmmss",
  "yyyyMMdd HH:mm:ss",
  "yyyy-MM-dd",
  "yyyy/MM/dd",
  "yyyyMMdd",
];

/**
 * 문자열 → 시각. 벤더 파일은 현지 시각(KST)으로 적혀 있으므로 zone을 지정해 읽는다.
 * 여기서 UTC로 잘못 읽으면 전 직원 기록이 9시간씩 밀린다.
 */
export function parseTimestamp(value: string, zone: string): Date | null {
  const text = value.trim();
  if (!text) return null;

  for (const format of DATE_FORMATS) {
    const dt = DateTime.fromFormat(text, format, { zone });
    if (dt.isValid) return dt.toJSDate();
  }

  const iso = DateTime.fromISO(text, { zone });
  return iso.isValid ? iso.toJSDate() : null;
}

const IN_WORDS = ["입장", "출근", "입실", "in", "enter", "1"];
const OUT_WORDS = ["퇴장", "퇴근", "퇴실", "out", "exit", "2"];

export function parseDirection(value: string | undefined): "in" | "out" | "unknown" {
  if (!value) return "unknown";
  const text = normalize(value);
  if (!text) return "unknown";
  if (IN_WORDS.some((w) => text === normalize(w) || text.includes(normalize(w)))) {
    return "in";
  }
  if (OUT_WORDS.some((w) => text === normalize(w) || text.includes(normalize(w)))) {
    return "out";
  }
  return "unknown";
}

// ─────────────────────────────────────────────────────────────

export type ParsedTag = {
  rowIndex: number;
  employeeNo: string;
  occurredAt: Date;
  direction: "in" | "out" | "unknown";
  deviceLabel: string | null;
  raw: Record<string, string>;
};

export type RowError = {
  rowIndex: number;
  reason: string;
  raw: Record<string, string>;
};

export type MapResult = { tags: ParsedTag[]; errors: RowError[] };

/**
 * 행 → 태그. 실패한 행은 버리지 않고 errors로 모은다.
 * 조용히 건너뛰면 임포트가 성공했는데 데이터가 비는 상황이 생긴다.
 */
export function mapRows(
  table: Table,
  mapping: ColumnMapping,
  zone: string,
): MapResult {
  const index = new Map(table.headers.map((h, i) => [h, i]));
  const cell = (row: string[], header: string | undefined) =>
    header !== undefined && index.has(header)
      ? (row[index.get(header)!] ?? "").trim()
      : "";

  const tags: ParsedTag[] = [];
  const errors: RowError[] = [];

  table.rows.forEach((row, i) => {
    const rowIndex = i + 2; // 1-based + 헤더 줄
    const raw: Record<string, string> = {};
    table.headers.forEach((h, j) => {
      raw[h] = row[j] ?? "";
    });

    const employeeNo = cell(row, mapping.employeeNo);
    if (!employeeNo) {
      errors.push({ rowIndex, reason: "사번이 비어 있습니다", raw });
      return;
    }

    const timestampText = mapping.timestamp
      ? cell(row, mapping.timestamp)
      : `${cell(row, mapping.date)} ${cell(row, mapping.time)}`.trim();

    const occurredAt = parseTimestamp(timestampText, zone);
    if (!occurredAt) {
      errors.push({
        rowIndex,
        reason: `일시를 읽을 수 없습니다: "${timestampText}"`,
        raw,
      });
      return;
    }

    const deviceLabel = cell(row, mapping.deviceLabel);
    tags.push({
      rowIndex,
      employeeNo,
      occurredAt,
      direction: parseDirection(cell(row, mapping.direction) || undefined),
      deviceLabel: deviceLabel || null,
      raw,
    });
  });

  return { tags, errors };
}
