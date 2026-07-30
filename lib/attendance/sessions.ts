import { DateTime, Interval } from "luxon";
import { byIsoDate } from "../collate";
import { autoBreakMinutesFor, resolveWorkDate } from "./compute";
import type {
  AttendanceRules,
  ComputedDay,
  DayFlag,
  HourMinute,
  TagInput,
} from "./types";

/**
 * 근무 세션.
 *
 * 기획서 요구: "하루에 여러 번 나눠서 일하는 경우(오전 3h + 저녁 2h) 지원".
 * 첫 태그~마지막 태그로 계산하면 낮에 일하지 않은 시간까지 근무로 센다.
 * 세션 단위로 받아 합산해야 요구가 성립한다.
 *
 * endedAt 이 null 이면 진행 중이다 — 오늘이면 "근무 중", 지난 날이면 체크아웃 누락.
 */
export type WorkSession = {
  startedAt: Date;
  /** null = 진행 중 */
  endedAt: Date | null;
  source: "app" | "import" | "manual";
};

const parseHm = (hm: HourMinute): number => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

const minutesBetween = (a: Date, b: Date) =>
  Math.round((b.getTime() - a.getTime()) / 60_000);

/**
 * 사원증·지문 태그 → 세션.
 *
 * 방향(in/out)이 있으면 쌍으로 묶는다. 없으면(지문 단말은 방향 없이 찍는 경우가
 * 많다) 하루의 첫 태그~마지막 태그를 한 세션으로 본다 — 중간 이탈을 알 수 없으므로
 * 그게 유일하게 방어 가능한 해석이다.
 */
export function sessionsFromTags(
  tags: TagInput[],
  rules: AttendanceRules,
): WorkSession[] {
  if (tags.length === 0) return [];

  const sorted = [...tags].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  const directed = sorted.filter((t) => t.direction === "in" || t.direction === "out");

  // 방향이 하나도 없으면 날짜별 첫~마지막
  if (directed.length === 0) return spanSessions(sorted, rules);

  const out: WorkSession[] = [];
  let openAt: Date | null = null;

  for (const tag of sorted) {
    if (tag.direction === "in") {
      // 연속 입장은 마지막 것을 쓴다 (재인증·중복 태그)
      openAt = tag.occurredAt;
    } else if (tag.direction === "out") {
      if (!openAt) continue; // 짝 없는 퇴장은 버린다
      if (tag.occurredAt.getTime() > openAt.getTime()) {
        out.push({ startedAt: openAt, endedAt: tag.occurredAt, source: "import" });
      }
      openAt = null;
    }
  }

  // 입장만 있고 퇴장이 없으면 진행 중으로 남긴다
  if (openAt) out.push({ startedAt: openAt, endedAt: null, source: "import" });

  return out;
}

/** 방향을 모를 때: 날짜별 첫 태그 ~ 마지막 태그 한 세션 */
function spanSessions(
  sorted: TagInput[],
  rules: AttendanceRules,
): WorkSession[] {
  const byDate = new Map<string, TagInput[]>();
  for (const tag of sorted) {
    const key = resolveWorkDate(tag.occurredAt, rules);
    const list = byDate.get(key);
    if (list) list.push(tag);
    else byDate.set(key, [tag]);
  }

  const out: WorkSession[] = [];
  for (const list of byDate.values()) {
    const first = list[0].occurredAt;
    const last = list[list.length - 1].occurredAt;
    out.push({
      startedAt: first,
      // 태그가 하나거나 전부 같은 시각이면 퇴근을 모른다
      endedAt: last.getTime() > first.getTime() ? last : null,
      source: "import",
    });
  }
  return out;
}

/** 겹치는 세션을 합친다 (앱 기록과 사원증 기록이 겹칠 수 있다) */
function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.isValid && i.length("minutes") > 0)
    .sort((a, b) => a.start!.toMillis() - b.start!.toMillis());

  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start! <= last.end!) {
      out[out.length - 1] = Interval.fromDateTimes(
        last.start!,
        cur.end! > last.end! ? cur.end! : last.end!,
      );
    } else {
      out.push(cur);
    }
  }
  return out;
}

function nightOverlap(
  intervals: Interval[],
  rules: AttendanceRules,
): number {
  const startMin = parseHm(rules.nightWindow.start);
  const endMin = parseHm(rules.nightWindow.end);
  const spanEnd = endMin <= startMin ? endMin + 24 * 60 : endMin;

  let total = 0;
  for (const iv of intervals) {
    let cursor = iv.start!.startOf("day").minus({ days: 1 });
    const last = iv.end!.startOf("day");
    while (cursor <= last) {
      const night = Interval.fromDateTimes(
        cursor.plus({ minutes: startMin }),
        cursor.plus({ minutes: spanEnd }),
      );
      const hit = iv.intersection(night);
      if (hit) total += hit.length("minutes");
      cursor = cursor.plus({ days: 1 });
    }
  }
  return Math.round(total);
}

