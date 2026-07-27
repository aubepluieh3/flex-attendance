import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";

// promisify 가 options 를 받는 오버로드를 잃어버리므로 시그니처를 명시한다
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * 비밀번호 해싱. 의존성 없이 Node 내장 scrypt 를 쓴다.
 *
 * 저장 형식: scrypt$N$r$p$salt$hash (전부 16진수)
 * 파라미터를 문자열에 담아두면 나중에 비용을 올려도 기존 해시를 계속 검증할 수 있다.
 */

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 8) {
    throw new Error("비밀번호는 8자 이상이어야 합니다.");
  }
  const salt = randomBytes(SALT_LEN);
  const key = await scryptAsync(plain.normalize("NFKC"), salt, KEY_LEN, {
    N,
    r: R,
    p: P,
  });
  return ["scrypt", N, R, P, salt.toString("hex"), key.toString("hex")].join("$");
}

/**
 * 검증. 실패 사유(사번 없음/비밀번호 틀림)를 구분해서 알려주지 않는 건
 * 호출부의 몫이다. 여기서는 비교를 상수 시간으로 한다.
 */
export async function verifyPassword(
  plain: string,
  stored: string | null,
): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltHex, hashHex] = parts;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }

  const key = await scryptAsync(
    plain.normalize("NFKC"),
    Buffer.from(saltHex, "hex"),
    expected.length,
    { N: Number(n), r: Number(r), p: Number(p) },
  );

  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** 세션 토큰. 쿠키에 담는 원본과, DB에 저장할 해시를 따로 만든다. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}
