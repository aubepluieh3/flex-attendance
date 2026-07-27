import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { applyAdjustment, breakMinutesFor, nightMinutesFor } from "./compute";
import { computeWorkDays as computeFromSessions } from "./sessions";
import type { AttendanceRules, ComputedDay, TagInput } from "./types";

/**
 * 기준 규칙: 선택적 근로시간제를 운영하는 회사의 전형적 설정.
 * 코어타임 10~15시, 선택시간대 07~22시, 정산은 주 40시간.
 *
 * 2026-03-02(월) ~ 03-06(금) 평일, 03-07(토) 03-08(일).
 */
const base: AttendanceRules = {
  timezone: "Asia/Seoul",
  dayBoundaryHour: 5,
  breakRules: [
    { overHours: 4, deductMinutes: 30 },
    { overHours: 8, deductMinutes: 60 },
  ],
  // 4시간. 점심(12~13시)이 포함되므로 실질 협업 시간은 3시간이다.
  coreTime: { start: "11:00", end: "15:00" },
  flexBand: { start: "07:00", end: "22:00" },
  nightWindow: { start: "22:00", end: "06:00" },
  dailyLimitMinutes: 12 * 60,
  weekendDays: [6, 7],
  holidays: [],
};

const withRules = (o: Partial<AttendanceRules>): AttendanceRules => ({
  ...base,
  ...o,
});

/** KST 벽시계 시각으로 태그를 만든다. 저장은 UTC지만 규칙은 KST 기준이다. */
const kst = (iso: string) =>
  DateTime.fromISO(iso, { zone: "Asia/Seoul" }).toJSDate();
const tag = (iso: string) => ({ occurredAt: kst(iso) });

/**
 * 이 파일의 태그는 in/out 방향이 없다 — 사원증 단말이 방향을 안 주는 경우다.
 * 그 경로에서는 날짜별 첫~마지막이 한 세션이 되고, 여기서 검증하는 규칙
 * (날짜 귀속·휴게·야간·코어타임·상한)은 세션 개수와 무관하게 같아야 한다.
 *
 * asOf 를 테스트 날짜보다 뒤로 고정한다. "오늘"이면 열린 세션이 open 으로
 * 남아서 위반 판정을 미루기 때문에 결과가 실행일에 따라 달라진다.
 */
const AS_OF = kst("2026-04-01T09:00");
const computeWorkDays = (
  tags: TagInput[],
  rules: AttendanceRules,
): ComputedDay[] => computeFromSessions({ tags, sessions: [] }, rules, AS_OF);

/** 하루 출퇴근 한 건 */
const day = (date: string, inHm: string, outHm: string) =>
  computeWorkDays([tag(`${date}T${inHm}`), tag(`${date}T${outHm}`)], base)[0];

// ─────────────────────────────────────────────────────────────
describe("날짜 귀속 — 정산 단위가 흔들리지 않게", () => {
  it("자정을 넘긴 야근은 출근한 날로 귀속된다", () => {
    const days = computeWorkDays(
      [tag("2026-03-02T09:00"), tag("2026-03-03T01:00")],
      base,
    );

    expect(days).toHaveLength(1);
    expect(days[0].workDate).toBe("2026-03-02");
    expect(days[0].stayMinutes).toBe(16 * 60);
  });

  it("기준시각(05:00) 직전은 전날, 직후는 당일", () => {
    const before = computeWorkDays(
      [tag("2026-03-02T04:59"), tag("2026-03-02T04:59")],
      base,
    );
    const after = computeWorkDays(
      [tag("2026-03-02T05:00"), tag("2026-03-02T05:00")],
      base,
    );

    expect(before[0].workDate).toBe("2026-03-01");
    expect(after[0].workDate).toBe("2026-03-02");
  });

  it("UTC 날짜가 아니라 KST 날짜로 귀속한다", () => {
    // 06:00 KST 출근 = 21:00Z 전날. UTC로 묶으면 3/1로 잘못 잡힌다.
    const days = computeWorkDays(
      [tag("2026-03-02T06:00"), tag("2026-03-02T15:00")],
      base,
    );

    expect(days[0].firstInAt?.toISOString()).toBe("2026-03-01T21:00:00.000Z");
    expect(days[0].workDate).toBe("2026-03-02");
  });

  it("여러 날을 날짜 순으로 반환한다", () => {
    const days = computeWorkDays(
      [
        tag("2026-03-04T10:00"),
        tag("2026-03-04T19:00"),
        tag("2026-03-02T09:00"),
        tag("2026-03-02T18:00"),
      ],
      base,
    );

    expect(days.map((d) => d.workDate)).toEqual(["2026-03-02", "2026-03-04"]);
  });
});

