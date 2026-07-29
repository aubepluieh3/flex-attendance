import { randomInt } from "node:crypto";
import { and, asc, eq, gt, lt, ne, or, sql } from "drizzle-orm";
import { db } from "./client";
import { sessions, teams, users, workDays } from "./schema";
import { AccessDenied, type Role, type Viewer } from "./access";
import { hashPassword, verifyPassword } from "@/lib/password";

/**
 * 사용자·조직 관리 (HR).
 *
 * 이게 없으면 신규 입사자가 앱을 쓸 방법이 아예 없다 — 비밀번호를 받을 곳도,
 * users 에 들어갈 방법도 없어서 CSV 에 태그가 있어도 통째로 버려진다.
 */

function assertHr(viewer: Viewer) {
  if (viewer.role !== "hr") {
    throw new AccessDenied("사용자 관리는 HR 권한이 필요합니다.");
  }
}

/** 헷갈리는 글자(0/O, 1/l/I)를 뺀 임시 비밀번호. 화면에 한 번만 보여준다. */
export function generateTempPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[randomInt(alphabet.length)];
  return `flex-${out}`;
}

export type PersonRow = {
  id: string;
  name: string;
  employeeNo: string;
  email: string | null;
  role: Role;
  teamId: string | null;
  teamName: string | null;
  active: boolean;
  hasPassword: boolean;
  sessionCount: number;
  /** 재직기간 — 그 사람의 정산기간을 정한다 */
  hiredAt: string | null;
  resignedAt: string | null;
};

export async function listPeople(viewer: Viewer): Promise<PersonRow[]> {
  assertHr(viewer);
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      employeeNo: users.employeeNo,
      email: users.email,
      role: users.role,
      teamId: users.teamId,
      teamName: teams.name,
      active: users.active,
      hiredAt: users.hiredAt,
      resignedAt: users.resignedAt,
      passwordHash: users.passwordHash,
      sessionCount: sql<number>`(select count(*)::int from sessions s where s.user_id = ${users.id})`,
    })
    .from(users)
    .leftJoin(teams, eq(users.teamId, teams.id))
    .where(eq(users.orgId, viewer.orgId))
    .orderBy(asc(users.employeeNo));

  return rows.map(({ passwordHash, ...r }) => ({
    ...r,
    hasPassword: Boolean(passwordHash),
  }));
}

export async function listTeams(viewer: Viewer) {
  assertHr(viewer);
  return db
    .select({ id: teams.id, name: teams.name, parentId: teams.parentId })
    .from(teams)
    .where(eq(teams.orgId, viewer.orgId))
    .orderBy(asc(teams.name));
}

export async function addTeam(
  viewer: Viewer,
  name: string,
  parentId: string | null,
): Promise<void> {
  assertHr(viewer);
  if (!name.trim()) throw new Error("팀 이름을 넣어 주세요.");
  await db.insert(teams).values({
    orgId: viewer.orgId,
    name: name.trim(),
    parentId: parentId || null,
  });
}

/** 사용자 추가. 임시 비밀번호를 만들어 돌려준다 (저장은 해시만). */
export async function addPerson(
  viewer: Viewer,
  input: {
    name: string;
    employeeNo: string;
    email: string;
    role: Role;
    teamId: string | null;
  },
): Promise<{ tempPassword: string }> {
  assertHr(viewer);

  const name = input.name.trim();
  const employeeNo = input.employeeNo.trim();
  if (!name) throw new Error("이름을 넣어 주세요.");
  if (!employeeNo) throw new Error("사번을 넣어 주세요.");

  const [dup] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.orgId, viewer.orgId), eq(users.employeeNo, employeeNo)),
    );
  if (dup) throw new Error(`사번 ${employeeNo} 은 이미 등록되어 있습니다.`);

  const tempPassword = generateTempPassword();
  await db.insert(users).values({
    orgId: viewer.orgId,
    name,
    employeeNo,
    email: input.email.trim() || null,
    role: input.role,
    teamId: input.teamId || null,
    passwordHash: await hashPassword(tempPassword),
  });

  return { tempPassword };
}

/**
 * 비밀번호 초기화. 그 사람의 세션을 전부 끊는다 —
 * 탈취 대응으로 초기화하는 경우가 있으므로 기존 세션을 남기면 안 된다.
 */
export async function resetPassword(
  viewer: Viewer,
  userId: string,
): Promise<{ tempPassword: string }> {
  assertHr(viewer);

  /*
   * 자기 자신은 여기서 못 한다.
   *
   * 초기화는 그 사람의 세션을 전부 끊는다. 본인에게 하면 즉시 로그아웃되고,
   * 임시 비밀번호는 화면에 뜨기 전에 로그인 화면으로 튕겨서 사라진다.
   * 결과는 HR 스스로 잠기는 것이다 — 실제로 걸려봤다.
   *
   * 비밀번호를 바꾸려면 내 계정 화면을 쓰고(현재 비밀번호를 알아야 한다),
   * 정말 잊었으면 서버에서 npm run db:reset-password 를 쓴다.
   */
  if (userId === viewer.id) {
    throw new Error(
      "본인 비밀번호는 여기서 초기화할 수 없습니다. 내 계정 화면에서 변경하세요. " +
        "비밀번호를 잊었다면 서버에서 npm run db:reset-password 를 실행해야 합니다.",
    );
  }

  const tempPassword = generateTempPassword();
  const updated = await db
    .update(users)
    .set({ passwordHash: await hashPassword(tempPassword) })
    .where(and(eq(users.id, userId), eq(users.orgId, viewer.orgId)))
    .returning({ id: users.id });
  if (updated.length === 0) throw new Error("사용자를 찾을 수 없습니다.");

  await db.delete(sessions).where(eq(sessions.userId, userId));
  return { tempPassword };
}

