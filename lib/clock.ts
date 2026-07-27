/**
 * 기준 시각.
 *
 * 앱 안에 시계는 하나만 둔다. new Date() 를 여기 밖에서 쓰면
 * lib/clock.guard.test.ts 가 잡는다 — 시계가 두 개면 마감 유예처럼 시각에
 * 의존하는 계산이 조용히 어긋난다.
 *
 * FLEX_CLOCK 은 개발·테스트에서 특정 시점을 재현할 때만 쓴다. 시드는 실제
 * 오늘 기준 상대 날짜로 만들어지므로 평소에는 필요 없다.
 */
export function now(): Date {
  const fixed = process.env.FLEX_CLOCK;
  if (!fixed) return new Date();

  const parsed = new Date(fixed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`FLEX_CLOCK 값을 읽을 수 없습니다: ${fixed}`);
  }
  return parsed;
}

/** 고정 시계로 도는 중인지 (화면에 표시해서 혼란을 막는다) */
export const isFixedClock = () => Boolean(process.env.FLEX_CLOCK);
