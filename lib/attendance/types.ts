/**
 * 근태 도메인 타입. DB를 모른다 — 규칙이 바뀌면 원본 태그에서 전부 재계산해야 하고,
 * 그 계산이 순수 함수여야 테스트와 재계산이 같은 코드를 쓴다.
 *
 * 기준 제도: 선택적 근로시간제 (근로기준법 §52).
 * 정산기간 총 근로시간만 맞추면 되고 1일 8시간 / 1주 40시간에 묶이지 않는다.
 * 대신 서면합의로 의무근로시간대·선택적 근로시간대를 정하므로 그 위반을 잡아야 한다.
 */

/** 체류가 overHours 이상이면 deductMinutes 차감. 조건이 여러 개 맞으면 가장 큰 것 하나만. */
export type BreakRule = { overHours: number; deductMinutes: number };

/** "HH:MM" 24시간 표기 */
export type HourMinute = string;

export type TimeBand = { start: HourMinute; end: HourMinute };

export type AttendanceRules = {
  /** 표시·귀속 기준 타임존. 저장은 항상 UTC. */
  timezone: string;
  /** 이 시각 이전의 태그는 전날로 귀속한다 (야근이 다음 날로 넘어가지 않게) */
  dayBoundaryHour: number;
  breakRules: BreakRule[];

  /**
   * 의무근로시간대. 이 구간에 자리를 비우면 규정 위반이다.
   * §52 서면합의 항목. 없는 회사도 있으므로 null 허용.
   */
  coreTime: TimeBand | null;
  /** 선택적 근로시간대. 이 밖의 근무는 원칙적으로 별도 승인이 필요하다. */
  flexBand: TimeBand | null;
  /** 야간근로 시간대. 자정을 넘는다. 가산수당 대상이므로 분리해서 기록한다. */
  nightWindow: TimeBand;
  /** 1일 근무 상한. 법정은 아니지만 건강권 관리용. null이면 검사하지 않는다. */
  dailyLimitMinutes: number | null;
  /** 휴일로 보는 요일. Luxon 기준 1=월 … 7=일 */
  weekendDays: number[];
  /** 법정공휴일·회사 휴무일 (YYYY-MM-DD) */
  holidays: string[];
};

/** 사원증·지문 단말이 남긴 태그 1건 */
export type TagInput = {
  occurredAt: Date;
  /** 지문 단말은 in/out 구분 없이 찍는 경우가 많다 */
  direction?: "in" | "out" | "unknown";
  deviceLabel?: string | null;
};

export type WorkDayStatus =
  | "computed"
  | "adjusted"
  /** 지난 날에 열린 세션이 남아 있다 — 체크아웃 누락 */
  | "incomplete"
  /** 오늘 진행 중 (근무 중) */
  | "open";

/** 팀장 "확인 필요" 목록에 올릴 사유 */
export type DayFlag =
  | "core_time_violation" // 의무근로시간대에 자리를 비웠다
  | "outside_flex_band" // 선택적 근로시간대 밖 근무
  | "over_daily_limit" // 1일 상한 초과
  | "zero_stay" // 태그는 여러 개인데 체류가 0분 (중복 인식)
  | "holiday_work"; // 휴일 근무

export type ComputedDay = {
  /** YYYY-MM-DD, dayBoundaryHour 기준으로 귀속된 날짜 */
  workDate: string;
  firstInAt: Date | null;
  lastOutAt: Date | null;
  /** 첫 태그 ~ 마지막 태그 */
  stayMinutes: number;
  breakMinutes: number;
  /** 실근무 = stay - break. 집계에 쓰는 값. */
  workMinutes: number;
  /**
   * 체류 구간과 야간시간대가 겹친 분. 가산수당 판단용 원자료.
   * 휴게가 언제 있었는지는 태그로 알 수 없으므로 체류 기준 근사값이다.
   */
  nightMinutes: number;
  isHoliday: boolean;
  flags: DayFlag[];
  status: WorkDayStatus;
  tagCount: number;
  /** 그 날의 근무 세션 수. 하루 여러 번 나눠 일하면 2 이상이 된다 */
  sessionCount: number;
  /** 진행 중인 세션의 시작 시각. null 이면 진행 중인 세션이 없다 */
  openSince: Date | null;
};

export type AdjustmentInput = {
  workDate: string;
  kind: "field_work" | "missing_tag" | "correction" | "revert";
  /** 태그 누락 — 시각 자체를 덮어쓴다 */
  overrideFirstInAt?: Date | null;
  overrideLastOutAt?: Date | null;
  /** 외근 — 시간만 더한다. 실근무 분(휴게 차감이 이미 반영된 값)으로 본다. */
  addedMinutes?: number;
};
