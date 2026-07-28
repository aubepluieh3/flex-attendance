import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "./client";
import { sessions, users } from "./schema";
import { generateTempPassword } from "./people";
import { hashPassword } from "@/lib/password";

/**
 * 비밀번호 초기화 (CLI 전용).
 *
 *   npm run db:reset-password -- F2014-002
 *
 * 화면으로 만들지 않는 이유:
 *
 * users.email 이 비어 있고 메일 발송 수단이 없어서 셀프서비스 재설정은
 * 원리적으로 불가능하다. 그렇다고 "누구나 남의 비밀번호를 초기화하는 창"을
 * 만들면 드문 상황(HR 이 잠김)을 위해 상시 공격면을 여는 셈이 된다.
 *
 * 서버에 들어올 수 있는 사람만 이걸 쓸 수 있고, 그 접근 권한이 곧 인증이다.
 *
 * 기존 세션도 끊는다 — 비밀번호를 바꿨는데 예전 로그인이 살아 있으면
 * "탈취됐을 때 잠그는" 목적을 못 채운다.
 */

const employeeNo = process.argv[2]?.trim();

if (!employeeNo) {
  console.error("사용법: npm run db:reset-password -- <사번>");
  console.error("예:     npm run db:reset-password -- F2014-002");
  process.exit(1);
}

const [user] = await db
  .select({ id: users.id, name: users.name, role: users.role })
  .from(users)
  .where(eq(users.employeeNo, employeeNo));

if (!user) {
  console.error(`사번 ${employeeNo} 을 찾을 수 없습니다.`);
  await pool.end();
  process.exit(1);
}

const temp = generateTempPassword();
await db
  .update(users)
  .set({ passwordHash: await hashPassword(temp) })
  .where(eq(users.id, user.id));
const killed = await db
  .delete(sessions)
  .where(eq(sessions.userId, user.id))
  .returning({ id: sessions.id });

console.log(`${user.name} (${employeeNo} · ${user.role})`);
console.log(`임시 비밀번호: ${temp}`);
console.log(`기존 세션 ${killed.length}건 종료`);
console.log("\n본인에게 직접 전달하고, 로그인 후 내 계정에서 바꾸게 하세요.");

await pool.end();
