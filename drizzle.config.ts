import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // 마이그레이션 파일을 사람이 읽고 검토할 수 있게 남긴다.
  // 근태는 감사 대상이라 스키마 변경 이력이 필요하다.
  verbose: true,
  strict: true,
});
