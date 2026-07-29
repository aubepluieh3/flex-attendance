import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computePeriodSummary } from "./settle";
import type { SettlementRules } from "./settle";

/**
 * 개념: **개인 집계·적용기간 = 조직 정산기간 ∩ 근로관계 존속기간**
 *
 * 정산기간이 개인별로 짧아지는 것이 아니다. 정산기간은 서면합의로 정한 조직의
 * 것이고(§52①2호), 개인에게 달린 것은 그 기간 중 어디까지가 적용되는가다.
 *
 * 팀장이 이 개념을 정하면서 "전체적으로 개념이 맞아야 한다"를 조건으로 걸었다.
 * 문장으로 적어두면 새 계산·새 화면을 붙일 때 빠뜨리므로 여기서 막는다.
 *
 * 막는 것 두 가지 —
 *   1. 조직 정산기간을 그 사람의 분모로 쓰지 않는다 (계산 불변식)
 *   2. 교집합이 비면 0이 아니라 employed=false 다 (표현 불변식)
 *
 * 뒤집을 일이 생기면 이 파일을 지우는 게 그 결정이다.
 */

const rules: SettlementRules = {
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

/** 2026-03-01(일) ~ 03-31(화). 영업일 22일 */
const month = (employment?: {
  hiredAt: string | null;
  resignedAt: string | null;
}) => ({
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  days: [],
  timeOff: [],
  asOf: new Date("2026-04-01T00:00:00+09:00"),
  ...(employment ? { employment } : {}),
});

describe("불변식 1 — 법정 총량·한도의 분모는 개인 집계 대상기간이다", () => {
  /*
   * 조직 정산기간을 분모로 두면 근로관계가 존재하지 않았던 기간까지 0시간으로
   * 평균에 들어가서, 실제 근로기간의 평균 근로시간과 연장근로 한도가 인위적으로
   * 희석된다. 목표만 비례로 깎고 분모를 그대로 두는 절반짜리가 특히 나쁘다 —
   * 화면의 "남은 시간"은 맞아 보이는데 52시간 판정은 계속 느슨하다.
   *
   * 정산기간이 개인별로 짧아진다는 뜻이 아니다. 정산기간은 서면합의로 정한
   * 조직의 것이고, 평균을 그 사람의 근로관계 존속기간으로 계산하는 것이다.
   */
  const daysOf = (a: string, b: string) =>
    (Date.parse(b) - Date.parse(a)) / 86400000 + 1;

  it("대상기간이 짧아지면 법정 총량과 한도가 같이 줄어든다", () => {
    const whole = computePeriodSummary(month(), rules);
    const half = computePeriodSummary(
      month({ hiredAt: "2026-03-16", resignedAt: null }),
      rules,
    );

    expect(half.targetMinutes).toBeLessThan(whole.targetMinutes);
    expect(half.applicableStatutoryMinutes).toBeLessThan(
      whole.applicableStatutoryMinutes,
    );
    expect(half.applicableLimitMinutes).toBeLessThan(
      whole.applicableLimitMinutes,
    );
  });

  it("내보낸 총량이 대상기간 일수 ÷ 7 × 40h 와 정확히 맞는다", () => {
    for (const emp of [
      undefined,
      { hiredAt: "2026-03-16", resignedAt: null },
      { hiredAt: null, resignedAt: "2026-03-10" },
      { hiredAt: "2026-03-05", resignedAt: "2026-03-20" },
    ]) {
      const s = computePeriodSummary(month(emp), rules);
      const d = daysOf(s.applicableStart, s.applicableEnd);
      expect(s.applicableStatutoryMinutes).toBe(
        Math.round((d / 7) * rules.legalWeeklyMinutes),
      );
      expect(s.applicableLimitMinutes).toBe(
        Math.round((d / 7) * rules.maxAvgWeeklyMinutes),
      );
    }
  });

  it("퇴사자에도 같은 규칙이 적용된다 (입사자와 대칭)", () => {
    // 3/16 입사(뒤쪽 16일)와 3/16 퇴사(앞쪽 16일)는 대상기간 길이가 같다
    const hired = computePeriodSummary(
      month({ hiredAt: "2026-03-16", resignedAt: null }),
      rules,
    );
    const resigned = computePeriodSummary(
      month({ hiredAt: null, resignedAt: "2026-03-16" }),
      rules,
    );
    expect(daysOf(hired.applicableStart, hired.applicableEnd)).toBe(16);
    expect(daysOf(resigned.applicableStart, resigned.applicableEnd)).toBe(16);
    expect(resigned.applicableStatutoryMinutes).toBe(
      hired.applicableStatutoryMinutes,
    );
    expect(resigned.applicableLimitMinutes).toBe(hired.applicableLimitMinutes);
  });

  it("같은 근무를 해도 재직이 짧으면 주평균이 높게 나온다", () => {
    const days = ["2026-03-16", "2026-03-17", "2026-03-18"].map((workDate) => ({
      workDate,
      firstInAt: null,
      lastOutAt: null,
      stayMinutes: 12 * 60,
      autoBreakMinutes: 0,
      workMinutes: 12 * 60,
      nightMinutes: 0,
      isHoliday: false,
      flags: [],
      status: "computed" as const,
      tagCount: 2,
      sessionCount: 1,
      openSince: null,
    }));

    const whole = computePeriodSummary({ ...month(), days }, rules);
    const hired = computePeriodSummary(
      { ...month({ hiredAt: "2026-03-16", resignedAt: null }), days },
      rules,
    );
    expect(hired.avgWeeklyMinutes).toBeGreaterThan(whole.avgWeeklyMinutes);
  });
});

describe("불변식 2 — 교집합이 비면 0이 아니라 employed=false", () => {
  /*
   * 0으로 두면 "안 일했다"로 읽혀서 미달·진행률·팀 집계에 섞인다.
   * 입사도 안 한 달에 "176시간 미달" 판정을 받는 화면이 실제로 나왔다.
   */
  it("입사 전 정산기간", () => {
    const s = computePeriodSummary(
      month({ hiredAt: "2026-05-01", resignedAt: null }),
      rules,
    );
    expect(s.employed).toBe(false);
    expect(s.targetMinutes).toBe(0);
    expect(s.remainingMinutes).toBe(0);
    expect(s.businessDays).toBe(0);
  });

  it("퇴사 후 정산기간", () => {
    const s = computePeriodSummary(
      month({ hiredAt: null, resignedAt: "2026-01-31" }),
      rules,
    );
    expect(s.employed).toBe(false);
    expect(s.targetMinutes).toBe(0);
  });

  it("경계 — 입사일이 기간 마지막 날이면 재직이다", () => {
    const s = computePeriodSummary(
      month({ hiredAt: "2026-03-31", resignedAt: null }),
      rules,
    );
    expect(s.employed).toBe(true);
    expect(s.applicableStart).toBe("2026-03-31");
    // 3/31(화)은 영업일이므로 하루치
    expect(s.businessDays).toBe(1);
  });

  it("경계 — 퇴사일도 근무일로 센다 (포함)", () => {
    const s = computePeriodSummary(
      month({ hiredAt: null, resignedAt: "2026-03-02" }),
      rules,
    );
    expect(s.applicableEnd).toBe("2026-03-02");
    expect(s.businessDays).toBe(1); // 3/01은 일요일, 3/02(월)만
  });
});

describe("불변식 3 — employed 를 확인하지 않고 숫자를 그리는 화면이 없다", () => {
  /*
   * 계산은 위 테스트가 지키지만, 화면이 employed 를 무시하고 0 을 그리면
   * 개념이 화면에서 깨진다. 정산기간 요약을 쓰는 화면은 employed 를 읽어야 한다.
   */
  const SUMMARY_SCREENS = [
    "app/page.tsx",
    "app/records/page.tsx",
    "app/team/page.tsx",
    "app/team/[userId]/page.tsx",
  ];

  it("요약을 쓰는 화면은 employed 를 읽는다", () => {
    const bad: string[] = [];
    for (const rel of SUMMARY_SCREENS) {
      const src = readFileSync(join(process.cwd(), rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      // employed 플래그를 읽든 hiredAt 으로 날짜를 가르든, 재직기간을 아는
      // 화면이어야 한다. /records 는 날짜별로 폼을 잠그므로 후자를 쓴다.
      if (!/\bemploy(ed|ment)\b|\bhiredAt\b/.test(src)) bad.push(rel);
    }
    expect(
      bad,
      "재직 아닌 기간에 0 을 그리지 않도록 summary.employed 를 확인하세요",
    ).toEqual([]);
  });
});
