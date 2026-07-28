import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 인코딩 손상을 잡는다.
 *
 * 이 파일이 있는 이유: 셸로 파일 내용을 고치지 말라는 규칙을 다섯 번 어겼다.
 * 마지막에는 PowerShell 의 -replace + Set-Content 로 app/globals.css 의 한글
 * 주석을 전부 깨뜨렸다. git checkout 으로 되돌렸지만, 커밋했으면 그대로 남았다.
 *
 * 약속으로는 못 막는다는 게 다섯 번으로 증명됐다. 그래서 "하지 않겠다"가 아니라
 * "하면 즉시 드러난다"로 바꾼다. npm run verify 한 번에 걸린다.
 *
 * 막지는 못하고 잡기만 한다. 막는 쪽은 .claude/settings.json 의 deny 규칙이다.
 */

const SKIP = new Set(["node_modules", ".next", ".git", "backups", "tmp-shots"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css|md|json|sql|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

const files = walk(".").map((path) => ({
  path: path.replace(/\\/g, "/").replace(/^\.\//, ""),
  text: readFileSync(path, "utf8"),
}));

describe("인코딩", () => {
  it("파일에 대체 문자(U+FFFD)가 없다", () => {
    /*
     * UTF-8 로 읽을 수 없는 바이트는 U+FFFD 로 바뀐다. 셸이 파일을 다른
     * 인코딩으로 다시 쓰면 여기 걸린다.
     */
    // 대체 문자를 리터럴로 쓰면 이 파일 자신이 걸린다. 코드 포인트로 만든다.
    const FFFD = String.fromCharCode(0xfffd);
    const bad = files
      .filter((f) => f.text.includes(FFFD))
      .map(
        (f) =>
          `${f.path}:${f.text.split("\n").findIndex((l) => l.includes(FFFD)) + 1}`,
      );
    expect(bad, "셸로 파일을 쓰다 인코딩이 깨졌다. git checkout 으로 되돌리고 Write/Edit 로 다시 하세요").toEqual([]);
  });

  it("한글 주석이 사라지지 않았다", () => {
    /*
     * 인코딩이 깨지면 한글이 통째로 날아가는 경우도 있다. 이 프로젝트는
     * 주석을 한글로 쓰므로, 주요 파일에 한글이 남아 있는지 본다.
     */
    const hangul = /[가-힣]/;
    const mustHaveKorean = [
      "app/globals.css",
      "db/schema.ts",
      "lib/attendance/settle.ts",
      "lib/attendance/sessions.ts",
      "lib/clock.ts",
      "README.md",
      "CLAUDE.md",
    ];
    const missing = mustHaveKorean.filter((p) => {
      const f = files.find((x) => x.path === p);
      return !f || !hangul.test(f.text);
    });
    expect(missing, "한글이 사라졌다 — 인코딩 사고를 의심하세요").toEqual([]);
  });

  it("줄 끝이 섞이지 않았다", () => {
    /*
     * 셸 리다이렉션은 CRLF 를 섞어 넣는다. 한 파일 안에서 CRLF 와 LF 가
     * 섞이면 diff 가 통째로 바뀌어서 무엇을 고쳤는지 보이지 않는다.
     */
    const bad: string[] = [];
    for (const { path, text } of files) {
      if (path.endsWith(".md")) continue; // 문서는 편집기가 섞어도 무해하다
      const crlf = (text.match(/\r\n/g) ?? []).length;
      const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
      if (crlf > 0 && lf > 0) bad.push(`${path} (CRLF ${crlf} · LF ${lf})`);
    }
    expect(bad, "한 파일에 CRLF 와 LF 가 섞였다").toEqual([]);
  });
});
