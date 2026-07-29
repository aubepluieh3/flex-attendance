import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  closeDateFor,
  computePeriodSummary,
  diffAgainstSnapshot,
  isClosable,
  snapshotOf,
} from "./settle";
import type { SettlementRules, TimeOffEntry } from "./settle";
import type { ComputedDay } from "./types";

/**
 * 2026-03-02(월) ~ 03-08(일) 이 기준 주.
 * 영업일 5일 → 소정근로 40시간.
 */
const base: SettlementRules = {
  timezone: "Asia/Seoul",
  weekendDays: [6, 7],
  holidays: [],
  targetCalcMethod: "business_days",
  standardMinutesPerDay: 8 * 60,
  fixedTargetMinutes: 40 * 60,
  legalWeeklyMinutes: 40 * 60,
  maxAvgWeeklyMinutes: 52 * 60,
  paceToleranceMinutes: 60,
};

const withRules = (o: Partial<SettlementRules>): SettlementRules => ({
  ...base,
  ...o,
});

/** 하루 집계 결과 stub. 여기서는 정산 로직만 본다. */
const d = (
  workDate: string,
  workMinutes: number,
  over: Partial<ComputedDay> = {},
): ComputedDay => ({
  workDate,
  firstInAt: null,
  lastOutAt: null,
  stayMinutes: workMinutes,
  breakMinutes: 0,
  workMinutes,
  nightMinutes: 0,
  isHoliday: false,
  flags: [],
  status: "computed",
  tagCount: 2,
  sessionCount: 1,
  openSince: null,
  ...over,
});

const kst = (iso: string) =>
  DateTime.fromISO(iso, { zone: "Asia/Seoul" }).toJSDate();

/** 기준 주 5영업일에 같은 시간씩 */
const weekdays = (minutes: number) =>
  ["03-02", "03-03", "03-04", "03-05", "03-06"].map((md) =>
    d(`2026-${md}`, minutes),
  );

const week = (o: {
  days?: ComputedDay[];
  timeOff?: TimeOffEntry[];
  asOf?: string;
}) => ({
  periodStart: "2026-03-02",
  periodEnd: "2026-03-08",
  days: o.days ?? [],
  timeOff: o.timeOff ?? [],
  asOf: kst(o.asOf ?? "2026-03-08T23:59"),
});