// ─────────────────────────────────────────────────────────────
describe("방향 없는 태그 — 날짜별 첫~마지막을 한 구간으로 본다", () => {
  it("중간 이탈(점심·흡연·층간 이동)은 무시한다", () => {
    const days = computeWorkDays(
      [
        tag("2026-03-02T09:00"),
        tag("2026-03-02T12:05"),
        tag("2026-03-02T13:02"),
        tag("2026-03-02T15:30"),
        tag("2026-03-02T18:00"),
      ],
      base,
    );

    expect(days[0].tagCount).toBe(5);
    expect(days[0].workMinutes).toBe(8 * 60);
  });

  it("태그가 10번 찍혀도 결과는 첫·마지막 기준", () => {
    const times = [
      "08:30", "10:00", "11:15", "12:00", "13:00",
      "14:20", "15:00", "16:40", "17:30", "19:00",
    ];
    const days = computeWorkDays(
      times.map((t) => tag(`2026-03-02T${t}`)),
      base,
    );

    expect(days[0].tagCount).toBe(10);
    expect(days[0].stayMinutes).toBe(10 * 60 + 30);
  });

  it("태그 순서가 뒤섞여 들어와도 결과가 같다", () => {
    const days = computeWorkDays(
      [
        tag("2026-03-02T18:00"),
        tag("2026-03-02T09:00"),
        tag("2026-03-02T13:00"),
      ],
      base,
    );

    expect(days[0].stayMinutes).toBe(9 * 60);
  });

  it("태그가 1개면 미완료로 남기고 집계에서 제외한다", () => {
    const days = computeWorkDays([tag("2026-03-02T09:00")], base);

    expect(days[0].status).toBe("incomplete");
    expect(days[0].lastOutAt).toBeNull();
    // 8시간 같은 값을 임의로 채우지 않는다
    expect(days[0].workMinutes).toBe(0);
  });

  it("지문 중복 인식으로 체류가 0분이면 미완료 + zero_stay", () => {
    const days = computeWorkDays(
      [tag("2026-03-02T09:00"), tag("2026-03-02T09:00")],
      base,
    );

    expect(days[0].status).toBe("incomplete");
    expect(days[0].tagCount).toBe(2);
    expect(days[0].flags).toContain("zero_stay");
    expect(days[0].workMinutes).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
describe("휴게 차감 (§54) — 체류시간 ≠ 근무시간", () => {
  const cases: Array<[string, number, number]> = [
    ["3시간59분 — 차감 없음", 239, 0],
    ["정확히 4시간 — 30분", 240, 30],
    ["7시간59분 — 30분", 479, 30],
    ["정확히 8시간 — 60분", 480, 60],
    ["12시간 — 60분 (가장 큰 조건 하나만)", 720, 60],
  ];

  for (const [name, stay, expected] of cases) {
    it(name, () => {
      expect(breakMinutesFor(stay, base.breakRules)).toBe(expected);
    });
  }

  it("9-18시가 8시간으로 잡힌다 — 틀리면 전 직원이 매일 1시간씩 부풀려진다", () => {
    expect(day("2026-03-02", "09:00", "18:00").workMinutes).toBe(8 * 60);
  });

  it("반차 수준의 짧은 근무는 차감이 없다", () => {
    // 09:00~12:30 = 3시간 30분
    expect(day("2026-03-02", "09:00", "12:30").workMinutes).toBe(210);
  });
});

// ─────────────────────────────────────────────────────────────
describe("야간근로 (§56) — 가산수당 대상이라 분리해서 기록한다", () => {
  it("주간만 근무하면 0분", () => {
    expect(day("2026-03-02", "09:00", "18:00").nightMinutes).toBe(0);
  });

  it("22:00 정각 퇴근은 야간 0분 (경계)", () => {
    expect(day("2026-03-02", "13:00", "22:00").nightMinutes).toBe(0);
  });

  it("23:00까지 일하면 60분", () => {
    expect(day("2026-03-02", "14:00", "23:00").nightMinutes).toBe(60);
  });

  it("자정 넘겨 01:00 퇴근하면 180분 (22:00~01:00)", () => {
    const days = computeWorkDays(
      [tag("2026-03-02T09:00"), tag("2026-03-03T01:00")],
      base,
    );
    expect(days[0].nightMinutes).toBe(180);
  });

  it("저녁 20시 출근 새벽 4시 퇴근이면 360분 (22:00~04:00)", () => {
    const days = computeWorkDays(
      [tag("2026-03-02T20:00"), tag("2026-03-03T04:00")],
      base,
    );
    expect(days[0].workDate).toBe("2026-03-02");
    expect(days[0].nightMinutes).toBe(6 * 60);
  });

  it("이른 새벽 근무도 야간으로 잡는다 (05:00~06:00)", () => {
    // 05:00 출근은 당일 귀속. 06:00까지는 야간대에 포함된다.
    expect(day("2026-03-02", "05:00", "09:00").nightMinutes).toBe(60);
  });

  it("여러 밤에 걸친 구간도 각 밤을 더한다", () => {
    // 함수 자체의 안전성 확인 — 하루 귀속 규칙상 실제로는 발생하지 않는다
    const minutes = nightMinutesFor(
      kst("2026-03-02T12:00"),
      kst("2026-03-04T12:00"),
      base,
    );
    expect(minutes).toBe(2 * 8 * 60);
  });
});

// ─────────────────────────────────────────────────────────────
describe("의무근로시간대 (코어타임 10~15시) — §52 서면합의 항목", () => {
  it("코어타임을 다 포함하면 위반이 아니다", () => {
    expect(day("2026-03-02", "09:00", "18:00").flags).not.toContain(
      "core_time_violation",
    );
  });

  it("정확히 11:00~15:00만 근무해도 위반이 아니다 (경계 포함)", () => {
    expect(day("2026-03-02", "11:00", "15:00").flags).not.toContain(
      "core_time_violation",
    );
  });

  it("11시 30분 출근은 위반 — 총 시간을 채워도 규정 위반이다", () => {
    expect(day("2026-03-02", "11:30", "18:00").flags).toContain(
      "core_time_violation",
    );
  });

  it("14시 퇴근은 위반 — 코어타임 종료 전에 나갔다", () => {
    expect(day("2026-03-02", "09:00", "14:00").flags).toContain(
      "core_time_violation",
    );
  });

  it("새벽에만 일하면 위반 — 총량만 보는 설계의 구멍을 막는다", () => {
    const days = computeWorkDays(
      [tag("2026-03-02T05:00"), tag("2026-03-02T09:30")],
      base,
    );
    expect(days[0].flags).toContain("core_time_violation");
  });

  it("코어타임이 없는 회사(null)는 검사하지 않는다", () => {
    const days = computeWorkDays(
      [tag("2026-03-02T11:00"), tag("2026-03-02T18:00")],
      withRules({ coreTime: null }),
    );
    expect(days[0].flags).not.toContain("core_time_violation");
  });

  it("휴일에는 코어타임을 적용하지 않는다", () => {
    // 2026-03-07은 토요일
    const days = computeWorkDays(
      [tag("2026-03-07T11:00"), tag("2026-03-07T18:00")],
      base,
    );
    expect(days[0].flags).not.toContain("core_time_violation");
  });
});

// ─────────────────────────────────────────────────────────────
describe("선택적 근로시간대 (07~22시) — 밖의 근무는 별도 승인 대상", () => {
  it("범위 안이면 플래그 없음", () => {
    expect(day("2026-03-02", "08:00", "20:00").flags).toEqual([]);
  });

  it("정확히 07:00~22:00은 범위 안 (경계 포함)", () => {
    const d = day("2026-03-02", "07:00", "22:00");
    expect(d.flags).not.toContain("outside_flex_band");
    // 다만 선택시간대를 꽉 채우면 14시간 근무가 되어 1일 상한을 넘는다.
    // 두 규칙은 독립이고, 회사가 서로 모순되지 않게 설정해야 한다.
    expect(d.workMinutes).toBe(14 * 60);
    expect(d.flags).toContain("over_daily_limit");
  });

  it("06:30 출근은 범위 밖", () => {
    expect(day("2026-03-02", "06:30", "16:00").flags).toContain(
      "outside_flex_band",
    );
  });

  it("23:00 퇴근은 범위 밖", () => {
    expect(day("2026-03-02", "09:00", "23:00").flags).toContain(
      "outside_flex_band",
    );
  });
});

// ─────────────────────────────────────────────────────────────
describe("1일 근무 상한 (12시간) — 건강권 관리", () => {
  it("실근무가 정확히 12시간이면 초과가 아니다", () => {
    // 09:00~22:00 = 13시간 체류 - 휴게 1시간 = 12시간
    const d = day("2026-03-02", "09:00", "22:00");
    expect(d.workMinutes).toBe(12 * 60);
    expect(d.flags).not.toContain("over_daily_limit");
  });

  it("13시간 근무는 초과", () => {
    const days = computeWorkDays(
      [tag("2026-03-02T08:00"), tag("2026-03-02T21:00")],
      withRules({ flexBand: null }),
    );
    expect(days[0].workMinutes).toBe(12 * 60);
    expect(days[0].flags).not.toContain("over_daily_limit");

    const longer = computeWorkDays(
      [tag("2026-03-02T08:00"), tag("2026-03-02T22:30")],
      withRules({ flexBand: null }),
    );
    expect(longer[0].workMinutes).toBe(13 * 60 + 30);
    expect(longer[0].flags).toContain("over_daily_limit");
  });

  it("상한이 없으면(null) 검사하지 않는다", () => {
    const days = computeWorkDays(
      [tag("2026-03-02T08:00"), tag("2026-03-02T23:00")],
      withRules({ dailyLimitMinutes: null, flexBand: null }),
    );
    expect(days[0].flags).not.toContain("over_daily_limit");
  });
});

// ─────────────────────────────────────────────────────────────
describe("휴일 근무 — 가산 대상이라 표시한다", () => {
  it("토요일 근무는 휴일로 잡힌다", () => {
    const d = day("2026-03-07", "10:00", "16:00");
    expect(d.isHoliday).toBe(true);
    expect(d.flags).toContain("holiday_work");
  });

  it("공휴일 목록에 있는 평일도 휴일이다", () => {
    // 2026-03-01(삼일절)이 일요일이라 03-02가 대체공휴일인 경우
    const days = computeWorkDays(
      [tag("2026-03-02T10:00"), tag("2026-03-02T16:00")],
      withRules({ holidays: ["2026-03-02"] }),
    );
    expect(days[0].isHoliday).toBe(true);
    expect(days[0].flags).toContain("holiday_work");
  });

  it("평일은 휴일이 아니다", () => {
    expect(day("2026-03-04", "09:00", "18:00").isHoliday).toBe(false);
  });

  it("휴일 근무도 근무시간에는 그대로 들어간다", () => {
    // 가산수당 판단은 앱이 하지 않는다. 시간은 정확히 남긴다.
    expect(day("2026-03-07", "10:00", "16:00").workMinutes).toBe(5 * 60 + 30);
  });
});

// ─────────────────────────────────────────────────────────────
describe("알려진 한계 — 기준시각보다 이른 출근", () => {
  it("04:00 출근하면 하루가 두 개의 미완료로 쪼개진다", () => {
    // 04:00은 전날로, 13:00은 당일로 귀속되어 각각 태그 1개가 된다.
    // 소리 없이 틀린 숫자를 내는 대신 양쪽 다 incomplete로 떨어져
    // "확인 필요" 목록에 올라간다 — 의도한 실패 방식이다.
    const days = computeWorkDays(
      [tag("2026-03-03T04:00"), tag("2026-03-03T13:00")],
      base,
    );

    expect(days).toHaveLength(2);
    expect(days.every((d) => d.status === "incomplete")).toBe(true);
    expect(days.every((d) => d.workMinutes === 0)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
describe("예외 보정", () => {
  it("외근: 태그가 없는 날에 실근무 시간을 더한다", () => {
    const d = applyAdjustment(
      null,
      { workDate: "2026-03-05", kind: "field_work", addedMinutes: 8 * 60 },
      base,
    );

    expect(d.workMinutes).toBe(8 * 60);
    expect(d.status).toBe("adjusted");
    expect(d.tagCount).toBe(0);
    // 외근은 사용자가 실근무 시간을 넣는다 — 휴게를 또 빼지 않는다
    expect(d.breakMinutes).toBe(0);
    // 시각을 모르므로 코어타임을 판정하지 않는다
    expect(d.flags).not.toContain("core_time_violation");
  });

  it("태그 누락: 시각을 덮어쓰면 체류·휴게·야간을 다시 계산한다", () => {
    const [incomplete] = computeWorkDays([tag("2026-03-02T09:00")], base);
    expect(incomplete.status).toBe("incomplete");

    const fixed = applyAdjustment(
      incomplete,
      {
        workDate: "2026-03-02",
        kind: "missing_tag",
        overrideLastOutAt: kst("2026-03-02T23:00"),
      },
      base,
    );

    expect(fixed.stayMinutes).toBe(14 * 60);
    expect(fixed.breakMinutes).toBe(60);
    expect(fixed.workMinutes).toBe(13 * 60);
    expect(fixed.nightMinutes).toBe(60);
    expect(fixed.status).toBe("adjusted");
  });

  it("보정으로 시각이 확정되면 위반 판정도 다시 돈다", () => {
    const [incomplete] = computeWorkDays([tag("2026-03-02T11:30")], base);

    const fixed = applyAdjustment(
      incomplete,
      {
        workDate: "2026-03-02",
        kind: "missing_tag",
        overrideLastOutAt: kst("2026-03-02T18:00"),
      },
      base,
    );

    // 11시 30분 출근이었으므로 코어타임 위반이 보정 후에 드러난다
    expect(fixed.flags).toContain("core_time_violation");
  });

  it("취소는 원본 계산 결과로 되돌린다", () => {
    const [original] = computeWorkDays(
      [tag("2026-03-02T09:00"), tag("2026-03-02T18:00")],
      base,
    );

    const reverted = applyAdjustment(
      original,
      { workDate: "2026-03-02", kind: "revert" },
      base,
    );

    expect(reverted).toEqual(original);
  });

  it("보정 결과가 음수가 되지 않는다", () => {
    const d = applyAdjustment(
      null,
      { workDate: "2026-03-05", kind: "correction", addedMinutes: -60 },
      base,
    );
    expect(d.workMinutes).toBe(0);
  });
});
