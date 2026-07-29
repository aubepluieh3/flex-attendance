import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { deviationMinutes, estimateCheckout } from "./estimate";
import type { AttendanceRules, ComputedDay } from "./types";

const zone = "Asia/Seoul";
const rules: AttendanceRules = {
  timezone: zone,
  dayBoundaryHour: 5,
  autoBreakRules: [
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
const STANDARD = 8 * 60;

const kst = (iso: string) => DateTime.fromISO(iso, { zone }).toJSDate();
const hhmm = (d: Date) => DateTime.fromJSDate(d, { zone }).toFormat("HH:mm");

const day = (stayMinutes: number): ComputedDay => ({
  workDate: "2026-07-20",
  firstInAt: null,
  lastOutAt: null,
  stayMinutes,
  autoBreakMinutes: 0,
  workMinutes: stayMinutes,
  nightMinutes: 0,
  isHoliday: false,
  flags: [],
  status: "computed",
  tagCount: 2,
  sessionCount: 1,
  openSince: null,
});

describe("estimateCheckout — 미완료를 0분으로 두지 않는다", () => {
  it("이력이 3일 이상이면 평소 체류시간의 중앙값을 쓴다", () => {
    const history = [day(580), day(600), day(620), day(600), day(590)];
    const e = estimateCheckout(kst("2026-07-23T09:00"), history, rules, STANDARD);
    expect(e.source).toBe("history");
    expect(e.sampleDays).toBe(5);
    // 중앙값 600분 = 10시간 → 09:00 + 10h
    expect(hhmm(e.lastOutAt)).toBe("19:00");
    expect(e.workMinutes).toBe(600 - 60);
  });

  it("이력이 부족하면 소정근로 기준으로 역산한다", () => {
    const e = estimateCheckout(kst("2026-07-23T09:00"), [day(600)], rules, STANDARD);
    expect(e.source).toBe("standard");
    // 실근무 8시간이 되려면 휴게 1시간을 더해 체류 9시간
    expect(hhmm(e.lastOutAt)).toBe("18:00");
    expect(e.workMinutes).toBe(STANDARD);
  });

  it("이력이 아예 없어도 추정한다", () => {
    const e = estimateCheckout(kst("2026-07-23T10:30"), [], rules, STANDARD);
    expect(hhmm(e.lastOutAt)).toBe("19:30");
    expect(e.workMinutes).toBe(STANDARD);
  });

  it("미완료인 과거 날은 표본에서 뺀다", () => {
    const incomplete = { ...day(0), status: "incomplete" as const };
    const e = estimateCheckout(
      kst("2026-07-23T09:00"),
      [incomplete, incomplete, day(540), day(540), day(540)],
      rules,
      STANDARD,
    );
    expect(e.sampleDays).toBe(3);
    expect(hhmm(e.lastOutAt)).toBe("18:00");
  });

  it("추정치가 1일 상한을 넘지 않는다 — 추정이 위반을 만들면 안 된다", () => {
    // 평소 15시간씩 머무는 사람
    const history = [day(900), day(900), day(900)];
    const e = estimateCheckout(kst("2026-07-23T08:00"), history, rules, STANDARD);
    expect(e.workMinutes).toBeLessThanOrEqual(rules.dailyLimitMinutes!);
    // 실근무 12시간 = 체류 13시간 → 08:00 + 13h
    expect(hhmm(e.lastOutAt)).toBe("21:00");
  });

  it("상한이 없으면 이력을 그대로 쓴다", () => {
    const history = [day(900), day(900), day(900)];
    const e = estimateCheckout(
      kst("2026-07-23T08:00"),
      history,
      { ...rules, dailyLimitMinutes: null },
      STANDARD,
    );
    expect(hhmm(e.lastOutAt)).toBe("23:00");
  });

  it("최근 10일만 본다", () => {
    const old = Array.from({ length: 20 }, () => day(300));
    const recent = Array.from({ length: 10 }, () => day(600));
    const e = estimateCheckout(
      kst("2026-07-23T09:00"),
      [...old, ...recent],
      rules,
      STANDARD,
    );
    expect(e.sampleDays).toBe(10);
    expect(hhmm(e.lastOutAt)).toBe("19:00");
  });
});

describe("deviationMinutes — 횟수가 아니라 벗어난 정도로 본다", () => {
  it("추정과 같게 보정하면 0", () => {
    expect(
      deviationMinutes({
        finalWorkMinutes: 480,
        baselineWorkMinutes: 480,
        standardMinutesPerDay: STANDARD,
      }),
    ).toBe(0);
  });

  it("평범한 8시간 외근은 0 — 태그가 없어도 의심 대상이 아니다", () => {
    expect(
      deviationMinutes({
        finalWorkMinutes: 480,
        baselineWorkMinutes: null,
        standardMinutesPerDay: STANDARD,
      }),
    ).toBe(0);
  });

  it("12시간 외근은 4시간 벗어난 것으로 센다", () => {
    expect(
      deviationMinutes({
        finalWorkMinutes: 720,
        baselineWorkMinutes: null,
        standardMinutesPerDay: STANDARD,
      }),
    ).toBe(240);
  });

  it("줄이는 방향도 같은 크기로 센다", () => {
    expect(
      deviationMinutes({
        finalWorkMinutes: 300,
        baselineWorkMinutes: 480,
        standardMinutesPerDay: STANDARD,
      }),
    ).toBe(180);
  });
});