// ─────────────────────────────────────────────────────────────
describe("소정근로 산정 — 영업일 × 8h − 휴가", () => {
  it("평일 5일이면 40시간", () => {
    const s = computePeriodSummary(week({}), base);
    expect(s.businessDays).toBe(5);
    expect(s.targetMinutes).toBe(40 * 60);
  });

  it("공휴일이 끼면 그만큼 줄어든다", () => {
    const s = computePeriodSummary(
      week({}),
      withRules({ holidays: ["2026-03-04"] }),
    );
    expect(s.businessDays).toBe(4);
    expect(s.targetMinutes).toBe(32 * 60);
  });

  it("연차 1일은 8시간을 차감한다", () => {
    const s = computePeriodSummary(
      week({
        timeOff: [
          { date: "2026-03-04", kind: "full", deductMinutes: 8 * 60 },
        ],
      }),
      base,
    );
    expect(s.targetMinutes).toBe(32 * 60);
  });

  it("반차는 4시간만 차감한다", () => {
    const s = computePeriodSummary(
      week({
        timeOff: [
          { date: "2026-03-04", kind: "half_am", deductMinutes: 4 * 60 },
        ],
      }),
      base,
    );
    expect(s.targetMinutes).toBe(36 * 60);
  });

  it("무급휴가도 소정근로에서 빠진다", () => {
    const s = computePeriodSummary(
      week({
        timeOff: [
          { date: "2026-03-04", kind: "unpaid", deductMinutes: 8 * 60 },
        ],
      }),
      base,
    );
    expect(s.targetMinutes).toBe(32 * 60);
  });

  it("fixed 방식은 영업일 수와 무관하게 고정값을 쓴다", () => {
    const s = computePeriodSummary(
      week({}),
      withRules({
        targetCalcMethod: "fixed",
        fixedTargetMinutes: 35 * 60,
        holidays: ["2026-03-04"],
      }),
    );
    expect(s.businessDays).toBe(4);
    expect(s.targetMinutes).toBe(35 * 60);
  });

  it("휴가가 목표보다 많아도 음수가 되지 않는다", () => {
    const s = computePeriodSummary(
      week({
        timeOff: ["03-02", "03-03", "03-04", "03-05", "03-06", "03-07"].map(
          (md) => ({
            date: `2026-${md}`,
            kind: "full" as const,
            deductMinutes: 8 * 60,
          }),
        ),
      }),
      base,
    );
    expect(s.targetMinutes).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
describe("실근무 집계", () => {
  it("5일 × 8시간이면 목표를 정확히 채운다", () => {
    const s = computePeriodSummary(week({ days: weekdays(8 * 60) }), base);
    expect(s.workedMinutes).toBe(40 * 60);
    expect(s.remainingMinutes).toBe(0);
  });

  it("미완료 일자는 근무시간에 넣지 않고 확인 목록에 올린다", () => {
    const days = [
      ...weekdays(8 * 60).slice(0, 4),
      d("2026-03-06", 0, { status: "incomplete" }),
    ];
    const s = computePeriodSummary(week({ days }), base);

    expect(s.workedMinutes).toBe(32 * 60);
    expect(s.remainingMinutes).toBe(8 * 60);
    expect(s.incompleteDates).toEqual(["2026-03-06"]);
  });

  it("야간·휴일 근무시간을 따로 합산한다", () => {
    const days = [
      ...weekdays(8 * 60),
      d("2026-03-07", 5 * 60, { isHoliday: true, nightMinutes: 60 }),
    ];
    const s = computePeriodSummary(week({ days }), base);

    expect(s.workedMinutes).toBe(45 * 60);
    expect(s.holidayMinutes).toBe(5 * 60);
    expect(s.nightMinutes).toBe(60);
  });

  it("정산기간 밖의 날짜는 무시한다", () => {
    const days = [...weekdays(8 * 60), d("2026-03-09", 8 * 60)];
    const s = computePeriodSummary(week({ days }), base);
    expect(s.workedMinutes).toBe(40 * 60);
  });
});

// ─────────────────────────────────────────────────────────────
describe("페이스 — 누적 시간보다 이게 1급 지표다", () => {
  it("오늘은 경과에서 뺀다 — 수요일에 보면 월·화까지로 판정", () => {
    const days = ["03-02", "03-03", "03-04"].map((md) =>
      d(`2026-${md}`, 8 * 60),
    );
    const s = computePeriodSummary(
      week({ days, asOf: "2026-03-04T18:00" }),
      base,
    );

    expect(s.elapsedBusinessDays).toBe(2);
    expect(s.elapsedTargetMinutes).toBe(16 * 60);
    // 수요일 실적은 누적에는 들어가고 페이스 판정에서는 빠진다
    expect(s.workedMinutes).toBe(24 * 60);
    expect(s.pacedWorkedMinutes).toBe(16 * 60);
    expect(s.paceStatus).toBe("on_track");
    expect(s.projectedMinutes).toBe(40 * 60);
  });

  it("금요일 아침에 봐도 뒤처졌다고 하지 않는다", () => {
    // 월~목 8시간씩 채웠고 금요일은 아직 시작 전.
    // 금요일을 경과로 세면 8시간 부족으로 나오는 버그가 있었다.
    const days = ["03-02", "03-03", "03-04", "03-05"].map((md) =>
      d(`2026-${md}`, 8 * 60),
    );
    const s = computePeriodSummary(
      week({ days, asOf: "2026-03-06T09:00" }),
      base,
    );

    expect(s.elapsedTargetMinutes).toBe(32 * 60);
    expect(s.paceStatus).toBe("on_track");
    expect(s.projectedMinutes).toBe(40 * 60);
    // 남은 시간은 그대로 8시간
    expect(s.remainingMinutes).toBe(8 * 60);
  });

  it("남은 영업일은 오늘을 포함한다 — 주 정산에서 페이스보다 직관적이다", () => {
    const days = ["03-02", "03-03", "03-04", "03-05"].map((md) =>
      d(`2026-${md}`, 8 * 60),
    );

    // 금요일 오전: 금요일 하루 남음
    const friday = computePeriodSummary(
      week({ days, asOf: "2026-03-06T09:00" }),
      base,
    );
    expect(friday.remainingBusinessDays).toBe(1);
    expect(friday.remainingMinutes).toBe(8 * 60);

    // 토요일: 영업일이 다 지났다
    const saturday = computePeriodSummary(
      week({ days, asOf: "2026-03-07T09:00" }),
      base,
    );
    expect(saturday.remainingBusinessDays).toBe(0);

    // 첫날 아침: 5일 다 남았다
    const monday = computePeriodSummary(
      week({ days: [], asOf: "2026-03-02T09:00" }),
      base,
    );
    expect(monday.remainingBusinessDays).toBe(5);
  });

  it("첫날에 보면 경과가 0이다", () => {
    const s = computePeriodSummary(
      week({ days: [d("2026-03-02", 4 * 60)], asOf: "2026-03-02T13:00" }),
      base,
    );

    expect(s.elapsedBusinessDays).toBe(0);
    expect(s.paceStatus).toBe("on_track");
  });

  it("하루 6시간씩이면 behind, 월말 예상치도 낮게 나온다", () => {
    const days = ["03-02", "03-03", "03-04"].map((md) =>
      d(`2026-${md}`, 6 * 60),
    );
    const s = computePeriodSummary(
      week({ days, asOf: "2026-03-04T18:00" }),
      base,
    );

    expect(s.paceStatus).toBe("behind");
    // 18h / 24h 페이스 → 40h × 0.75 = 30h
    expect(s.projectedMinutes).toBe(30 * 60);
  });

  it("하루 10시간씩이면 ahead", () => {
    const days = ["03-02", "03-03", "03-04"].map((md) =>
      d(`2026-${md}`, 10 * 60),
    );
    const s = computePeriodSummary(
      week({ days, asOf: "2026-03-04T18:00" }),
      base,
    );

    expect(s.paceStatus).toBe("ahead");
    expect(s.projectedMinutes).toBe(50 * 60);
  });

  it("허용 오차(60분) 안이면 on_track", () => {
    const days = [
      d("2026-03-02", 8 * 60),
      d("2026-03-03", 8 * 60),
      d("2026-03-04", 7 * 60 + 15),
    ];
    const s = computePeriodSummary(
      week({ days, asOf: "2026-03-04T18:00" }),
      base,
    );
    expect(s.paceStatus).toBe("on_track");
  });

  it("휴가가 낀 주는 페이스가 왜곡되지 않는다", () => {
    // 화요일 연차. 수요일에 보면 경과는 월·화 2일이지만 연차 8h가 빠져 목표 8h.
    // 월요일 실적 8h와 정확히 맞는다.
    const days = [d("2026-03-02", 8 * 60), d("2026-03-04", 8 * 60)];
    const s = computePeriodSummary(
      week({
        days,
        timeOff: [
          { date: "2026-03-03", kind: "full", deductMinutes: 8 * 60 },
        ],
        asOf: "2026-03-04T18:00",
      }),
      base,
    );

    expect(s.elapsedTargetMinutes).toBe(8 * 60);
    expect(s.pacedWorkedMinutes).toBe(8 * 60);
    expect(s.paceStatus).toBe("on_track");
    expect(s.targetMinutes).toBe(32 * 60);
    expect(s.projectedMinutes).toBe(32 * 60);
  });

  it("기간 시작 전에 보면 경과 0, 예상치는 실적 그대로", () => {
    const s = computePeriodSummary(
      week({ days: [], asOf: "2026-02-25T09:00" }),
      base,
    );
    expect(s.elapsedBusinessDays).toBe(0);
    expect(s.elapsedTargetMinutes).toBe(0);
    expect(s.projectedMinutes).toBe(0);
  });

  it("기간이 끝난 뒤에 보면 전체가 경과한 것으로 본다", () => {
    const s = computePeriodSummary(
      week({ days: weekdays(8 * 60), asOf: "2026-03-20T09:00" }),
      base,
    );
    expect(s.elapsedBusinessDays).toBe(5);
    expect(s.projectedMinutes).toBe(40 * 60);
    expect(s.paceStatus).toBe("on_track");
  });
});

// ─────────────────────────────────────────────────────────────
describe("법정 한도 — 개별 주가 아니라 정산기간 평균으로 본다 (§52)", () => {
  it("주 정산에서 53시간은 평균 52시간 초과", () => {
    const days = [...weekdays(10 * 60), d("2026-03-07", 3 * 60)];
    const s = computePeriodSummary(week({ days }), base);

    expect(s.workedMinutes).toBe(53 * 60);
    expect(s.avgWeeklyMinutes).toBeCloseTo(53 * 60, 5);
    expect(s.exceedsAvgWeeklyLimit).toBe(true);
  });

  it("정확히 52시간은 초과가 아니다 (경계)", () => {
    const days = [...weekdays(10 * 60), d("2026-03-07", 2 * 60)];
    const s = computePeriodSummary(week({ days }), base);

    expect(s.workedMinutes).toBe(52 * 60);
    expect(s.exceedsAvgWeeklyLimit).toBe(false);
  });

  it("월 정산이면 특정 주가 60시간이어도 평균이 넘지 않으면 위법이 아니다", () => {
    // 이게 선택근로제의 핵심이다. 주 단위로 판단하면 이 케이스를 잘못 잡는다.
    const days = [
      // 1주차 60시간
      ...["03-02", "03-03", "03-04", "03-05", "03-06"].map((md) =>
        d(`2026-${md}`, 12 * 60),
      ),
      // 2·3주차 40시간씩
      ...["03-09", "03-10", "03-11", "03-12", "03-13"].map((md) =>
        d(`2026-${md}`, 8 * 60),
      ),
      ...["03-16", "03-17", "03-18", "03-19", "03-20"].map((md) =>
        d(`2026-${md}`, 8 * 60),
      ),
      // 4주차 24시간
      ...["03-23", "03-24", "03-25"].map((md) => d(`2026-${md}`, 8 * 60)),
    ];

    const s = computePeriodSummary(
      {
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        days,
        timeOff: [],
        asOf: kst("2026-03-31T23:59"),
      },
      base,
    );

    expect(s.workedMinutes).toBe(164 * 60);
    // 31일 / 7 = 4.43주 → 평균 약 37시간
    expect(s.avgWeeklyMinutes / 60).toBeCloseTo(37.03, 1);
    expect(s.exceedsAvgWeeklyLimit).toBe(false);
    expect(s.overtimeMinutes).toBe(0);
  });

  it("정산기간 법정총량을 넘은 만큼이 연장근로다", () => {
    // 주 정산 45시간 → 법정 40시간 초과 5시간
    const days = [...weekdays(8 * 60), d("2026-03-07", 5 * 60)];
    const s = computePeriodSummary(week({ days }), base);

    expect(s.overtimeMinutes).toBe(5 * 60);
  });

  it("월 정산 법정총량은 일수 비례로 계산한다", () => {
    // 31일 → 31/7 × 40h = 177.14h. 180시간 일하면 약 2.86h 연장
    const days = Array.from({ length: 30 }, (_, i) =>
      d(`2026-03-${String(i + 1).padStart(2, "0")}`, 6 * 60),
    );
    const s = computePeriodSummary(
      {
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        days,
        timeOff: [],
        asOf: kst("2026-03-31T23:59"),
      },
      base,
    );

    expect(s.workedMinutes).toBe(180 * 60);
    expect(s.overtimeMinutes).toBe(Math.round(180 * 60 - (31 / 7) * 40 * 60));
  });
});

// ─────────────────────────────────────────────────────────────
describe("확인 필요 항목", () => {
  it("플래그가 붙은 날을 날짜 순으로 모은다", () => {
    const days = [
      d("2026-03-04", 8 * 60, { flags: ["core_time_violation"] }),
      d("2026-03-02", 13 * 60, { flags: ["over_daily_limit"] }),
    ];
    const s = computePeriodSummary(week({ days }), base);

    expect(s.flaggedDates).toEqual([
      { date: "2026-03-02", flags: ["over_daily_limit"] },
      { date: "2026-03-04", flags: ["core_time_violation"] },
    ]);
  });

  it("휴가로 등록된 날에 근무 기록이 있으면 충돌로 잡는다", () => {
    const s = computePeriodSummary(
      week({
        days: weekdays(8 * 60),
        timeOff: [
          { date: "2026-03-04", kind: "full", deductMinutes: 8 * 60 },
        ],
      }),
      base,
    );

    expect(s.timeOffConflicts).toEqual(["2026-03-04"]);
  });

  it("6일 연속 근무를 잡는다 — 주휴 미부여 위험", () => {
    const days = [
      ...weekdays(8 * 60),
      d("2026-03-07", 4 * 60, { isHoliday: true }),
    ];
    const s = computePeriodSummary(week({ days }), base);

    expect(s.maxConsecutiveWorkDays).toBe(6);
  });

  it("하루 쉬면 연속 카운트가 끊긴다", () => {
    const days = [
      d("2026-03-02", 8 * 60),
      d("2026-03-03", 8 * 60),
      d("2026-03-05", 8 * 60),
      d("2026-03-06", 8 * 60),
    ];
    const s = computePeriodSummary(week({ days }), base);

    expect(s.maxConsecutiveWorkDays).toBe(2);
  });

  it("근무시간이 0인 날은 연속 근무로 세지 않는다", () => {
    const days = [
      d("2026-03-02", 8 * 60),
      d("2026-03-03", 0, { status: "incomplete" }),
      d("2026-03-04", 8 * 60),
    ];
    const s = computePeriodSummary(week({ days }), base);

    expect(s.maxConsecutiveWorkDays).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────
describe("마감 — 확정된 과거가 조용히 바뀌지 않게", () => {
  it("정산기간 종료 + 유예일이 마감 예정일이다", () => {
    expect(closeDateFor("2026-03-08", 3, "Asia/Seoul")).toBe("2026-03-11");
  });

  it("유예일 당일까지는 마감하지 않는다", () => {
    const zone = "Asia/Seoul";
    expect(isClosable("2026-03-08", 3, kst("2026-03-11T23:00"), zone)).toBe(
      false,
    );
    expect(isClosable("2026-03-08", 3, kst("2026-03-12T00:10"), zone)).toBe(
      true,
    );
  });

  it("유예일이 0이면 종료 다음 날 마감된다", () => {
    const zone = "Asia/Seoul";
    expect(isClosable("2026-03-08", 0, kst("2026-03-08T23:59"), zone)).toBe(
      false,
    );
    expect(isClosable("2026-03-08", 0, kst("2026-03-09T00:01"), zone)).toBe(
      true,
    );
  });

  it("변경이 없으면 차이가 없다", () => {
    const s = computePeriodSummary(week({ days: weekdays(8 * 60) }), base);
    const snap = snapshotOf(s);

    expect(diffAgainstSnapshot(snap, s).changed).toBe(false);
  });

  it("마감 후 태그가 늦게 들어오면 차이로 드러난다", () => {
    const before = computePeriodSummary(
      week({ days: weekdays(8 * 60) }),
      base,
    );
    const snap = snapshotOf(before);

    // 토요일 근무 기록이 뒤늦게 임포트됨
    const after = computePeriodSummary(
      week({
        days: [
          ...weekdays(8 * 60),
          d("2026-03-07", 4 * 60, { isHoliday: true, nightMinutes: 30 }),
        ],
      }),
      base,
    );

    const diff = diffAgainstSnapshot(snap, after);
    expect(diff.changed).toBe(true);
    expect(diff.deltas.workedMinutes).toBe(4 * 60);
    expect(diff.deltas.holidayMinutes).toBe(4 * 60);
    expect(diff.deltas.nightMinutes).toBe(30);
    expect(diff.deltas.overtimeMinutes).toBe(4 * 60);
    // 목표는 안 변한다
    expect(diff.deltas.targetMinutes).toBeUndefined();
  });

  it("마감 후 규칙이 바뀌면 목표 변화로 드러난다", () => {
    const before = computePeriodSummary(
      week({ days: weekdays(8 * 60) }),
      base,
    );
    const snap = snapshotOf(before);

    // 뒤늦게 공휴일이 등록됨 → 소정근로가 줄어든다
    const after = computePeriodSummary(
      week({ days: weekdays(8 * 60) }),
      withRules({ holidays: ["2026-03-04"] }),
    );

    const diff = diffAgainstSnapshot(snap, after);
    expect(diff.changed).toBe(true);
    expect(diff.deltas.targetMinutes).toBe(-8 * 60);
  });
});

// ─────────────────────────────────────────────────────────────
/**
 * 2026년 3월 정산 (3/1 일요일 ~ 3/31, 4.43주, 영업일 22일).
 *
 * 확정 초과(exceedsAvgWeeklyLimit)는 분모가 기간 전체 주수라 늦게 켜진다.
 * 매일 14시간을 일하면 3/24 무렵이고, 그때는 남은 영업일을 전부 쉬어도
 * 위법이다. 그 앞 구간을 예상 주평균과 하한 경고가 맡는다.
 */
const month = (o: {
  days?: ComputedDay[];
  timeOff?: TimeOffEntry[];
  asOf: string;
}) => ({
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  days: o.days ?? [],
  timeOff: o.timeOff ?? [],
  asOf: kst(o.asOf),
});

/** 3/2 부터 연속 영업일에 같은 시간씩 (주말은 건너뛴다) */
const businessDaysFrom = (count: number, minutes: number): ComputedDay[] => {
  const out: ComputedDay[] = [];
  let cursor = DateTime.fromISO("2026-03-02", { zone: "Asia/Seoul" });
  while (out.length < count) {
    if (cursor.weekday <= 5) out.push(d(cursor.toISODate()!, minutes));
    cursor = cursor.plus({ days: 1 });
  }
  return out;
};

describe("한도 초과를 기간이 끝나기 전에 알린다", () => {
  it("첫 주 70시간 — 확정 초과는 아니지만 예상 주평균이 한도를 넘는다", () => {
    const s = computePeriodSummary(
      month({ days: businessDaysFrom(5, 14 * 60), asOf: "2026-03-07T10:00" }),
      base,
    );

    expect(s.workedMinutes).toBe(70 * 60);
    // 분모가 기간 전체(4.43주)라 15시간대로 나온다 — 이 값만 보면 여유롭다
    expect(Math.round(s.avgWeeklyMinutes / 60)).toBe(16);
    expect(s.exceedsAvgWeeklyLimit).toBe(false);

    // 같은 실적을 기간 말로 투사하면 69시간대
    expect(Math.round(s.projectedAvgWeeklyMinutes / 60)).toBe(70);
    expect(s.projectedAvgWeeklyMinutes).toBeGreaterThan(base.maxAvgWeeklyMinutes);

    // 아직 하한에는 안 걸린다 — 남은 17영업일을 소정근로만 하면 206시간
    expect(s.remainingBusinessDays).toBe(17);
    expect(s.remainingScheduledMinutes).toBe(17 * 8 * 60);
    expect(s.willExceedAvgWeeklyLimit).toBe(false);
  });

  it("10영업일 뒤 140시간 — 소정근로만 더해도 넘으므로 경고", () => {
    const s = computePeriodSummary(
      month({ days: businessDaysFrom(10, 14 * 60), asOf: "2026-03-16T10:00" }),
      base,
    );

    expect(s.workedMinutes).toBe(140 * 60);
    // 확정 초과는 아직 아니다 (그건 3/24 무렵)
    expect(s.exceedsAvgWeeklyLimit).toBe(false);
    // 140h + 남은 12영업일 × 8h = 236h > 한도 230.3h
    expect(s.remainingBusinessDays).toBe(12);
    expect(s.willExceedAvgWeeklyLimit).toBe(true);
  });

  it("남은 날에 휴가가 있으면 그만큼 빼고 판정한다", () => {
    /*
     * 안 빼면 월말에 휴가를 낸 사람이 경고를 맞는다. 하루 차이로 꺼지는
     * 경계라서 휴가 처리가 빠졌으면 이 테스트가 잡는다.
     */
    const days = businessDaysFrom(10, 14 * 60);
    const s = computePeriodSummary(
      month({
        days,
        timeOff: [{ date: "2026-03-20", kind: "full", deductMinutes: 8 * 60 }],
        asOf: "2026-03-16T10:00",
      }),
      base,
    );

    expect(s.remainingScheduledMinutes).toBe(11 * 8 * 60);
    expect(s.willExceedAvgWeeklyLimit).toBe(false);
  });

  it("반차는 절반만 빠진다", () => {
    const s = computePeriodSummary(
      month({
        days: businessDaysFrom(10, 14 * 60),
        timeOff: [
          { date: "2026-03-20", kind: "half_pm", deductMinutes: 4 * 60 },
        ],
        asOf: "2026-03-16T10:00",
      }),
      base,
    );

    expect(s.remainingScheduledMinutes).toBe(12 * 8 * 60 - 4 * 60);
    // 4시간만 빠지면 여전히 넘는다
    expect(s.willExceedAvgWeeklyLimit).toBe(true);
  });

  it("기간이 끝나면 예상과 확정이 같은 말을 한다", () => {
    const finished = (minutes: number) =>
      computePeriodSummary(
        month({
          days: businessDaysFrom(22, minutes),
          asOf: "2026-04-01T10:00",
        }),
        base,
      );

    const under = finished(8 * 60);
    expect(under.remainingScheduledMinutes).toBe(0);
    expect(under.willExceedAvgWeeklyLimit).toBe(under.exceedsAvgWeeklyLimit);
    expect(under.exceedsAvgWeeklyLimit).toBe(false);

    const over = finished(11 * 60);
    expect(over.willExceedAvgWeeklyLimit).toBe(over.exceedsAvgWeeklyLimit);
    expect(over.exceedsAvgWeeklyLimit).toBe(true);
  });

  it("기간이 시작되기 전에는 페이스가 없다", () => {
    const s = computePeriodSummary(month({ asOf: "2026-02-25T10:00" }), base);
    expect(s.elapsedBusinessDays).toBe(0);
    expect(s.remainingBusinessDays).toBe(22);
    // 소정근로만 다 해도 176시간 — 한도 아래다
    expect(s.willExceedAvgWeeklyLimit).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
/*
 * 그 사람의 정산기간 = 조직 정산기간 ∩ 재직기간.
 *
 * 중도 입사자에게 기간 전체를 요구하면 소정근로가 틀리는 데서 끝나지 않는다.
 * 52시간 평균의 **분모**가 재직하지 않은 기간까지 포함해서 부풀고, 그러면
 * 법정 한도 판정이 무력해진다 — 실측으로 7/20 입사자가 하루 12시간씩 일해도
 * 주평균 27시간으로 나왔다. 분모가 목표보다 중요하다.
 */
describe("재직기간 교집합 — 중도 입사·퇴사", () => {
  it("입사일 이후 영업일만 소정근로로 센다", () => {
    const s = computePeriodSummary(
      { ...week({}), employment: { hiredAt: "2026-03-05", resignedAt: null } },
      base,
    );
    // 3/05(목) 3/06(금) 두 날만 재직
    expect(s.applicableStart).toBe("2026-03-05");
    expect(s.applicableEnd).toBe("2026-03-08");
    expect(s.businessDays).toBe(2);
    expect(s.targetMinutes).toBe(16 * 60);
    expect(s.partialEmployment).toBe(true);
  });

  it("입사 전 기록은 집계에 넣지 않는다", () => {
    const s = computePeriodSummary(
      {
        ...week({ days: [d("2026-03-02", 8 * 60), d("2026-03-05", 8 * 60)] }),
        employment: { hiredAt: "2026-03-05", resignedAt: null },
      },
      base,
    );
    expect(s.workedMinutes).toBe(8 * 60);
  });

  it("52시간 분모가 재직 구간이라 법정초과가 드러난다", () => {
    const days = [d("2026-03-05", 12 * 60), d("2026-03-06", 12 * 60)];

    // 기간 전체를 분모로 쓰면 (1주) 24시간이라 초과가 안 보인다
    const whole = computePeriodSummary(week({ days }), base);
    expect(whole.overtimeMinutes).toBe(0);

    // 재직 4일(0.571주)을 분모로 쓰면 법정 총량이 22시간대로 줄어든다
    const partial = computePeriodSummary(
      { ...week({ days }), employment: { hiredAt: "2026-03-05", resignedAt: null } },
      base,
    );
    expect(partial.overtimeMinutes).toBeGreaterThan(0);
    expect(partial.avgWeeklyMinutes).toBeGreaterThan(whole.avgWeeklyMinutes);
  });

  it("퇴사자는 52시간 판정이 뒤집힌다", () => {
    const days = [
      d("2026-03-02", 12 * 60),
      d("2026-03-03", 12 * 60),
      d("2026-03-04", 12 * 60),
    ];
    const whole = computePeriodSummary(week({ days }), base);
    expect(whole.exceedsAvgWeeklyLimit).toBe(false); // 36시간으로 보인다

    // 3/04 퇴사 → 3일(0.429주)이 분모. 주평균 84시간
    const resigned = computePeriodSummary(
      { ...week({ days }), employment: { hiredAt: null, resignedAt: "2026-03-04" } },
      base,
    );
    expect(resigned.applicableEnd).toBe("2026-03-04");
    expect(resigned.exceedsAvgWeeklyLimit).toBe(true);
  });

  it("교집합이 비면 employed=false — 0이 아니라 '재직 아님'이다", () => {
    const s = computePeriodSummary(
      {
        ...week({ days: weekdays(8 * 60) }),
        employment: { hiredAt: "2026-03-20", resignedAt: null },
      },
      base,
    );
    expect(s.employed).toBe(false);
    expect(s.businessDays).toBe(0);
    expect(s.targetMinutes).toBe(0);
    // 기간 안에 기록이 있어도 재직 구간 밖이면 집계하지 않는다
    expect(s.workedMinutes).toBe(0);
    expect(s.remainingMinutes).toBe(0);
  });

  it("재직이 기간을 덮으면 지금과 똑같다", () => {
    const days = weekdays(8 * 60);
    const plain = computePeriodSummary(week({ days }), base);
    const covered = computePeriodSummary(
      {
        ...week({ days }),
        employment: { hiredAt: "2026-03-01", resignedAt: "2026-03-31" },
      },
      base,
    );
    expect(covered.partialEmployment).toBe(false);
    expect(covered.targetMinutes).toBe(plain.targetMinutes);
    expect(covered.avgWeeklyMinutes).toBe(plain.avgWeeklyMinutes);
  });

  it("입사 전 날짜를 경과 영업일로 세지 않는다", () => {
    // 3/06 아침 기준. 입사가 없으면 3/02~3/05 4일이 경과다
    const plain = computePeriodSummary(week({ asOf: "2026-03-06T09:00" }), base);
    expect(plain.elapsedBusinessDays).toBe(4);

    const hired = computePeriodSummary(
      {
        ...week({ asOf: "2026-03-06T09:00" }),
        employment: { hiredAt: "2026-03-05", resignedAt: null },
      },
      base,
    );
    expect(hired.elapsedBusinessDays).toBe(1);
    expect(hired.elapsedTargetMinutes).toBe(8 * 60);
  });

  it("fixed 방식은 소정근로일 수로 비례한다 (역일 아님)", () => {
    const s = computePeriodSummary(
      { ...week({}), employment: { hiredAt: "2026-03-05", resignedAt: null } },
      withRules({ targetCalcMethod: "fixed", fixedTargetMinutes: 40 * 60 }),
    );
    // 영업일 2/5 → 40시간의 2/5 = 16시간. 역일(4/7)이면 22시간대가 된다
    expect(s.targetMinutes).toBe(16 * 60);
  });
});
