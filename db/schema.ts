import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  date,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * 설계 원칙
 *
 * 1. 원본(attendance_logs)은 절대 수정하지 않는다. append-only.
 * 2. 집계(work_days)는 원본에서 파생된다. 규칙이 바뀌면 전부 재계산한다.
 * 3. 근태 규칙은 코드가 아니라 org_settings 데이터로 둔다.
 * 4. 모든 시각은 timestamptz(UTC 저장). 표시만 Asia/Seoul.
 * 5. 주간 집계 테이블은 두지 않는다 — 주 경계가 설정으로 바뀌면 stale해진다.
 *    work_days를 SUM 한다.
 */

export const settlementPeriod = pgEnum("settlement_period", ["week", "month"]);
export const targetCalcMethod = pgEnum("target_calc_method", [
  "business_days",
  "fixed",
]);

/**
 * 직급이 아니라 역할로 나눈다. 열람 근거가 "직급이 높아서"이면 안 된다.
 *   member    본인만
 *   manager   자기 팀(및 하위 팀) 개인 상세
 *   hr        전사 개인 상세
 *   executive 전사 집계만 — 개인 일별 기록은 볼 수 없다
 */
export const userRole = pgEnum("user_role", [
  "member",
  "manager",
  "hr",
  "executive",
]);
export const logSource = pgEnum("log_source", ["import", "manual"]);
export const logDirection = pgEnum("log_direction", ["in", "out", "unknown"]);
export const workDayStatus = pgEnum("work_day_status", [
  "computed", // 태그로 정상 계산됨
  "adjusted", // 보정이 적용됨
  "incomplete", // 태그가 1개뿐 — 퇴근 미기록
]);
export const adjustmentKind = pgEnum("adjustment_kind", [
  "field_work", // 외근·출장
  "missing_tag", // 사원증 미소지, 인식 실패
  "correction", // 그 외 정정
  "revert", // 이전 보정 취소
]);
export const timeOffKind = pgEnum("time_off_kind", [
  "full",
  "half_am",
  "half_pm",
  "unpaid",
]);
export const periodStatus = pgEnum("period_status", ["open", "closed"]);
export const periodCloseAction = pgEnum("period_close_action", [
  "close",
  "reopen",
]);
export const notificationKind = pgEnum("notification_kind", [
  "incomplete_day",   // 퇴근 기록 없는 날
  "rule_violation",   // 코어타임 미준수 등
  "legal_limit",      // 주 평균 52시간 초과
  "period_closing",   // 마감 임박 · 아직 목표 미달
  "post_close_change",// 마감 후 값이 바뀜
  "team_review",      // 팀장: 팀에 확인 필요
]);
export const accessScope = pgEnum("access_scope", [
  "self",
  "user",
  "team",
  "org",
]);
export const accessResource = pgEnum("access_resource", [
  "work_days", // 일별 근무 기록
  "adjustments", // 보정 내역
  "summary", // 집계만 (개인 식별 없음)
  "export", // CSV 내보내기
]);

/** 규칙 타입은 도메인 레이어가 소유한다. DB가 도메인을 정의하지 않게. */
import type { BreakRule, DayFlag } from "../lib/attendance/types";