/** 마지막 HR 을 잃으면 아무도 설정·마감을 만질 수 없다 */
async function assertNotLastHr(viewer: Viewer, userId: string) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        eq(users.orgId, viewer.orgId),
        eq(users.role, "hr"),
        eq(users.active, true),
        ne(users.id, userId),
      ),
    );
  if (n === 0) {
    throw new Error(
      "마지막 HR 계정입니다. 다른 사람을 HR 로 지정한 뒤에 바꿔 주세요.",
    );
  }
}

/**
 * 재직기간. 이 값이 그 사람의 정산기간을 정한다 —
 * 조직 정산기간과 교집합을 낸 구간으로 소정근로·52시간 분모가 계산된다.
 *
 * 비워두면 기간 전체를 재직으로 본다. 도입 전부터 있던 사람은 비워도 되지만,
 * 중도 입사자를 비워두면 그 달 소정근로를 전부 요구받고 52시간 판정이 느슨해진다.
 */
export async function setEmployment(
  viewer: Viewer,
  userId: string,
  input: { hiredAt: string | null; resignedAt: string | null },
): Promise<{ recordsOutside: number }> {
  assertHr(viewer);

  const { hiredAt, resignedAt } = input;
  if (hiredAt && resignedAt && resignedAt < hiredAt) {
    throw new Error("퇴사일이 입사일보다 앞설 수 없습니다.");
  }

  await db
    .update(users)
    .set({ hiredAt, resignedAt })
    .where(and(eq(users.id, userId), eq(users.orgId, viewer.orgId)));

  /*
   * 재직기간 밖에 기록이 있으면 그 자리에서 알려준다.
   *
   * 오류가 만들어지는 순간이 곧 입력하는 순간이다. 상시 알림 항목을 늘리는
   * 대신 여기서 말한다 — 고칠 수 있는 사람에게, 고칠 수 있는 때에.
   * 집계는 이미 교집합으로 잘리므로 숫자가 틀리지는 않는다.
   */
  const outside = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workDays)
    .where(
      and(
        eq(workDays.userId, userId),
        gt(workDays.tagCount, 0),
        or(
          hiredAt ? lt(workDays.workDate, hiredAt) : undefined,
          resignedAt ? gt(workDays.workDate, resignedAt) : undefined,
        ),
      ),
    );
  return { recordsOutside: outside[0]?.n ?? 0 };
}

export async function setRole(
  viewer: Viewer,
  userId: string,
  role: Role,
): Promise<void> {
  assertHr(viewer);
  if (role !== "hr") await assertNotLastHr(viewer, userId);

  await db
    .update(users)
    .set({ role })
    .where(and(eq(users.id, userId), eq(users.orgId, viewer.orgId)));
}

export async function setActive(
  viewer: Viewer,
  userId: string,
  active: boolean,
): Promise<void> {
  assertHr(viewer);

  if (!active) {
    // 자기 자신을 비활성화하면 즉시 잠긴다
    if (userId === viewer.id) {
      throw new Error("본인 계정은 비활성화할 수 없습니다.");
    }
    await assertNotLastHr(viewer, userId);
    // 비활성화하면 세션도 끊는다. 안 끊으면 로그인된 채로 계속 쓴다.
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }

  await db
    .update(users)
    .set({ active })
    .where(and(eq(users.id, userId), eq(users.orgId, viewer.orgId)));
}

export async function setTeam(
  viewer: Viewer,
  userId: string,
  teamId: string | null,
): Promise<void> {
  assertHr(viewer);
  await db
    .update(users)
    .set({ teamId: teamId || null })
    .where(and(eq(users.id, userId), eq(users.orgId, viewer.orgId)));
}

/**
 * 본인 비밀번호 변경. 현재 비밀번호를 확인하고, 다른 기기 세션을 끊는다.
 * (지금 쓰는 세션은 남긴다 — 바꾸자마자 로그아웃되면 당황한다)
 */
export async function changeOwnPassword(
  viewer: Viewer,
  current: string,
  next: string,
  keepTokenHash: string | null,
): Promise<void> {
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, viewer.id));

  if (!(await verifyPassword(current, row?.passwordHash ?? null))) {
    throw new Error("현재 비밀번호가 올바르지 않습니다.");
  }
  if (next.length < 8) throw new Error("새 비밀번호는 8자 이상이어야 합니다.");
  if (next === current) {
    throw new Error("현재 비밀번호와 다른 값을 넣어 주세요.");
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(users.id, viewer.id));

  const where = keepTokenHash
    ? and(eq(sessions.userId, viewer.id), ne(sessions.tokenHash, keepTokenHash))
    : eq(sessions.userId, viewer.id);
  await db.delete(sessions).where(where);
}
