import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./client";
import { teams, timeOff, users } from "./schema";
import { AccessDenied, loadOrgRules, type OrgRules, type Viewer } from "./access";
import { isPeriodClosed } from "./close";
import { resolvePeriod } from "@/lib/attendance/period";
import { now } from "@/lib/clock";

/**
 * 휴가 신청 / 승인.
 *
 * 흐름: 본인 신청(pending) → 승인자 결정(approved | rejected).
 * 집계는 approved 만 본다 — 승인 없이 반영되면 본인이 자기 소정근로를
 * 낮출 수 있다. 근태 보정은 "실제로 일한 것"의 신고라 성격이 다르다.
 *
 * 취소 규칙 (팀장 결정):
 *   승인 전  본인 + 승인자
 *   승인 후  승인자만 — 본인은 미래 날짜여도 못 지운다.
 *            본인이 지울 수 있으면 승인이 무슨 뜻인지 흐려진다.
 *
 * 잔여 연차는 관리하지 않는다. 총량을 넣으면 부여·이월·회계연도 기준이 전부
 * 따라오고, 그건 휴가 관리 시스템의 영역이다. 화면에 그렇다고 밝힌다.
 */

export type TimeOffKind = "full" | "half_am" | "half_pm" | "unpaid";
export type TimeOffStatus = "pending" | "approved" | "rejected";

export type TimeOffRow = {
  id: string;
  userId: string;
  userName: string;
  employeeNo: string;
  date: string;
  kind: TimeOffKind;
  deductMinutes: number;
  reason: string | null;
  status: TimeOffStatus;
  requestedByName: string;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string;
  createdAt: Date;
};

const KIND_LABEL: Record<TimeOffKind, string> = {
  full: "연차",
  half_am: "오전 반차",
  half_pm: "오후 반차",
  unpaid: "무급휴가",
};

/** YYYY-MM-DD 검증. 형식만 보면 2026-02-30 이 통과한다 */
function assertDate(value: string, label: string): string {
  const v = value.trim();
  const dt = DateTime.fromFormat(v, "yyyy-MM-dd", { zone: "Asia/Seoul" });
  if (!dt.isValid) throw new Error(`${label}가 올바르지 않습니다: ${value}`);
  return dt.toISODate()!;
}

/**
 * 차감량은 스냅샷이다.
 * 나중에 1일 소정근로가 바뀌어도 과거 휴가는 흔들리면 안 된다.
 */
export function deductFor(kind: TimeOffKind, standardMinutesPerDay: number) {
  return kind === "half_am" || kind === "half_pm"
    ? Math.round(standardMinutesPerDay / 2)
    : standardMinutesPerDay;
}

async function assertPeriodOpen(rules: OrgRules, date: string) {
  const range = resolvePeriod(date, {
    kind: rules.settlementKind,
    weekStartDay: rules.weekStartDay,
    timezone: rules.attendance.timezone,
  });
  if (await isPeriodClosed(rules.orgId, range)) {
    throw new AccessDenied(
      `${range.start} ~ ${range.end} 정산기간은 마감되어 휴가를 바꿀 수 없습니다.`,
    );
  }
}

/** 팀 하위 트리 (자기 팀 포함) */
async function teamScope(viewer: Viewer): Promise<Set<string>> {
  const scope = new Set<string>();
  if (!viewer.teamId) return scope;

  const rows = await db
    .select({ id: teams.id, parentId: teams.parentId })
    .from(teams)
    .where(eq(teams.orgId, viewer.orgId));

  const children = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const list = children.get(r.parentId);
    if (list) list.push(r.id);
    else children.set(r.parentId, [r.id]);
  }

  const queue = [viewer.teamId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (scope.has(id)) continue;
    scope.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return scope;
}

/**
 * 결정 권한.
 *
 * 팀원 → 팀장, 팀장·HR → HR. HR 은 자기 휴가를 스스로 승인할 수 있다 —
 * 막으면 HR 이 한 명인 조직에서 아무도 휴가를 못 쓴다. 대신 결정자를 남긴다.
 */
async function assertCanDecide(viewer: Viewer, targetUserId: string) {
  if (viewer.role === "hr") return;

  if (viewer.role !== "manager") {
    throw new AccessDenied("휴가 승인은 팀장 이상만 할 수 있습니다.");
  }
  if (viewer.id === targetUserId) {
    throw new AccessDenied(
      "본인 휴가는 스스로 승인할 수 없습니다. HR에 요청해 주세요.",
    );
  }

  const [target] = await db
    .select({ orgId: users.orgId, teamId: users.teamId })
    .from(users)
    .where(eq(users.id, targetUserId));

  const scope = await teamScope(viewer);
  if (
    target &&
    target.orgId === viewer.orgId &&
    target.teamId &&
    scope.has(target.teamId)
  ) {
    return;
  }
  throw new AccessDenied("자기 팀 소속의 휴가만 승인할 수 있습니다.");
}

