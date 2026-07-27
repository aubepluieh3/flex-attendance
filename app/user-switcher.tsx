import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { listUsers } from "@/db/access";
import { requestViewer } from "./viewer";
import { DEMO_USER_COOKIE } from "./viewer";

const ROLE_LABEL = {
  member: "사원",
  manager: "팀장",
  hr: "HR",
  executive: "임원",
} as const;

/**
 * 데모 계정 선택. 인증 대신 쓰는 임시 장치이므로 화면 맨 위에 눈에 띄게 둔다 —
 * 로그인처럼 보이면 안 된다.
 */
export async function UserSwitcher() {
  let users: Awaited<ReturnType<typeof listUsers>>;
  let currentId: string;
  try {
    users = await listUsers();
    currentId = (await requestViewer()).id;
  } catch {
    // 시드 전에는 조용히 숨긴다
    return null;
  }
  if (users.length === 0) return null;

  async function pick(form: FormData) {
    "use server";
    const employeeNo = String(form.get("employeeNo") ?? "");
    const jar = await cookies();
    jar.set(DEMO_USER_COOKIE, employeeNo, { path: "/" });
    revalidatePath("/", "layout");
  }

  return (
    <div className="switcher">
      <span className="switcher-label">데모 계정</span>
      {users.map((u) => (
        <form action={pick} key={u.id}>
          <input type="hidden" name="employeeNo" value={u.employeeNo} />
          <button
            type="submit"
            className={u.id === currentId ? "pill on" : "pill"}
          >
            {u.name} · {ROLE_LABEL[u.role]}
          </button>
        </form>
      ))}
    </div>
  );
}
