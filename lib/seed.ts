import { DateTime } from "luxon";
import type { AttendanceRules, TagInput } from "./attendance/types";
import type { SettlementRules } from "./attendance/settle";

/**
 * DB를 붙이기 전 화면을 확인하기 위한 시드 데이터.
 *
 * 계산 엔진이 DB를 모르는 순수 함수라서 가짜 태그만 넣어도 대시보드가 그대로 나온다.
 * 실제로는 org_settings / users / attendance_logs 에서 읽어온다.
 */

export const DEMO_ZONE = "Asia/Seoul";

export const demoAttendanceRules: AttendanceRules = {
  timezone: DEMO_ZONE,
  dayBoundaryHour: 5,
  breakRules: [
    { overHours: 4, deductMinutes: 30 },
    { overHours: 8, deductMinutes: 60 },
  ],
  coreTime: { start: "11:00", end: "15:00" },
  flexBand: { start: "07:00", end: "22:00" },
  nightWindow: { start: "22:00", end: "06:00" },
  dailyLimitMinutes: 12 * 60,
  weekendDays: [6, 7],
  holidays: [],
};

export const demoSettlementRules: SettlementRules = {
  timezone: DEMO_ZONE,
  weekendDays: [6, 7],
  holidays: [],
  targetCalcMethod: "business_days",
  standardMinutesPerDay: 8 * 60,
  fixedTargetMinutes: 40 * 60,
  legalWeeklyMinutes: 40 * 60,
  maxAvgWeeklyMinutes: 52 * 60,
  paceToleranceMinutes: 60,
};

export const demoEmployee = {
  name: "김도윤",
  team: "플랫폼팀",
  employeeNo: "F2019-041",
};

/** 정산기간 — 주 단위(월~일) */
export const demoPeriod = { start: "2026-07-20", end: "2026-07-26" };

/**
 * 기준 시각: 금요일 오전.
 * CSV 임포트 기반이라 데이터는 목요일까지만 들어와 있다 — 실제 운영 모습이다.
 */
export const demoNow = DateTime.fromISO("2026-07-24T09:30", {
  zone: DEMO_ZONE,
}).toJSDate();

const at = (iso: string): TagInput => ({
  occurredAt: DateTime.fromISO(iso, { zone: DEMO_ZONE }).toJSDate(),
  direction: "unknown",
  deviceLabel: "본사 3층 게이트",
});

/**
 * 사원증·지문 태그 원본.
 * 점심에 나갔다 오는 게 정상이므로 하루에 여러 번 찍힌다 — 첫·마지막만 쓴다.
 */
export const demoTags: TagInput[] = [
  // 월 — 정상 근무
  at("2026-07-20T09:12"),
  at("2026-07-20T12:04"),
  at("2026-07-20T13:01"),
  at("2026-07-20T19:05"),
  // 화 — 늦게 출근하고 늦게 퇴근
  at("2026-07-21T10:35"),
  at("2026-07-21T12:30"),
  at("2026-07-21T13:20"),
  at("2026-07-21T20:20"),
  // 수 — 11:40 출근이라 의무근로시간대(11:00~) 미준수
  at("2026-07-22T11:40"),
  at("2026-07-22T15:10"),
  at("2026-07-22T18:30"),
  // 목 — 퇴근 태그 누락. 집계에서 빠지고 확인 필요로 올라간다
  at("2026-07-23T09:05"),
];