/** 본인 휴가 신청 */
export async function requestTimeOff(
  viewer: Viewer,
  input: { date: string; kind: TimeOffKind; reason: string },
): Promise<{ date: string; kind: TimeOffKind }> {
  const day = assertDate(input.date, "휴가 날짜");
  const rules = await loadOrgRules(viewer.orgId);
  await assertPeriodOpen(rules, day);

  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw new Error("사유를 적어 주세요. 승인자가 판단할 근거가 됩니다.");
  }

  // 반려된 건은 부분 인덱스에서 빠지므로 같은 날짜를 다시 신청할 수 있다.
  const [dup] = await db
    .select({ status: timeOff.status })
    .from(timeOff)
    .where(
      and(
        eq(timeOff.userId, viewer.id),
        eq(timeOff.date, day),
        ne(timeOff.status, "rejected"),
      ),
    );
  if (dup) {
    throw new Error(
      dup.status === "pending"
        ? `${day} 은 이미 신청해서 승인 대기 중입니다.`
        : `${day} 은 이미 승인된 휴가가 있습니다.`,
    );
  }

  await db.insert(timeOff).values({
    orgId: viewer.orgId,
    userId: viewer.id,
    date: day,
    kind: input.kind,
    deductMinutes: deductFor(input.kind, rules.settlement.standardMinutesPerDay),
    reason,
    status: "pending",
    requestedBy: viewer.id,
    createdBy: viewer.id,
  });

  return { date: day, kind: input.kind };
}

/** 승인 / 반려 */
export async function decideTimeOff(
  viewer: Viewer,
  id: string,
  decision: "approve" | "reject",
  note: string,
): Promise<{ userName: string; date: string; kind: TimeOffKind }> {
  const [row] = await db
    .select({
      userId: timeOff.userId,
      orgId: timeOff.orgId,
      date: timeOff.date,
      kind: timeOff.kind,
      status: timeOff.status,
    })
    .from(timeOff)
    .where(eq(timeOff.id, id));

  if (!row || row.orgId !== viewer.orgId) {
    throw new Error("해당 휴가 신청을 찾을 수 없습니다.");
  }
  if (row.status !== "pending") {
    throw new Error(
      `이미 ${row.status === "approved" ? "승인" : "반려"}된 신청입니다.`,
    );
  }
  await assertCanDecide(viewer, row.userId);

  const text = note.trim();
  if (decision === "reject" && text.length === 0) {
    throw new Error("반려 사유를 적어 주세요. 없으면 다시 신청할 근거가 없습니다.");
  }

  const rules = await loadOrgRules(viewer.orgId);
  await assertPeriodOpen(rules, row.date);

  await db
    .update(timeOff)
    .set({
      status: decision === "approve" ? "approved" : "rejected",
      decidedBy: viewer.id,
      decidedAt: now(),
      decisionNote: text,
    })
    // 동시에 두 사람이 결정하면 먼저 쓴 쪽만 남는다
    .where(and(eq(timeOff.id, id), eq(timeOff.status, "pending")));

  const [target] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, row.userId));

  return {
    userName: target?.name ?? "",
    date: row.date,
    kind: row.kind as TimeOffKind,
  };
}

/**
 * 취소(삭제).
 *
 * 승인 전이면 본인도 지울 수 있고, 승인 후에는 승인자만 지울 수 있다.
 * 승인된 휴가를 본인이 지울 수 있으면 승인 절차가 형식이 된다.
 */
export async function cancelTimeOff(
  viewer: Viewer,
  id: string,
): Promise<{ date: string; wasApproved: boolean }> {
  const [row] = await db
    .select({
      userId: timeOff.userId,
      orgId: timeOff.orgId,
      date: timeOff.date,
      status: timeOff.status,
    })
    .from(timeOff)
    .where(eq(timeOff.id, id));

  if (!row || row.orgId !== viewer.orgId) {
    throw new Error("해당 휴가를 찾을 수 없습니다.");
  }

  const mine = row.userId === viewer.id;
  if (row.status === "pending") {
    if (!mine) await assertCanDecide(viewer, row.userId);
  } else if (row.status === "approved") {
    if (mine && viewer.role !== "hr") {
      throw new AccessDenied(
        "승인된 휴가는 본인이 취소할 수 없습니다. 팀장이나 HR에 요청해 주세요.",
      );
    }
    await assertCanDecide(viewer, row.userId);
  } else {
    // 반려된 건은 이력이므로 본인만 치울 수 있게 둔다
    if (!mine && viewer.role !== "hr") {
      throw new AccessDenied("본인 신청만 지울 수 있습니다.");
    }
  }

  const rules = await loadOrgRules(viewer.orgId);
  await assertPeriodOpen(rules, row.date);

  await db.delete(timeOff).where(eq(timeOff.id, id));
  return { date: row.date, wasApproved: row.status === "approved" };
}

