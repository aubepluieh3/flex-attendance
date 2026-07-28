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

/** 앱으로만 근무를 찍은 날 (사원증 태그를 넣지 않는 날) */
function appOnlyDates(asOf: Date) {
  const days = businessDays(demoPeriods(asOf).last.start, demoPeriods(asOf).last.end);
  return {
    /** 이하람: 오전 + 저녁으로 나눠 근무 */
    split: days[1],
    /** 박준영: 종료를 누르지 않고 퇴근 */
    forgot: days[4] ?? days[days.length - 1],
  };
}

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

  // 앱으로만 찍은 날은 사원증 태그를 넣지 않는다. 겹치면 계산은 맞지만
  // (구간이 합쳐진다) 데모로서는 무슨 일이 있었는지 읽히지 않는다.
  const appOnly = appOnlyDates(asOf);

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
    if (d !== appOnly.split) haram.push(...normalDay(d, "08:40", "18:20"));
    // 박준영은 길게 일해서 주 52시간에 가까워진다
    if (d !== appOnly.forgot) junyoung.push(...normalDay(d, "08:30", "22:30"));
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

export type DemoTimeOff = {
  employeeNo: string;
  date: string;
  kind: "full" | "half_am" | "half_pm" | "unpaid";
  reason: string;
  status: "pending" | "approved";
};

/**
 * 휴가 신청.
 *
 * 승인 대기 1건이 없으면 팀장 화면의 승인 흐름을 아무도 볼 수 없다.
 * 승인된 반차 1건은 "반차 쓰고 반나절 일한 날"이 확인 대상으로 안 올라가는지
 * 보는 용도다 — 이게 걸리면 아무도 반차를 신청하지 않는다.
 */
export function demoTimeOffFor(asOf: Date = now()): DemoTimeOff[] {
  const { today, current, last } = demoPeriods(asOf);
  const upcoming =
    businessDays(current.start, current.end).find((d) => d > today) ??
    current.end;
  const halfDay = businessDays(last.start, last.end)[2];

  return [
    {
      employeeNo: "F2019-041",
      date: upcoming,
      kind: "full",
      reason: "병원 예약",
      status: "pending",
    },
    {
      employeeNo: "F2021-117",
      date: halfDay,
      kind: "half_pm",
      reason: "가족 행사",
      status: "approved",
    },
  ];
}

export type DemoSession = {
  employeeNo: string;
  workDate: string;
  startedAt: Date;
  endedAt: Date | null;
  source: "app" | "manual";
  closedManually: boolean;
  closedNote: string;
};

/**
 * 앱에서 직접 찍은 근무 구간.
 *
 * 태그만 넣으면 기획서 1번(나눠 근무·종료 깜빡)이 화면에 안 나온다. 처음 켠
 * 사람이 그 두 경우를 바로 볼 수 있게 지난주에 심어 둔다.
 */
export function demoSessionsFor(asOf: Date = now()): DemoSession[] {
  const span = (date: string, hm: string) =>
    DateTime.fromISO(`${date}T${hm}`, { zone: DEMO_ZONE }).toJSDate();
  const { split, forgot } = appOnlyDates(asOf);

  return [
    {
      employeeNo: "F2016-008",
      workDate: split,
      startedAt: span(split, "09:00"),
      endedAt: span(split, "12:00"),
      source: "app",
      closedManually: false,
      closedNote: "",
    },
    {
      employeeNo: "F2016-008",
      workDate: split,
      startedAt: span(split, "19:00"),
      endedAt: span(split, "21:00"),
      source: "app",
      closedManually: false,
      closedNote: "",
    },
    {
      employeeNo: "F2021-117",
      workDate: forgot,
      startedAt: span(forgot, "09:30"),
      endedAt: null,
      source: "app",
      closedManually: false,
      closedNote: "",
    },
  ];
}
