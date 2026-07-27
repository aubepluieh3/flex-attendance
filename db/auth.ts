import { createHash } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "./client";
import { loginAttempts, sessions, teams, users } from "./schema";
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

/**
 * 세션 수명.
 *
 * 고정 12시간은 이 앱에 안 맞는다 — 근태는 하루 한두 번 잠깐 열어보는 앱이라
 * 아침에 로그인하고 저녁에 열면 끊긴다. 쓰는 동안에는 연장되고(슬라이딩),
 * 안 쓰면 끊기게 한다.
 */
const SESSION_HOURS = 12;
/** 남은 시간이 이보다 적으면 연장한다 (매 요청 UPDATE 를 피하려고 문턱을 둔다) */
const RENEW_WHEN_UNDER_HOURS = 8;

/**
 * 무차별 대입 제한.
 *
 * 사번 기준을 너무 조이면 남의 계정을 일부러 잠그는 수단이 된다(DoS). 그래서
 * 사번은 관대하게, IP 는 촘촘하게 둔다. 잠금은 "차단"이 아니라 "지연"이다.
 */
const WINDOW_MINUTES = 15;
const MAX_PER_EMPLOYEE = 10;
const MAX_PER_IP = 20;
/** IP 는 개인정보이므로 오래 두지 않는다 */
const ATTEMPT_RETENTION_HOURS = 24;

export type LockInfo = { locked: boolean; retryAfterMinutes: number };

async function failuresSince(
  windowStart: Date,
  employeeNo: string,
  ip: string | null,
) {
  const [byEmployee] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.employeeNo, employeeNo),
        eq(loginAttempts.succeeded, false),
        gt(loginAttempts.createdAt, windowStart),
      ),
    );

  const byIp = ip
    ? (
        await db
          .select({ n: sql<number>`count(*)::int` })
          .from(loginAttempts)
          .where(
            and(
              eq(loginAttempts.ip, ip),
              eq(loginAttempts.succeeded, false),
              gt(loginAttempts.createdAt, windowStart),
            ),
          )
      )[0]
    : { n: 0 };

  return { employee: byEmployee?.n ?? 0, ip: byIp?.n ?? 0 };
}

/** 존재하지 않는 사번도 같은 규칙으로 센다 — 존재 여부가 새어나가면 안 된다 */
export async function checkLock(
  employeeNo: string,
  ip: string | null,
): Promise<LockInfo> {
  const windowStart = DateTime.fromJSDate(now())
    .minus({ minutes: WINDOW_MINUTES })
    .toJSDate();
  const counts = await failuresSince(windowStart, employeeNo, ip);

  const locked =
    counts.employee >= MAX_PER_EMPLOYEE || counts.ip >= MAX_PER_IP;
  return { locked, retryAfterMinutes: locked ? WINDOW_MINUTES : 0 };
}

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; message: string };

export async function login(
  employeeNo: string,
  password: string,
  ip: string | null = null,
): Promise<LoginResult> {
  const no = employeeNo.trim();
  // 실패 사유를 구분해서 알려주지 않는다 — 사번 존재 여부가 새어나간다
  const fail = {
    ok: false as const,
    message: "사번 또는 비밀번호가 올바르지 않습니다.",
  };
  if (!no || !password) return fail;

  const lock = await checkLock(no, ip);
  if (lock.locked) {
    return {
      ok: false,
      message: `로그인 시도가 너무 많습니다. ${lock.retryAfterMinutes}분 후 다시 시도해 주세요.`,
    };
  }

  const record = (succeeded: boolean) =>
    db.insert(loginAttempts).values({ employeeNo: no, ip, succeeded });

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
  if (!user || !user.active || !okPassword) {
    await record(false);
    return fail;
  }
  await record(true);

  // 성공하면 그 사번의 실패 기록을 지운다. 안 지우면 정상 사용자가
  // 오타 몇 번 뒤에 잠긴다.
  await db
    .delete(loginAttempts)
    .where(
      and(
        eq(loginAttempts.employeeNo, no),
        eq(loginAttempts.succeeded, false),
      ),
    );

  const token = newSessionToken();
  const expiresAt = DateTime.fromJSDate(now())
    .plus({ hours: SESSION_HOURS })
    .toJSDate();

  await db.insert(sessions).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt,
  });

  // 만료된 세션과 오래된 시도 기록을 이때 같이 치운다. 별도 배치가 없어도 된다.
  await db.delete(sessions).where(lt(sessions.expiresAt, now()));
  await db.delete(loginAttempts).where(
    lt(
      loginAttempts.createdAt,
      DateTime.fromJSDate(now()).minus({ hours: ATTEMPT_RETENTION_HOURS }).toJSDate(),
    ),
  );

  return { ok: true, token, expiresAt };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

/**
 * 세션 토큰 → 사용자. 만료·비활성이면 null.
 *
 * 쓰는 동안에는 만료를 미룬다. 쿠키 만료까지 같이 늘려야 브라우저가 쿠키를
 * 버리지 않으므로, 갱신했으면 새 만료 시각을 함께 돌려준다.
 */
export async function viewerFromToken(
  token: string | undefined,
): Promise<Viewer | null> {
  return (await resolveSession(token))?.viewer ?? null;
}

export async function resolveSession(
  token: string | undefined,
): Promise<{ viewer: Viewer; renewedUntil: Date | null } | null> {
  if (!token) return null;
  const at = now();

  const [row] = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      name: users.name,
      role: users.role,
      teamId: users.teamId,
      teamName: teams.name,
      active: users.active,
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .leftJoin(teams, eq(users.teamId, teams.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, at)));

  if (!row || !row.active) return null;

  const { active, sessionId, expiresAt, ...viewer } = row;
  void active;

  // 남은 시간이 문턱 아래면 연장한다. 매 요청 UPDATE 하지 않으려고 문턱을 둔다.
  const hoursLeft = (expiresAt.getTime() - at.getTime()) / 3600000;
  if (hoursLeft >= RENEW_WHEN_UNDER_HOURS) {
    return { viewer, renewedUntil: null };
  }

  const renewedUntil = DateTime.fromJSDate(at)
    .plus({ hours: SESSION_HOURS })
    .toJSDate();
  await db
    .update(sessions)
    .set({ expiresAt: renewedUntil })
    .where(eq(sessions.id, sessionId));

  return { viewer, renewedUntil };
}
