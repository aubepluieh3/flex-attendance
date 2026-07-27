import { DateTime } from "luxon";
import type { AttendanceRules, TagInput } from "./attendance/types";
import type { SettlementRules } from "./attendance/settle";
import { resolvePeriod, shiftPeriod } from "./attendance/period";
import { now } from "./clock";

/**
 * 개발용 시드 데이터.
 *
 * 고정 날짜를 쓰면 실제 오늘과 어긋나서 화면이 고장 난 것처럼 보인다. 그래서
 * 기준 시각으로부터 상대적으로 생성한다 — DEMO_CLOCK 없이도 항상 맞는 주가
 * 나온다.
 *
 * 태그는 "어제까지" 들어온 것으로 만든다. CSV 임포트 기반이라 오늘 데이터가
 * 없는 게 정상이고, 그 상태에서 화면이 뭐라고 말하는지가 진짜 시험이다.
 */

export const DEMO_ZONE = "Asia/Seoul";
export const DEMO_PASSWORD = "flex-demo-1234";

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

export const demoPeople = [
  { name: "김도윤", employeeNo: "F2019-041", role: "member", team: "squad" },
  { name: "이하람", employeeNo: "F2016-008", role: "manager", team: "squad" },
  { name: "박준영", employeeNo: "F2021-117", role: "member", team: "squad" },
  { name: "정세아", employeeNo: "F2014-002", role: "hr", team: "hq" },
  { name: "최민서", employeeNo: "F2009-001", role: "executive", team: "hq" },
] as const;

const opts = { kind: "week" as const, weekStartDay: 1, timezone: DEMO_ZONE };

/** 이번 주 / 지난주 / 2주 전 */
export function demoPeriods(asOf: Date = now()) {
  const today = DateTime.fromJSDate(asOf, { zone: DEMO_ZONE }).toISODate()!;
  const current = resolvePeriod(today, opts);
  return {
    today,
    current,
    last: shiftPeriod(current, -1, opts),
    twoAgo: shiftPeriod(current, -2, opts),
  };
}

const at = (date: string, hm: string): TagInput => ({
  occurredAt: DateTime.fromISO(`${date}T${hm}`, { zone: DEMO_ZONE }).toJSDate(),
  direction: "unknown",
  deviceLabel: "본사 3층 게이트",
});

function businessDays(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = DateTime.fromISO(from, { zone: DEMO_ZONE });
  const last = DateTime.fromISO(to, { zone: DEMO_ZONE });
  while (cursor <= last) {
    if (cursor.weekday <= 5) out.push(cursor.toISODate()!);
    cursor = cursor.plus({ days: 1 });
  }
  return out;
}

/** 하루 정상 근무 — 점심에 나갔다 오므로 태그가 4개다 */
const normalDay = (date: string, inHm: string, outHm: string): TagInput[] => [
  at(date, inHm),
  at(date, "12:04"),
  at(date, "13:01"),
  at(date, outHm),
];

export type DemoTags = { employeeNo: string; tags: TagInput[] };

/**
 * 사람별 태그. 오늘은 넣지 않는다 (아직 임포트 안 된 상태).
 *
 * 지난주에 일부러 문제를 하나씩 심는다 — 미완료(퇴근 누락)와 코어타임 미준수.
 * 그래야 "확인 필요"와 알림이 실제로 뜨는 화면을 볼 수 있다.
 */
export function demoTagsFor(asOf: Date = now()): DemoTags[] {
  const { today, current, last, twoAgo } = demoPeriods(asOf);

  const upToYesterday = (dates: string[]) => dates.filter((d) => d < today);
  const currentDays = upToYesterday(businessDays(current.start, current.end));
  const lastDays = businessDays(last.start, last.end);
  const twoAgoDays = businessDays(twoAgo.start, twoAgo.end);

  const dayun: TagInput[] = [];
  const haram: TagInput[] = [];
  const junyoung: TagInput[] = [];

  for (const d of twoAgoDays) {
    dayun.push(...normalDay(d, "09:12", "19:05"));
    haram.push(...normalDay(d, "08:40", "18:20"));
    junyoung.push(...normalDay(d, "10:05", "20:10"));
  }

  lastDays.forEach((d, i) => {
    if (i === 2) {
      // 코어타임(11:00~) 이후 출근 → 미준수
      dayun.push(at(d, "11:40"), at(d, "15:10"), at(d, "18:30"));
    } else if (i === 3) {
      // 퇴근 태그 누락 → 미완료
      dayun.push(at(d, "09:05"));
    } else {
      dayun.push(...normalDay(d, "09:12", "19:05"));
    }
    haram.push(...normalDay(d, "08:40", "18:20"));
    // 박준영은 길게 일해서 주 52시간에 가까워진다
    junyoung.push(...normalDay(d, "08:30", "22:30"));
  });

  for (const d of currentDays) {
    dayun.push(...normalDay(d, "09:20", "18:50"));
    haram.push(...normalDay(d, "08:45", "18:10"));
    junyoung.push(...normalDay(d, "09:00", "19:30"));
  }

  return [
    { employeeNo: "F2019-041", tags: dayun },
    { employeeNo: "F2016-008", tags: haram },
    { employeeNo: "F2021-117", tags: junyoung },
  ];
}
