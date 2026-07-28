import "dotenv/config";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { DateTime } from "luxon";
import { now } from "@/lib/clock";

/**
 * DB 덤프.
 *
 * 컨테이너 안의 pg_dump 를 쓴다 — 호스트에 Postgres 클라이언트가 깔려 있지
 * 않아도 되고, 서버 버전과 도구 버전이 어긋날 일도 없다.
 *
 * 복원:
 *   docker exec -i flex-attendance-db psql -U flex -d flex_attendance < backups/<파일>
 */

const CONTAINER = process.env.PGCONTAINER ?? "flex-attendance-db";
const USER = "flex";
const DB = "flex_attendance";

mkdirSync("backups", { recursive: true });
// 시계는 lib/clock.ts 하나만 쓴다 (lib/clock.guard.test.ts 가 검사한다)
const stamp = DateTime.fromJSDate(now()).toFormat("yyyyMMdd-HHmmss");
const out = `backups/flex-attendance-${stamp}.sql`;

const r = spawnSync(
  "docker",
  ["exec", CONTAINER, "pg_dump", "-U", USER, "-d", DB, "--clean", "--if-exists"],
  { encoding: "buffer", maxBuffer: 512 * 1024 * 1024 },
);

if (r.status !== 0) {
  console.error(r.stderr?.toString() ?? "pg_dump 실패");
  console.error(
    `\n컨테이너 이름이 다르면 PGCONTAINER 로 지정하세요 (현재: ${CONTAINER})`,
  );
  process.exit(1);
}

const { writeFileSync } = await import("node:fs");
writeFileSync(out, r.stdout);
const kb = Math.round(r.stdout.length / 1024);
console.log(`${out} (${kb}KB)`);
console.log(
  `복원: docker exec -i ${CONTAINER} psql -U ${USER} -d ${DB} < ${out}`,
);