/** 회사 단위 근태 규칙. 하드코딩하지 않는 이유는 회사마다 다르기 때문. */
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Seoul"),

  // 정산 — 팀장 결정으로 기본 '주'
  settlementPeriod: settlementPeriod("settlement_period")
    .notNull()
    .default("week"),
  weekStartDay: integer("week_start_day").notNull().default(1), // 1=월요일
  /**
   * 소정근로 산정 방식.
   * business_days = 영업일 × 1일 소정근로 (기본) — 월별 영업일 차이가 반영된다.
   * fixed = 정산기간당 고정 시간.
   */
  targetCalcMethod: targetCalcMethod("target_calc_method")
    .notNull()
    .default("business_days"),
  /** fixed 방식에서만 쓴다 */
  targetMinutesPerPeriod: integer("target_minutes_per_period")
    .notNull()
    .default(40 * 60),
  limitMinutesPerWeek: integer("limit_minutes_per_week")
    .notNull()
    .default(52 * 60), // 법정 상한

  // 휴가 1일이 차감하는 소정근로
  standardMinutesPerDay: integer("standard_minutes_per_day")
    .notNull()
    .default(8 * 60),

  // 체류시간 ≠ 근무시간. 안 빼면 매일 1시간씩 부풀려진다.
  breakRules: jsonb("break_rules")
    .$type<BreakRule[]>()
    .notNull()
    .default([
      { overHours: 4, deductMinutes: 30 },
      { overHours: 8, deductMinutes: 60 },
    ]),

  // 자정 넘긴 근무를 어느 날로 칠지. 이 시각 이전 태그는 전날로 귀속.
  dayBoundaryHour: integer("day_boundary_hour").notNull().default(5),

  // ── 선택적 근로시간제 서면합의 항목 (근기법 §52) ──
  // 의무근로시간대. 총 시간만 채우면 새벽에만 일해도 통과하는 구멍을 막는다.
  // 운영하지 않는 회사도 있으므로 null 허용.
  coreTimeStart: text("core_time_start"), // "10:00"
  coreTimeEnd: text("core_time_end"), // "15:00"
  // 선택적 근로시간대. 이 밖의 근무는 원칙적으로 별도 승인 대상.
  flexBandStart: text("flex_band_start"), // "07:00"
  flexBandEnd: text("flex_band_end"), // "22:00"

  // 야간근로(§56)는 가산 대상이므로 시간을 분리해 기록한다.
  // 앱은 시간만 남기고 수당 판단은 하지 않는다.
  nightWindowStart: text("night_window_start").notNull().default("22:00"),
  nightWindowEnd: text("night_window_end").notNull().default("06:00"),

  /** 1일 근무 상한. 법정은 아니고 건강권 관리용. null이면 검사하지 않는다. */
  dailyLimitMinutes: integer("daily_limit_minutes").default(12 * 60),
  /** 휴일로 보는 요일. Luxon 기준 1=월 … 7=일 */
  weekendDays: jsonb("weekend_days")
    .$type<number[]>()
    .notNull()
    .default([6, 7]),

  // 200명 전수 확인은 불가능하다. 정산기간 내 보정 총합이 이 값을 넘을 때만
  // 팀장 "확인 필요" 목록에 올린다. (태그 0인 날의 보정은 값과 무관하게 항상 올림)
  reviewThresholdMinutes: integer("review_threshold_minutes")
    .notNull()
    .default(8 * 60),

  /** 정산기간 종료 후 보정 유예일. 이 기간이 지나면 자동 마감된다. */
  closeGraceDays: integer("close_grace_days").notNull().default(3),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 조직 트리. 200명이면 팀 → 본부 2단계가 반드시 나온다.
 * parentId를 나중에 넣으면 권한 쿼리를 전부 다시 써야 하므로 지금 넣는다.
 * "이 팀의 팀장" 은 teams.managerId 대신 users(teamId, role='manager') 로 표현한다.
 * (순환 FK를 만들지 않기 위해)
 */
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => teams.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("teams_org_parent").on(t.orgId, t.parentId)],
);

/**
 * 법정공휴일·회사 휴무일. 연도마다 늘어나고 조회 대상이므로 설정 jsonb가 아니라
 * 테이블로 둔다. (2026년 삼일절처럼 대체공휴일이 생기는 해가 있다)
 */
export const holidays = pgTable(
  "holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    date: date("date", { mode: "string" }).notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("holidays_org_date").on(t.orgId, t.date)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    name: text("name").notNull(),
    email: text("email"),
    /** 근태 시스템의 사번. CSV 임포트 매칭 키. */
    employeeNo: text("employee_no").notNull(),
    /** 나중에 SSO 붙일 자리 */
    externalId: text("external_id"),
    /** scrypt 해시. SSO만 쓰는 사용자는 null 이라 로그인이 불가하다. */
    passwordHash: text("password_hash"),
    teamId: uuid("team_id").references(() => teams.id),
    role: userRole("role").notNull().default("member"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("users_org_employee_no").on(t.orgId, t.employeeNo)],
);

/** CSV 업로드 이력. 벤더 포맷을 모르므로 컬럼 매핑을 업로드마다 저장한다. */
export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => users.id),
  fileName: text("file_name").notNull(),
  columnMapping: jsonb("column_mapping")
    .$type<Record<string, string>>()
    .notNull(),
  rowCount: integer("row_count").notNull().default(0),
  insertedCount: integer("inserted_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * 원본 태그. append-only, UPDATE/DELETE 금지.
 * direction이 unknown인 이유: 지문 단말은 in/out 구분 없이 찍는 경우가 많다.
 */
export const attendanceLogs = pgTable(
  "attendance_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /**
     * NULL이 아니라 빈 문자열을 쓴다. Postgres 유니크 인덱스는 NULL을 서로 다른
     * 값으로 취급해서, nullable로 두면 단말명이 없는 태그는 중복 방지가 통째로
     * 안 걸린다 — 같은 CSV를 두 번 올리면 그대로 두 배가 된다.
     */
    deviceLabel: text("device_label").notNull().default(""),
    direction: logDirection("direction").notNull().default("unknown"),
    source: logSource("source").notNull().default("import"),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id),
    /** 원본 CSV 행 그대로. 매핑이 틀렸을 때 재해석할 수 있게. */
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 같은 CSV를 두 번 올려도 중복이 안 쌓이게
    uniqueIndex("attendance_logs_dedupe").on(
      t.userId,
      t.occurredAt,
      t.deviceLabel,
    ),
    index("attendance_logs_user_time").on(t.userId, t.occurredAt),
  ],
);

