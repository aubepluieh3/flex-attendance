import { describe, expect, it } from "vitest";
import { resolvePeriod } from "./period";

const zone = "Asia/Seoul";

describe("resolvePeriod — 주 정산", () => {
  const week = (date: string, weekStartDay = 1) =>
    resolvePeriod(date, { kind: "week", weekStartDay, timezone: zone });

  it("주 중간 날짜도 그 주의 월~일로 잡힌다", () => {
    // 2026-07-24는 금요일
    expect(week("2026-07-24")).toEqual({
      start: "2026-07-20",
      end: "2026-07-26",
    });
  });

  it("시작일(월요일) 자신도 같은 기간", () => {
    expect(week("2026-07-20")).toEqual({
      start: "2026-07-20",
      end: "2026-07-26",
    });
  });

  it("마지막 날(일요일)도 같은 기간 — 다음 주로 넘어가지 않는다", () => {
    expect(week("2026-07-26")).toEqual({
      start: "2026-07-20",
      end: "2026-07-26",
    });
  });

  it("주 시작일을 일요일로 두면 경계가 옮겨간다", () => {
    expect(week("2026-07-26", 7)).toEqual({
      start: "2026-07-26",
      end: "2026-08-01",
    });
    expect(week("2026-07-25", 7)).toEqual({
      start: "2026-07-19",
      end: "2026-07-25",
    });
  });

  it("월 경계를 넘는 주도 이어진다", () => {
    // 2026-08-01은 토요일 → 그 주는 7/27(월) ~ 8/2(일)
    expect(week("2026-08-01")).toEqual({
      start: "2026-07-27",
      end: "2026-08-02",
    });
  });
});

describe("resolvePeriod — 월 정산", () => {
  const month = (date: string) =>
    resolvePeriod(date, { kind: "month", weekStartDay: 1, timezone: zone });

  it("해당 월의 1일~말일", () => {
    expect(month("2026-07-24")).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
    });
  });

  it("2월은 말일이 짧다 (2026년은 평년)", () => {
    expect(month("2026-02-15")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });

  it("말일 자신도 같은 월", () => {
    expect(month("2026-07-31")).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
    });
  });
});
