import { DateTime } from "luxon";
import type { DayFlag } from "./attendance/types";

/**
 * 화면 표시용 포매터와 라벨.
 *
 * 예전에는 hm() 이 7개 파일, WEEKDAY 가 6개 파일, 휴가·보정 라벨이 9개 파일에
 * 흩어져 있었다. 그리고 이미 갈라져 있었다 — hm() 중 app/page.tsx 하나만 음수
 * 부호를 처리하고 나머지 6개는 Math.abs 만 해서 −30분이 "30분"으로 나왔다.
 *
 * 라벨은 DB enum 과 짝이 맞아야 하므로 Record<enum, string> 으로 두어
 * 값을 추가하면 타입 검사가 빠뜨린 자리를 잡아준다.
 */

export const WEEKDAY = ["월", "화", "수", "목", "금", "토", "일"] as const;

/** Luxon weekday(1=월) → 한글 요일 */
export const dowOf = (weekday: number) => WEEKDAY[weekday - 1];

/**
 * 분 → "8시간 30분". 음수는 부호를 붙인다 (페이스 부족분 등에 쓰인다).
 */
export function hm(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}분`;
  if (m === 0) return `${sign}${h}시간`;
  return `${sign}${h}시간 ${m}분`;
}

/** 시각 → "09:30". null 이면 null (호출부가 "—" 같은 걸 고르게 둔다) */
export function clock(date: Date | null | undefined, zone: string) {
  return date ? DateTime.fromJSDate(date, { zone }).toFormat("HH:mm") : null;
}

/** 시각 → "09:30". null 이면 빈 문자열 (input defaultValue 용) */
export const clockOrEmpty = (date: Date | null | undefined, zone: string) =>
  clock(date, zone) ?? "";

/** "2026-07-28" → "7월 28일" */
export const md = (date: string, zone: string) =>
  DateTime.fromISO(date, { zone }).toFormat("M월 d일");

/** "2026-07-28" → { md: "7/28", dow: "화" } */
export function dateLabel(date: string, zone: string) {
  const dt = DateTime.fromISO(date, { zone });
  return { md: dt.toFormat("M/d"), dow: dowOf(dt.weekday) };
}

/** 정산기간 안의 날짜를 순서대로 */
export function eachDate(start: string, end: string, zone: string): string[] {
  const out: string[] = [];
  let cursor = DateTime.fromISO(start, { zone });
  const last = DateTime.fromISO(end, { zone });
  while (cursor <= last) {
    out.push(cursor.toISODate()!);
    cursor = cursor.plus({ days: 1 });
  }
  return out;
}

export const FLAG_LABEL: Record<DayFlag, string> = {
  core_time_violation: "의무근로시간대 미준수",
  outside_flex_band: "선택시간대 밖 근무",
  over_daily_limit: "1일 상한 초과",
  zero_stay: "태그 중복 인식",
  holiday_work: "휴일 근무",
};

export const TIME_OFF_LABEL = {
  full: "연차",
  half_am: "오전 반차",
  half_pm: "오후 반차",
  unpaid: "무급휴가",
} as const;

export const ADJUST_KIND_LABEL = {
  missing_tag: "시각 보정",
  field_work: "외근·출장",
  correction: "정정",
  revert: "보정 취소",
} as const;

/** 근무 구간의 출처 */
export const SESSION_SOURCE_LABEL = {
  app: "앱에서 시작",
  badge: "사원증 기록",
  import: "가져온 기록",
  manual: "직접 입력",
} as const;

export const ROLE_LABEL = {
  member: "사원",
  manager: "팀장",
  hr: "HR",
  executive: "임원",
} as const;