/**
 * 일별 집계. 파생 데이터이므로 언제든 원본에서 재계산 가능해야 한다.
 * workDate는 dayBoundaryHour 기준으로 귀속된 날짜.
 */
export const workDays = pgTable(
  "work_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    workDate: date("work_date", { mode: "string" }).notNull(),

    firstInAt: timestamp("first_in_at", { withTimezone: true }),
    lastOutAt: timestamp("last_out_at", { withTimezone: true }),

    stayMinutes: integer("stay_minutes").notNull().default(0),
    breakMinutes: integer("break_minutes").notNull().default(0),
    /** 실근무 = stay - break (+ 보정) */
    workMinutes: integer("work_minutes").notNull().default(0),
    /** 야간(22~06시) 겹침 분. 가산 판단용 원자료. 휴게 위치를 모르므로 근사값. */
    nightMinutes: integer("night_minutes").notNull().default(0),
    isHoliday: boolean("is_holiday").notNull().default(false),
    /** 코어타임 위반, 선택시간대 밖, 일 상한 초과 등 — "확인 필요" 목록의 근거 */
    flags: jsonb("flags").$type<DayFlag[]>().notNull().default([]),

    status: workDayStatus("status").notNull().default("computed"),
    tagCount: integer("tag_count").notNull().default(0),

    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("work_days_user_date").on(t.userId, t.workDate),
    index("work_days_org_date").on(t.orgId, t.workDate),
  ],
);

/**
 * 예외 보정. append-only — 수정/삭제 대신 새 행을 쌓는다.
 * 적용은 (userId, workDate) 기준 가장 최근 1건만. 나머지는 이력.
 */
export const dayAdjustments = pgTable(
  "day_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    workDate: date("work_date", { mode: "string" }).notNull(),

    kind: adjustmentKind("kind").notNull(),
    /** 시각을 덮어쓰는 경우 (태그 누락) */
    overrideFirstInAt: timestamp("override_first_in_at", {
      withTimezone: true,
    }),
    overrideLastOutAt: timestamp("override_last_out_at", {
      withTimezone: true,
    }),
    /** 시간만 더하는 경우 (외근) */
    addedMinutes: integer("added_minutes").notNull().default(0),

    reason: text("reason").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    // 승인 플로우는 아직 안 쓴다. 자리만 남김.
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (t) => [
    index("day_adjustments_user_date").on(t.userId, t.workDate, t.createdAt),
  ],
);

/**
 * 휴가. deductMinutes를 저장하는 이유:
 * 나중에 standardMinutesPerDay가 바뀌어도 과거 휴가 차감량이 흔들리면 안 된다.
 * (근태 집계는 재계산, 휴가 차감은 스냅샷 — 의도된 비대칭)
 */
export const timeOff = pgTable(
  "time_off",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    date: date("date", { mode: "string" }).notNull(),
    kind: timeOffKind("kind").notNull(),
    deductMinutes: integer("deduct_minutes").notNull(),
    reason: text("reason"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("time_off_user_date").on(t.userId, t.date)],
);

/**
 * 정산기간과 마감 상태.
 *
 * 마감이 없으면 지난 주 CSV를 다시 올릴 때 확정된 과거 근무시간이 조용히 바뀐다.
 * 근태 데이터에서는 치명적이다. 정산기간이 끝나고 유예일이 지나면 잠근다.
 */
export const settlementPeriods = pgTable(
  "settlement_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    /** 포함 */
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    status: periodStatus("status").notNull().default("open"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /**
     * HR이 재마감한 시각. 이 값이 있으면 유예일이 다시 흐른다 —
     * 없으면 재마감 직후 배치가 즉시 다시 마감해서 고칠 틈이 없다.
     */
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("settlement_periods_org_start").on(t.orgId, t.periodStart)],
);

/** 마감·재마감 이력. append-only — status는 여기서 파생되는 조회용 값이다. */
export const periodCloseEvents = pgTable(
  "period_close_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => settlementPeriods.id),
    action: periodCloseAction("action").notNull(),
    /** 자동 마감이면 null */
    actorUserId: uuid("actor_user_id").references(() => users.id),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("period_close_events_period").on(t.periodId, t.createdAt)],
);

