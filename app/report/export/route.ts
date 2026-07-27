import { DateTime } from "luxon";
import { loadOrgRules, AccessDenied } from "@/db/access";
import { exportCsv } from "@/db/report";
import { resolvePeriod } from "@/lib/attendance/period";
import { now } from "@/lib/clock";
import { requestViewer } from "../../viewer";

export async function GET(request: Request) {
  const viewer = await requestViewer();
  const rules = await loadOrgRules(viewer.orgId);
  const zone = rules.attendance.timezone;

  const asOf = now();
  const anchor =
    new URL(request.url).searchParams.get("period") ??
    DateTime.fromJSDate(asOf, { zone }).toISODate()!;
  const range = resolvePeriod(anchor, {
    kind: rules.settlementKind,
    weekStartDay: rules.weekStartDay,
    timezone: zone,
  });

  try {
    const csv = await exportCsv(viewer, range, rules, asOf);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attendance-${range.start}_${range.end}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AccessDenied) {
      return new Response(e.message, { status: 403 });
    }
    throw e;
  }
}
