import { headers } from "next/headers";
import { AppSidebar } from "@/components/AppSidebar";
import { CallsDashboard } from "@/components/calls/CallsDashboard";
import type { CallMetrics, CallRecord } from "@/components/calls/types";
import { SidebarProvider } from "@/components/ui/sidebar";
import { requireSession } from "@/lib/auth";

export default async function CallsPage() {
  const user = await requireSession();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";
  const cookie = (await headers()).get("cookie") ?? "";
  const [callsResponse, metricsResponse] = await Promise.all([
    fetch(`${apiUrl}/calls?limit=25`, { cache: "no-store", headers: { Cookie: cookie } }),
    fetch(`${apiUrl}/calls/metrics`, { cache: "no-store", headers: { Cookie: cookie } }),
  ]);
  if (!callsResponse.ok) throw new Error(`Calls API failed with ${callsResponse.status}`);
  if (!metricsResponse.ok) throw new Error(`Call metrics API failed with ${metricsResponse.status}`);
  const callsBody = await callsResponse.json() as { calls?: CallRecord[]; items?: CallRecord[]; nextCursor?: string | null };
  const metricsBody = await metricsResponse.json() as { metrics: Omit<CallMetrics, "budgetUsed" | "budgetLimit">; budget: { used: number; limit: number } };
  const metrics: CallMetrics = { ...metricsBody.metrics, budgetUsed: metricsBody.budget.used, budgetLimit: metricsBody.budget.limit };
  return (
    <SidebarProvider>
      <AppSidebar active="Calls" user={user} />
      <main className="min-h-svh flex-1 bg-[#f7f7f5] p-6 md:p-10"><CallsDashboard initialCalls={callsBody.calls ?? callsBody.items ?? []} initialMetrics={metrics} initialNextCursor={callsBody.nextCursor ?? null} /></main>
    </SidebarProvider>
  );
}
