import { createHash } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./client";
import { sessions, teams, users } from "./schema";
import type { Viewer } from "./access";
import { newSessionToken, verifyPassword } from "@/lib/password";
import { now } from "@/lib/clock";

/**
 * 로그인 세션.
 *
 * 쿠키에는 토큰 원본만, DB에는 SHA-256 해시만 둔다. DB가 유출돼도 세션을
 * 탈취할 수 없다. (비밀번호는 scrypt — 여긴 무작위 32바이트 토큰이라
 * 사전공격 대상이 아니므로 빠른 해시로 충분하다)
 */

export const SESSION_COOKIE = "flex_session";
const SESSION_HOURS = 12;

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; message: string };

export async function login(
  employeeNo: string,
  password: string,
): Promise<LoginResult> {
  const no = employeeNo.trim();
  // 실패 사유를 구분해서 알려주지 않는다 — 사번 존재 여부가 새어나간다
  const fail = {
    ok: false as const,
    message: "사번 또는 비밀번호가 올바르지 않습니다.",
  };
  if (!no || !password) return fail;

  const [user] = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      active: users.active,
    })
    .from(users)
    .where(eq(users.employeeNo, no));

  // 사번이 없어도 해시 검증을 한 번 돌려 응답 시간 차이를 줄인다
  const okPassword = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !user.active || !okPassword) return fail;

  const token = newSessionToken();
  const expiresAt = DateTime.fromJSDate(now())
    .plus({ hours: SESSION_HOURS })
    .toJSDate();

  await db.insert(sessions).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt,
  });

  // 만료된 세션은 이때 같이 치운다. 별도 배치를 두지 않아도 된다.
  await db.delete(sessions).where(lt(sessions.expiresAt, now()));

  return { ok: true, token, expiresAt };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/** 세션 토큰 → 사용자. 만료·비활성이면 null. */
export async function viewerFromToken(
  token: string | undefined,
): Promise<Viewer | null> {
  if (!token) return null;

  const [row] = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      name: users.name,
      role: users.role,
      teamId: users.teamId,
      teamName: teams.name,
      active: users.active,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(teams, eq(users.teamId, teams.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, now()),
      ),
    );

  if (!row || !row.active) return null;
  const { active, ...viewer } = row;
  void active;
  return viewer;
}
