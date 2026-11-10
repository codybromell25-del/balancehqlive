import { redirect } from "next/navigation";
import { getAccess } from "@/lib/access";
import { todayInDublin } from "@/lib/instructors";
import { LEAD_LIST_COLUMNS, type LeadRow } from "@/lib/sales";
import { TopBar } from "../instructors/ui";
import { SalesBoard } from "./board";

export const dynamic = "force-dynamic";

// PostgREST returns at most 1,000 rows a request, and there are more leads
// than that, so they're read a page at a time.
const PAGE = 1000;

/**
 * Every lead near every studio, with where each conversation stands. The
 * list loads in one go so filtering and working down it is instant; a
 * lead's history loads when it is opened.
 */
export default async function SalesPage() {
  const { db, user, canSell } = await getAccess();
  if (!user) redirect("/login");
  if (!canSell) redirect("/");

  const leads: LeadRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("sales_leads")
      .select(LEAD_LIST_COLUMNS)
      .order("name")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`The sales dashboard didn't load: ${error.message}`);
    leads.push(...((data ?? []) as LeadRow[]));
    if (!data || data.length < PAGE) break;
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-12">
      <TopBar email={user.email ?? ""} back={{ href: "/", label: "balanceHQ" }} />
      <SalesBoard leads={leads} today={todayInDublin()} me={user.email ?? ""} />
    </main>
  );
}
