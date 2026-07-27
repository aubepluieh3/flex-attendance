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
