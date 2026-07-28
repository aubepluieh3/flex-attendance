/**
 * redirect() / notFound() 는 예외를 던져서 흐름을 바꾼다.
 *
 * 서버 액션에서 catch-all 로 잡으면 그게 사용자 메시지로 바뀌어버린다 —
 * 세션이 끊겼을 때 로그인으로 가야 하는데 "NEXT_REDIRECT" 라는 문자열이
 * 화면에 뜬다. 그래서 잡은 뒤 제일 먼저 이걸 통과시킨다.
 */
export function rethrowControlFlow(e: unknown): void {
  const digest = (e as { digest?: unknown } | null)?.digest;
  if (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  ) {
    throw e;
  }
}

/**
 * 액션이 실패했을 때 남긴다.
 *
 * 지금까지는 오류가 사용자 화면에 배너로만 뜨고 아무 데도 안 남았다. 500 이
 * 떠도 사용자가 말해주기 전까지 몰랐다. 흐름 제어(redirect)는 걸러낸다 —
 * 그건 오류가 아니다.
 */
export async function reportActionError(
  where: string,
  e: unknown,
  viewer?: { id: string; orgId: string } | null,
): Promise<void> {
  rethrowControlFlow(e);
  const { recordError } = await import("@/db/errors");
  await recordError({
    where,
    error: e,
    orgId: viewer?.orgId ?? null,
    userId: viewer?.id ?? null,
  });
}

/** FormData 문자열 읽기. 액션 파일 네 곳이 각자 갖고 있었다. */
export const str = (form: FormData, key: string) =>
  String(form.get(key) ?? "");

/** FormData 숫자 읽기 */
export function num(form: FormData, key: string, fallback = 0): number {
  const raw = str(form, key).trim();
  const n = Number(raw);
  return raw === "" || Number.isNaN(n) ? fallback : n;
}
