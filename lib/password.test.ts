import { describe, expect, it } from "vitest";
import { hashPassword, newSessionToken, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("맞는 비밀번호는 통과", async () => {
    const hash = await hashPassword("flex-demo-1234");
    expect(await verifyPassword("flex-demo-1234", hash)).toBe(true);
  });

  it("틀린 비밀번호는 거부", async () => {
    const hash = await hashPassword("flex-demo-1234");
    expect(await verifyPassword("flex-demo-1235", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("같은 비밀번호도 해시가 매번 다르다 (솔트)", async () => {
    const a = await hashPassword("flex-demo-1234");
    const b = await hashPassword("flex-demo-1234");
    expect(a).not.toBe(b);
    expect(await verifyPassword("flex-demo-1234", a)).toBe(true);
    expect(await verifyPassword("flex-demo-1234", b)).toBe(true);
  });

  it("해시에 파라미터가 들어 있어 나중에 비용을 올려도 검증된다", async () => {
    const hash = await hashPassword("flex-demo-1234");
    const [algo, n, r, p] = hash.split("$");
    expect(algo).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(16384);
    expect([Number(r), Number(p)]).toEqual([8, 1]);
  });

  it("평문을 해시에 남기지 않는다", async () => {
    const hash = await hashPassword("flex-demo-1234");
    expect(hash).not.toContain("flex-demo-1234");
  });

  it("비밀번호가 없는 사용자(SSO 전용)는 항상 거부", async () => {
    expect(await verifyPassword("아무거나", null)).toBe(false);
  });

  it("깨진 해시 문자열에도 예외를 던지지 않는다", async () => {
    for (const broken of ["", "x", "scrypt$1$2", "bcrypt$1$2$3$4$5"]) {
      expect(await verifyPassword("flex-demo-1234", broken)).toBe(false);
    }
  });

  it("8자 미만은 만들 수 없다", async () => {
    await expect(hashPassword("1234567")).rejects.toThrow("8자 이상");
  });

  it("유니코드 정규화가 다른 입력도 같게 본다", async () => {
    // 조합형/완성형 한글이 섞여 들어와도 같은 비밀번호로 취급한다
    const composed = "비밀번호1234";
    const decomposed = composed.normalize("NFD");
    expect(composed).not.toBe(decomposed);
    const hash = await hashPassword(composed);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });
});

describe("newSessionToken", () => {
  it("매번 다르고 충분히 길다", () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43); // 32바이트 base64url
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
