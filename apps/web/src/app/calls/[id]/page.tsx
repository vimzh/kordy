import { headers } from "next/headers";
import { AppSidebar } from "@/components/AppSidebar";
import { CallDetails } from "@/components/calls/CallDetails";
import type { CallRecord } from "@/components/calls/types";
import { SidebarProvider } from "@/components/ui/sidebar";
import { requireSession } from "@/lib/auth";

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  const { id } = await params;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";
  const response = await fetch(`${apiUrl}/calls/${encodeURIComponent(id)}`, { cache: "no-store", headers: { Cookie: (await headers()).get("cookie") ?? "" } });
  if (!response.ok) throw new Error(`Call API failed with ${response.status}`);
  const { call } = await response.json() as { call: CallRecord };
  return (
    <SidebarProvider>
      <AppSidebar active="Calls" user={user} />
      <main className="min-h-svh flex-1 bg-[#f7f7f5] p-6 md:p-10"><CallDetails callId={id} initialCall={call} /></main>
    </SidebarProvider>
  );
}
