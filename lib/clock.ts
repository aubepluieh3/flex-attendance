/**
 * 기준 시각.
 *
 * 시드 데이터가 특정 주에 고정돼 있어서, 실제 오늘로 보면 빈 주가 나온다.
 * DEMO_CLOCK 이 있으면 그 시각으로 본다. CSV 임포트가 붙으면 이 변수를 지운다.
 */
export function now(): Date {
  const fixed = process.env.DEMO_CLOCK;
  if (!fixed) return new Date();

  const parsed = new Date(fixed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`DEMO_CLOCK 값을 읽을 수 없습니다: ${fixed}`);
  }
  return parsed;
}

export const isDemoClock = () => Boolean(process.env.DEMO_CLOCK);
