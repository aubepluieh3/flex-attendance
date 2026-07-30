import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 글자 크기와 라운드는 토큰으로만 쓴다.
 *
 * 두 번 늘어났다. 처음에 28종이던 것을 4단 토큰으로 줄였는데, 토큰이 덮지
 * 못하는 자리(제품명·히어로 숫자·태그)마다 생값을 쓰다가 다시 17종이 됐다.
 * 절반이 13/13.5, 12/12.5, 11/11.5 처럼 0.5px 차이였다 — 눈에는 같고 코드에는
 * 다르다. 새 화면을 만들 때 어느 쪽을 쓸지 정할 근거가 없으면 또 하나가 는다.
 *
 * 그래서 8단으로 늘리고 쓰임을 이름에 박은 뒤, 생값을 여기서 막는다.
 * 새 크기가 정말 필요하면 :root 에 이름 있는 단을 추가하는 게 맞다.
 *
 * 예외는 값 자체가 뜻인 것만 —
 *   0.92em  code. 부모 크기에 붙어야 한다 (어느 단에 놓여도 어울리게)
 *   50%     .status .dot. 원이다
 *   1px     .prog .tick. 1px 막대의 끝 처리
 */

const FILE = "app/globals.css";
const TOKEN_BLOCK_END = /^\}/m;

/** 생값이어도 되는 것 */
const ALLOWED = new Set(["0.92em", "50%", "1px"]);

describe("글자 크기·라운드는 토큰으로만 쓴다", () => {
  const src = readFileSync(join(process.cwd(), FILE), "utf8");

  it("파일을 읽었다", () => {
    expect(src.length).toBeGreaterThan(1000);
  });

  /**
   * :root 안의 토큰 정의는 당연히 생값이다. 첫 블록만 건너뛴다 —
   * 다크 테마 블록에는 크기 토큰이 없다.
   */
  const rootEnd = src.search(TOKEN_BLOCK_END);
  const body = src.slice(rootEnd);
  // 주석에 규칙을 설명하는 문장이 있으므로 코드만 검사한다
  const code = body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  const offenders: string[] = [];
  for (const prop of ["font-size", "border-radius"] as const) {
    const re = new RegExp(`${prop}:\\s*([^;]+);`, "g");
    for (const m of code.matchAll(re)) {
      const value = m[1].trim();
      if (value.startsWith("var(--")) continue;
      if (ALLOWED.has(value)) continue;
      offenders.push(`${prop}: ${value}`);
    }
  }

  it("토큰 아닌 생값이 없다", () => {
    expect(offenders).toEqual([]);
  });

  it("쓰이는 크기 토큰이 :root 에 정의되어 있다", () => {
    const defined = new Set(
      [...src.matchAll(/^\s*(--fs-[a-z]+|--radius(?:-[a-z]+)?):/gm)].map(
        (m) => m[1],
      ),
    );
    const used = new Set(
      [...code.matchAll(/var\((--fs-[a-z]+|--radius(?:-[a-z]+)?)\)/g)].map(
        (m) => m[1],
      ),
    );
    const missing = [...used].filter((u) => !defined.has(u));
    // 없는 토큰을 쓰면 CSS 는 조용히 무시한다. 오타가 화면에서 안 보인다
    expect(missing).toEqual([]);
  });
});
