import { DateTime } from "luxon";

/**
 * 사용자 입력 날짜 검증.
 *
 * 형식만 정규식으로 보면 2026-02-30 이나 2026-13-01 이 통과해서 Postgres
 * 에러가 화면에 그대로 나온다. Luxon 으로 실제 존재하는 날짜인지 본다.
 *
 * 예전에 db/settings.ts 와 db/timeoff.ts 에 이름은 같고 동작이 다른 두 개가
 * 있었다 — 한쪽은 타임존이 없고 정규화도 안 했다. HR 이 등록한 휴가와 본인이
 * 신청한 휴가의 날짜 처리가 달라지는 상태였다.
 */
export function assertDate(
  value: string,
  label: string,
  zone = "Asia/Seoul",
): string {
  const text = String(value ?? "").trim();
  const dt = DateTime.fromFormat(text, "yyyy-MM-dd", { zone });
  if (!dt.isValid) {
    throw new Error(`${label}가 올바른 날짜가 아닙니다: "${text}"`);
  }
  return dt.toISODate()!;
}

/** "HH:MM" 검증 */
export function assertHhmm(value: string, label: string): string {
  const text = String(value ?? "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    throw new Error(`${label}를 HH:MM 형식으로 넣어 주세요: "${text}"`);
  }
  return text;
}