function bandInterval(
  workDate: string,
  band: { start: HourMinute; end: HourMinute },
  zone: string,
): Interval {
  const dayStart = DateTime.fromISO(workDate, { zone }).startOf("day");
  const startMin = parseHm(band.start);
  const endMin = parseHm(band.end);
  const spanEnd = endMin <= startMin ? endMin + 24 * 60 : endMin;
  return Interval.fromDateTimes(
    dayStart.plus({ minutes: startMin }),
    dayStart.plus({ minutes: spanEnd }),
  );
}

function isHolidayDate(workDate: string, rules: AttendanceRules): boolean {
  if (rules.holidays.includes(workDate)) return true;
  const weekday = DateTime.fromISO(workDate, { zone: rules.timezone }).weekday;
  return rules.weekendDays.includes(weekday);
}

/** 코어타임이 근무 구간에 완전히 덮이는지 */
function coreCovered(core: Interval, merged: Interval[]): boolean {
  let remaining: Interval[] = [core];
  for (const iv of merged) {
    const next: Interval[] = [];
    for (const r of remaining) next.push(...r.difference(iv));
    remaining = next;
    if (remaining.length === 0) return true;
  }
  return remaining.length === 0;
}

/**
 * 세션 → 일별 집계.
 *
 * 실근무 = Σ(세션 − 세션별 휴게). 휴게를 하루 합계에 한 번 적용하면 오전 3h +
 * 저녁 2h 를 4.5h 로 깎아 실제 일한 시간을 부정한다. 세션마다 적용하면 짧게
 * 나눠 일한 사람이 손해를 보지 않고, 연속 8시간 세션에는 법정 휴게가 붙는다.
 *
 * @param asOf 이 시각의 날짜에 열린 세션이 있으면 "근무 중"으로 본다.
 *             지난 날의 열린 세션은 체크아웃 누락이다.
 */