function selectRow() {
  return {
    id: timeOff.id,
    userId: timeOff.userId,
    date: timeOff.date,
    kind: timeOff.kind,
    deductMinutes: timeOff.deductMinutes,
    reason: timeOff.reason,
    status: timeOff.status,
    decidedAt: timeOff.decidedAt,
    decisionNote: timeOff.decisionNote,
    createdAt: timeOff.createdAt,
  };
}

/** 이름을 한 번에 붙인다 (N+1 방지) */
async function withNames(
  rows: Array<{
    userId: string;
    requestedBy: string;
    decidedBy: string | null;
  }>,
) {
  const ids = [
    ...new Set(
      rows.flatMap((r) =>
        [r.userId, r.requestedBy, r.decidedBy].filter(
          (x): x is string => x !== null,
        ),
      ),
    ),
  ];
  if (ids.length === 0) return new Map<string, { name: string; employeeNo: string }>();

  const people = await db
    .select({ id: users.id, name: users.name, employeeNo: users.employeeNo })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(people.map((p) => [p.id, p]));
}

/** 내 휴가 (모든 상태). 정산기간이 아니라 최근 순으로 본다 */
export async function listMyTimeOff(
  viewer: Viewer,
  limit = 20,
): Promise<TimeOffRow[]> {
  const rows = await db
    .select({
      ...selectRow(),
      requestedBy: timeOff.requestedBy,
      decidedBy: timeOff.decidedBy,
    })
    .from(timeOff)
    .where(eq(timeOff.userId, viewer.id))
    .orderBy(desc(timeOff.date))
    .limit(limit);

  const names = await withNames(rows);
  return rows.map((r) => ({
    ...r,
    kind: r.kind as TimeOffKind,
    status: r.status as TimeOffStatus,
    userName: names.get(r.userId)?.name ?? "",
    employeeNo: names.get(r.userId)?.employeeNo ?? "",
    requestedByName: names.get(r.requestedBy)?.name ?? "",
    decidedByName: r.decidedBy ? (names.get(r.decidedBy)?.name ?? "") : null,
  }));
}

/** 내가 결정해야 하는 신청들 */
export async function listPendingFor(viewer: Viewer): Promise<TimeOffRow[]> {
  if (viewer.role !== "manager" && viewer.role !== "hr") return [];

  let userIds: string[] | null = null;
  if (viewer.role === "manager") {
    const scope = await teamScope(viewer);
    if (scope.size === 0) return [];
    const members = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.orgId, viewer.orgId),
          eq(users.active, true),
          inArray(users.teamId, [...scope]),
        ),
      );
    // 본인 것은 스스로 결정할 수 없으므로 목록에서도 뺀다
    userIds = members.map((m) => m.id).filter((id) => id !== viewer.id);
    if (userIds.length === 0) return [];
  }

  const rows = await db
    .select({
      ...selectRow(),
      requestedBy: timeOff.requestedBy,
      decidedBy: timeOff.decidedBy,
    })
    .from(timeOff)
    .where(
      and(
        eq(timeOff.orgId, viewer.orgId),
        eq(timeOff.status, "pending"),
        ...(userIds ? [inArray(timeOff.userId, userIds)] : []),
      ),
    )
    .orderBy(asc(timeOff.date));

  const names = await withNames(rows);
  return rows.map((r) => ({
    ...r,
    kind: r.kind as TimeOffKind,
    status: r.status as TimeOffStatus,
    userName: names.get(r.userId)?.name ?? "",
    employeeNo: names.get(r.userId)?.employeeNo ?? "",
    requestedByName: names.get(r.requestedBy)?.name ?? "",
    decidedByName: null,
  }));
}

/** 승인 대기 건수 (알림용) */
export async function pendingCountFor(viewer: Viewer): Promise<number> {
  return (await listPendingFor(viewer)).length;
}

export { KIND_LABEL as TIME_OFF_LABEL };
