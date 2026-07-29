"use server";

import { revalidatePath } from "next/cache";
import {
  addPerson,
  addTeam,
  resetPassword,
  setActive,
  setEmployment,
  setRole,
  setTeam,
} from "@/db/people";
import type { Role } from "@/db/access";
import { requestViewer } from "../viewer";
import { reportActionError, str } from "../action-error";

/**
 * 사용자 관리 액션을 하나로 모은다.
 *
 * 화면에 폼이 여러 개인데 결과(특히 임시 비밀번호)는 한 곳에서만 보여줘야
 * 하므로, op 로 분기하는 단일 액션을 쓴다.
 *
 * 임시 비밀번호는 어디에도 평문으로 저장하지 않는다. 이 응답을 놓치면 다시
 * 초기화해야 한다 — 화면에 그렇게 적어둔다.
 */
export type PeopleState = {
  message?: string;
  error?: string;
  secret?: { name: string; employeeNo: string; password: string };
};

const asRole = (v: string): Role =>
  v === "manager" || v === "hr" || v === "executive" ? v : "member";

export async function peopleAction(
  _prev: PeopleState,
  form: FormData,
): Promise<PeopleState> {
  let result: PeopleState;
  try {
    const viewer = await requestViewer();
    const op = str(form, "op");
    const userId = str(form, "userId");

    switch (op) {
      case "add": {
        const name = str(form, "name");
        const employeeNo = str(form, "employeeNo");
        const { tempPassword } = await addPerson(viewer, {
          name,
          employeeNo,
          email: str(form, "email"),
          role: asRole(str(form, "role")),
          teamId: str(form, "teamId") || null,
        });
        result = {
          message: `${name} 님을 추가했습니다.`,
          secret: { name, employeeNo, password: tempPassword },
        };
        break;
      }
      case "reset": {
        const { tempPassword } = await resetPassword(viewer, userId);
        result = {
          message:
            "비밀번호를 초기화했습니다. 그 사람의 기존 로그인은 모두 끊겼습니다.",
          secret: {
            name: str(form, "name"),
            employeeNo: str(form, "employeeNo"),
            password: tempPassword,
          },
        };
        break;
      }
      case "role":
        await setRole(viewer, userId, asRole(str(form, "role")));
        result = { message: "역할을 변경했습니다." };
        break;
      case "team":
        await setTeam(viewer, userId, str(form, "teamId") || null);
        result = { message: "팀을 변경했습니다." };
        break;
      case "active": {
        const active = str(form, "active") === "1";
        await setActive(viewer, userId, active);
        result = {
          message: active
            ? "활성화했습니다."
            : "비활성화했습니다. 로그인 세션도 끊었습니다.",
        };
        break;
      }
      case "employment": {
        const { recordsOutside } = await setEmployment(viewer, userId, {
          hiredAt: str(form, "hiredAt") || null,
          resignedAt: str(form, "resignedAt") || null,
        });
        /*
         * 재직기간 밖 기록이 있으면 저장하면서 바로 말한다. 상시 알림을 늘리는
         * 대신 입력 시점에 잡는다 — 이 오류는 여기서 만들어진다.
         */
        result = {
          message:
            recordsOutside > 0
              ? `재직기간을 저장했습니다. 다만 이 구간 밖에 근태 기록이 ${recordsOutside}건 있습니다 — 집계에서 빠집니다. 입사일이 맞는지 확인해 주세요.`
              : "재직기간을 저장했습니다. 소정근로와 주 평균이 이 구간으로 다시 계산됩니다.",
        };
        break;
      }
      case "addTeam":
        await addTeam(viewer, str(form, "name"), str(form, "parentId") || null);
        result = { message: "팀을 추가했습니다." };
        break;
      default:
        result = { error: `알 수 없는 요청입니다: ${op}` };
    }
  } catch (e) {
    await reportActionError("peopleAction", e);
    return { error: (e as Error).message };
  }

  revalidatePath("/people");
  revalidatePath("/team");
  revalidatePath("/report");
  return result;
}