export function computeWorkDaysFromSessions(
  sessions: WorkSession[],
  rules: AttendanceRules,
  asOf: Date,
): ComputedDay[] {
  const zone = rules.timezone;
  const today = resolveWorkDate(asOf, rules);

  const byDate = new Map<string, WorkSession[]>();
  for (const s of sessions) {
    const key = resolveWorkDate(s.startedAt, rules);
    const list = byDate.get(key);
    if (list) list.push(s);
    else byDate.set(key, [s]);
  }

  const days: ComputedDay[] = [];

  for (const [workDate, list] of byDate) {
    const sorted = [...list].sort(
      (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
    );
    const open = sorted.filter((s) => s.endedAt === null);
    const closed = sorted.filter(
      (s): s is WorkSession & { endedAt: Date } => s.endedAt !== null,
    );

    const intervals = mergeIntervals(
      closed.map((s) =>
        Interval.fromDateTimes(
          DateTime.fromJSDate(s.startedAt, { zone }),
          DateTime.fromJSDate(s.endedAt, { zone }),
        ),
      ),
    );

    // 실근무: 합쳐진 구간마다 휴게를 적용한다
    let workMinutes = 0;
    let autoBreakMinutes = 0;
    for (const iv of intervals) {
      const span = Math.round(iv.length("minutes"));
      const deduct = autoBreakMinutesFor(span, rules.autoBreakRules);
      autoBreakMinutes += deduct;
      workMinutes += Math.max(0, span - deduct);
    }

    const firstInAt = sorted[0].startedAt;
    const lastOutAt = closed.length
      ? closed.reduce(
          (max, s) => (s.endedAt > max ? s.endedAt : max),
          closed[0].endedAt,
        )
      : null;

    const isHoliday = isHolidayDate(workDate, rules);
    const flags: DayFlag[] = [];

    // 진행 중이면 아직 판정하지 않는다. 근무가 끝나지 않았는데 위반이라고
    // 말하면 사용자가 하루 종일 경고를 보게 된다.
    const isOpen = open.length > 0;
    const status: ComputedDay["status"] =
      isOpen && workDate === today
        ? "open"
        : isOpen
          ? "incomplete"
          : "computed";

    if (status === "computed") {
      if (rules.coreTime && !isHoliday) {
        const core = bandInterval(workDate, rules.coreTime, zone);
        if (!coreCovered(core, intervals)) flags.push("core_time_violation");
      }
      if (rules.flexBand) {
        const band = bandInterval(workDate, rules.flexBand, zone);
        const outside = intervals.some(
          (iv) => iv.start! < band.start! || iv.end! > band.end!,
        );
        if (outside) flags.push("outside_flex_band");
      }
      if (
        rules.dailyLimitMinutes !== null &&
        workMinutes > rules.dailyLimitMinutes
      ) {
        flags.push("over_daily_limit");
      }
      if (isHoliday) flags.push("holiday_work");
    }

    days.push({
      workDate,
      firstInAt,
      lastOutAt,
      stayMinutes: lastOutAt ? minutesBetween(firstInAt, lastOutAt) : 0,
      autoBreakMinutes,
      // 진행 중인 날은 아직 확정 근무시간이 아니다. 완료된 세션만 센다.
      workMinutes,
      nightMinutes: nightOverlap(intervals, rules),
      isHoliday,
      flags,
      status,
      tagCount: sorted.length,
      sessionCount: sorted.length,
      openSince: isOpen ? open[0].startedAt : null,
    });
  }

  return days.sort(byIsoDate((d) => d.workDate));
}

/**
 * 태그와 앱 세션을 함께 넣어 계산한다.
 *
 * 태그에서만 알 수 있는 것(태그 수, 지문 중복 인식)은 여기서 채운다.
 * 세션만 보면 "태그가 두 번 찍혔는데 체류가 0분"인 상황을 구분할 수 없다.
 */
export function computeWorkDays(
  input: { tags: TagInput[]; sessions: WorkSession[] },
  rules: AttendanceRules,
  asOf: Date,
): ComputedDay[] {
  const days = computeWorkDaysFromSessions(
    [...sessionsFromTags(input.tags, rules), ...input.sessions],
    rules,
    asOf,
  );

  const tagsByDate = new Map<string, TagInput[]>();
  for (const tag of input.tags) {
    const key = resolveWorkDate(tag.occurredAt, rules);
    const list = tagsByDate.get(key);
    if (list) list.push(tag);
    else tagsByDate.set(key, [tag]);
  }

  return days.map((day) => {
    const tags = tagsByDate.get(day.workDate) ?? [];
    if (tags.length === 0) return day;

    const times = tags.map((t) => t.occurredAt.getTime());
    // 태그는 여럿인데 전부 같은 시각 — 지문이 연달아 인식된 경우
    const zeroStay =
      tags.length > 1 && Math.max(...times) === Math.min(...times);

    return {
      ...day,
      tagCount: tags.length,
      flags: zeroStay ? [...day.flags, "zero_stay" as DayFlag] : day.flags,
    };
  });
}

/**
 * 진행 중 세션을 포함한 "지금까지" 근무시간.
 *
 * work_days 에는 완료된 세션만 넣는다 — 확정 집계가 초 단위로 흔들리면 안 된다.
 * 화면에서 "오늘 지금까지 N시간"을 보여줄 때만 이걸 쓴다.
 */
export function minutesIncludingOpen(
  day: ComputedDay,
  rules: AttendanceRules,
  asOf: Date,
): number {
  if (!day.openSince) return day.workMinutes;
  const span = minutesBetween(day.openSince, asOf);
  if (span <= 0) return day.workMinutes;
  const deduct = autoBreakMinutesFor(span, rules.autoBreakRules);
  return day.workMinutes + Math.max(0, span - deduct);
}

/** 실근무가 목표치가 되도록 하는 체류시간 (휴게가 체류에 딸려 붙으므로 역산) */
export function stayForWork(
  targetWork: number,
  rules: AttendanceRules,
): number {
  let stay = targetWork;
  // 휴게 규칙은 계단식이라 몇 번이면 수렴한다
  for (let i = 0; i < 4; i++) {
    const next = targetWork + autoBreakMinutesFor(stay, rules.autoBreakRules);
    if (next === stay) break;
    stay = next;
  }
  return stay;
}

/**
 * "지금 근무 중인데, 오늘 몫을 채우려면 몇 시에 종료하면 되나".
 *
 * 자율출근제 직원이 매일 갖는 질문이고, 이 앱을 여는 이유다.
 * 진행 중 세션에 붙을 휴게까지 역산해야 실제 종료 시각이 나온다.
 */
export function leaveTimeFor(opts: {
  openSince: Date;
  asOf: Date;
  /** 지금부터 더 채워야 하는 실근무 분 */
  neededMinutes: number;
  rules: AttendanceRules;
}): Date | null {
  const { openSince, asOf, neededMinutes, rules } = opts;
  if (neededMinutes <= 0) return null;

  const spanSoFar = Math.max(0, minutesBetween(openSince, asOf));
  const workSoFar = Math.max(
    0,
    spanSoFar - autoBreakMinutesFor(spanSoFar, rules.autoBreakRules),
  );
  const targetSessionWork = workSoFar + neededMinutes;
  const requiredSpan = stayForWork(targetSessionWork, rules);

  return DateTime.fromJSDate(openSince, { zone: rules.timezone })
    .plus({ minutes: requiredSpan })
    .toJSDate();
}
