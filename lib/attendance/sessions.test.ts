import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  computeWorkDays,
  computeWorkDaysFromSessions,
  minutesIncludingOpen,
  sessionsFromTags,
  type WorkSession,
} from "./sessions";
import type { AttendanceRules } from "./types";

const zone = "Asia/Seoul";
const rules: AttendanceRules = {
  timezone: zone,
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

const kst = (iso: string) => DateTime.fromISO(iso, { zone }).toJSDate();
/** 2026-07-20 은 월요일 */
const s = (from: string, to: string | null): WorkSession => ({
  startedAt: kst(from),
  endedAt: to ? kst(to) : null,
  source: "app",
});
const tag = (iso: string, direction?: "in" | "out") => ({
  occurredAt: kst(iso),
  direction: direction ?? ("unknown" as const),
});
const asOf = kst("2026-07-24T20:00");

// ─────────────────────────────────────────────────────────────
describe("하루 여러 번 나눠 일하기 — 기획서 핵심 요구", () => {
  it("오전 3시간 + 저녁 2시간 = 5시간 (사이 공백은 세지 않는다)", () => {
    const [day] = computeWorkDaysFromSessions(
      [
        s("2026-07-20T09:00", "2026-07-20T12:00"),
        s("2026-07-20T19:00", "2026-07-20T21:00"),
      ],
      rules,
      asOf,
    );
    expect(day.workMinutes).toBe(5 * 60);
    expect(day.sessionCount).toBe(2);
    // 첫~마지막으로 세면 12시간이 된다. 그 방식이면 낮에 안 일한 7시간이 들어간다
    expect(day.stayMinutes).toBe(12 * 60);
  });

  it("세션이 각각 4시간 미만이면 휴게를 빼지 않는다", () => {
    const [day] = computeWorkDaysFromSessions(
      [
        s("2026-07-20T09:00", "2026-07-20T12:00"),
        s("2026-07-20T19:00", "2026-07-20T21:00"),
      ],
      rules,
      asOf,
    );
    expect(day.breakMinutes).toBe(0);
  });

  it("연속 9시간 한 세션은 법정 휴게 1시간이 붙는다", () => {
    const [day] = computeWorkDaysFromSessions(
      [s("2026-07-20T09:00", "2026-07-20T18:00")],
      rules,
      asOf,
    );
    expect(day.breakMinutes).toBe(60);
    expect(day.workMinutes).toBe(8 * 60);
  });

  it("세션마다 따로 휴게가 붙는다 (5시간 + 5시간)", () => {
    const [day] = computeWorkDaysFromSessions(
      [
        s("2026-07-20T07:00", "2026-07-20T12:00"),
        s("2026-07-20T14:00", "2026-07-20T19:00"),
      ],
      rules,
      asOf,
    );
    expect(day.breakMinutes).toBe(60); // 30 + 30
    expect(day.workMinutes).toBe(9 * 60);
  });

  it("겹치는 세션은 합친다 (앱 기록과 사원증 기록이 겹칠 때)", () => {
    const [day] = computeWorkDaysFromSessions(
      [
        s("2026-07-20T09:00", "2026-07-20T13:00"),
        s("2026-07-20T12:00", "2026-07-20T18:00"),
      ],
      rules,
      asOf,
    );
    // 09~18 = 9시간, 휴게 1시간
    expect(day.workMinutes).toBe(8 * 60);
    expect(day.breakMinutes).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────
describe("진행 중 세션 — 근무 중 / 체크아웃 누락", () => {
  it("오늘 열린 세션은 근무 중", () => {
    const [day] = computeWorkDaysFromSessions(
      [s("2026-07-24T09:00", null)],
      rules,
      asOf,
    );
    expect(day.status).toBe("open");
    expect(day.openSince).not.toBeNull();
  });

  it("지난 날 열린 세션은 체크아웃 누락", () => {
    const [day] = computeWorkDaysFromSessions(
      [s("2026-07-20T09:00", null)],
      rules,
      asOf,
    );
    expect(day.status).toBe("incomplete");
  });

  it("진행 중인 날은 확정 근무시간에 넣지 않는다", () => {
    const [day] = computeWorkDaysFromSessions(
      [
        s("2026-07-24T09:00", "2026-07-24T12:00"),
        s("2026-07-24T13:00", null),
      ],
      rules,
      asOf,
    );
    // 완료된 3시간만 확정
    expect(day.workMinutes).toBe(3 * 60);
    // 화면에서는 진행 중까지 더해 보여준다 (13:00~20:00 = 7시간 − 휴게 30분)
    expect(minutesIncludingOpen(day, rules, asOf)).toBe(3 * 60 + (7 * 60 - 30));
  });

  it("진행 중인 날에는 위반 판정을 하지 않는다", () => {
    // 11:40 시작이라 코어타임(11:00~)을 못 덮지만 아직 근무 중이다
    const [day] = computeWorkDaysFromSessions(
      [s("2026-07-24T11:40", null)],
      rules,
      asOf,
    );
    expect(day.flags).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
describe("코어타임 — 세션 합집합으로 판정한다", () => {
  it("나눠 일해도 코어타임을 다 덮으면 위반이 아니다", () => {
    const [day] = computeWorkDaysFromSessions(
      [
        s("2026-07-20T09:00", "2026-07-20T13:00"),
        s("2026-07-20T13:00", "2026-07-20T16:00"),
      ],
      rules,
      asOf,
    );
    expect(day.flags).not.toContain("core_time_violation");
  });

  it("코어타임 중간에 빠지면 위반이다", () => {
    // 11~13 일하고 빠졌다가 15시 이후 복귀 → 13~15 가 비어 있다
    const [day] = computeWorkDaysFromSessions(
      [
        s("2026-07-20T09:00", "2026-07-20T13:00"),
        s("2026-07-20T15:00", "2026-07-20T18:00"),
      ],
      rules,
      asOf,
    );
    expect(day.flags).toContain("core_time_violation");
  });

  it("오전만 일하면 위반이다", () => {
    const [day] = computeWorkDaysFromSessions(
      [s("2026-07-20T08:00", "2026-07-20T12:00")],
      rules,
      asOf,
    );
    expect(day.flags).toContain("core_time_violation");
  });
});

// ─────────────────────────────────────────────────────────────
describe("sessionsFromTags — 사원증 태그를 세션으로", () => {
  it("입장/퇴장 쌍이 있으면 그대로 세션이 된다", () => {
    const out = sessionsFromTags(
      [
        tag("2026-07-20T09:00", "in"),
        tag("2026-07-20T12:00", "out"),
        tag("2026-07-20T19:00", "in"),
        tag("2026-07-20T21:00", "out"),
      ],
      rules,
    );
    expect(out).toHaveLength(2);
    const [day] = computeWorkDaysFromSessions(out, rules, asOf);
    expect(day.workMinutes).toBe(5 * 60);
  });

  it("방향이 없으면 첫~마지막 한 세션 (중간 이탈을 알 수 없다)", () => {
    const out = sessionsFromTags(
      [
        tag("2026-07-20T09:00"),
        tag("2026-07-20T12:00"),
        tag("2026-07-20T13:00"),
        tag("2026-07-20T18:00"),
      ],
      rules,
    );
    expect(out).toHaveLength(1);
    expect(out[0].endedAt).not.toBeNull();
  });

  it("태그가 하나면 퇴근을 모르므로 진행 중으로 남긴다", () => {
    const out = sessionsFromTags([tag("2026-07-20T09:00")], rules);
    expect(out[0].endedAt).toBeNull();
  });

  it("입장만 있고 퇴장이 없으면 진행 중", () => {
    const out = sessionsFromTags([tag("2026-07-20T09:00", "in")], rules);
    expect(out).toHaveLength(1);
    expect(out[0].endedAt).toBeNull();
  });

  it("짝 없는 퇴장은 버린다", () => {
    const out = sessionsFromTags([tag("2026-07-20T18:00", "out")], rules);
    expect(out).toHaveLength(0);
  });

  it("연속 입장은 마지막 것을 쓴다 (재인증)", () => {
    const out = sessionsFromTags(
      [
        tag("2026-07-20T09:00", "in"),
        tag("2026-07-20T09:01", "in"),
        tag("2026-07-20T18:00", "out"),
      ],
      rules,
    );
    expect(out).toHaveLength(1);
    expect(
      DateTime.fromJSDate(out[0].startedAt, { zone }).toFormat("HH:mm"),
    ).toBe("09:01");
  });

  it("자정을 넘긴 세션은 시작한 날로 귀속된다", () => {
    const out = sessionsFromTags(
      [tag("2026-07-20T21:00", "in"), tag("2026-07-21T02:00", "out")],
      rules,
    );
    const [day] = computeWorkDaysFromSessions(out, rules, asOf);
    expect(day.workDate).toBe("2026-07-20");
    expect(day.workMinutes).toBe(5 * 60 - 30);
    expect(day.nightMinutes).toBe(4 * 60); // 22:00~02:00
  });
});

// ─────────────────────────────────────────────────────────────
describe("computeWorkDays — 앱 세션과 사원증 태그를 함께", () => {
  it("둘 다 있으면 합쳐서 계산한다", () => {
    const [day] = computeWorkDays(
      {
        tags: [tag("2026-07-20T09:00", "in"), tag("2026-07-20T12:00", "out")],
        sessions: [s("2026-07-20T19:00", "2026-07-20T21:00")],
      },
      rules,
      asOf,
    );
    expect(day.sessionCount).toBe(2);
    expect(day.workMinutes).toBe(5 * 60);
  });

  it("사원증 기록과 앱 기록이 겹치면 이중 계산하지 않는다", () => {
    const [day] = computeWorkDays(
      {
        tags: [tag("2026-07-20T09:00", "in"), tag("2026-07-20T18:00", "out")],
        sessions: [s("2026-07-20T09:05", "2026-07-20T17:55")],
      },
      rules,
      asOf,
    );
    expect(day.workMinutes).toBe(8 * 60);
  });
});