/**
 * 마감 시점의 개인별 집계 스냅샷.
 *
 * 마감 후 휴게 규칙 같은 설정이 바뀌면 재계산 결과가 달라진다. 마감된 기간은
 * **당시 값**을 공식 기록으로 보여줘야 하므로 얼려둔다.
 * 현재 재계산값과 차이가 나면 "마감 후 변경"으로 표시한다.
 */
export const periodSnapshots = pgTable(
  "period_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    periodId: uuid("period_id")
      .notNull()
      .references(() => settlementPeriods.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),

    targetMinutes: integer("target_minutes").notNull(),
    workedMinutes: integer("worked_minutes").notNull(),
    nightMinutes: integer("night_minutes").notNull(),
    holidayMinutes: integer("holiday_minutes").notNull(),
    overtimeMinutes: integer("overtime_minutes").notNull(),
    /** 반올림한 분 */
    avgWeeklyMinutes: integer("avg_weekly_minutes").notNull(),

    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  /**
   * 유니크가 아니다. 재마감 후 다시 마감하면 새 스냅샷이 쌓인다 —
   * 그 시점에 무엇이 공식 기록이었는지가 감사 대상이므로 덮어쓰지 않는다.
   * 조회는 capturedAt 최신 1건.
   */
  (t) => [
    index("period_snapshots_period_user").on(
      t.periodId,
      t.userId,
      t.capturedAt,
    ),
  ],
);

/**
 * 로그인 시도 기록.
 *
 * 비밀번호 무차별 대입을 막는다. scrypt 가 느려서 초당 시도 수는 낮지만,
 * 그것만으로는 잠금이 아니다.
 *
 * 비밀번호는 당연히 저장하지 않는다. IP 는 개인정보이므로 24시간만 두고
 * 로그인 시점에 오래된 행을 지운다.
 */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 존재하지 않는 사번도 기록한다 — 스캐닝을 보려면 필요하다 */
    employeeNo: text("employee_no").notNull(),
    ip: text("ip"),
    succeeded: boolean("succeeded").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("login_attempts_employee").on(t.employeeNo, t.createdAt),
    index("login_attempts_ip").on(t.ip, t.createdAt),
  ],
);

/**
 * 알림.
 *
 * append-only 가 아니다 — 알림은 감사 기록이 아니라 "할 일" 목록이므로,
 * 조건이 해소되면(미완료를 보정하면) 지운다. 남겨두면 목록이 쓰레기가 된다.
 *
 * dedupeKey 로 중복을 막는다. 임포트마다 같은 알림이 쌓이면 아무도 안 본다.
 * 전달 채널(이메일·슬랙)은 아직 없다. 지금은 인앱 알림함뿐이다.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: notificationKind("kind").notNull(),
    /** 같은 사유가 두 번 생기지 않게 하는 키 (kind + 대상 날짜/기간) */
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** 눌렀을 때 갈 곳 */
    href: text("href").notNull(),
    periodStart: date("period_start", { mode: "string" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe").on(t.userId, t.dedupeKey),
    index("notifications_user_unread").on(t.userId, t.readAt),
  ],
);

/**
 * 로그인 세션.
 *
 * 서명 쿠키 대신 테이블로 둔다. 매 요청 어차피 사용자를 DB에서 읽으므로
 * 비용 차이가 없고, 로그아웃과 강제 만료가 확실해진다.
 * 토큰 원본은 쿠키에만 있고 DB에는 SHA-256 해시를 저장한다 — DB가 유출돼도
 * 세션을 탈취할 수 없다.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash").on(t.tokenHash),
    index("sessions_user").on(t.userId),
  ],
);

/**
 * 열람 이력. 권한은 "볼 수 있냐"만 통제하지만, 이 로그는 "왜 봤냐"에 답한다.
 * 근태는 개인정보이고, 이력이 남는다는 사실만으로 불필요한 조회가 줄어든다.
 *
 * 직원에게 "누가 당신 기록을 봤습니다"를 노출하지는 않는다. 팀장이 정상 업무로
 * 확인한 걸 통보하면 관계가 이상해진다. HR/보안 요청 시에만 열어보는 용도.
 *
 * IP는 수집하지 않는다. 누가/언제/누구를 이면 감사 목적에 충분하다.
 */
export const accessLogs = pgTable(
  "access_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    scope: accessScope("scope").notNull(),
    resource: accessResource("resource").notNull(),
    /** scope='user'일 때만 채워진다 */
    targetUserId: uuid("target_user_id").references(() => users.id),
    /** scope='team'일 때만 채워진다 */
    targetTeamId: uuid("target_team_id").references(() => teams.id),
    /** 조회한 기간 */
    periodStart: date("period_start", { mode: "string" }),
    periodEnd: date("period_end", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("access_logs_actor").on(t.actorUserId, t.createdAt),
    index("access_logs_target").on(t.targetUserId, t.createdAt),
  ],
);
