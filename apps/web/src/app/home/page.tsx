import { headers } from "next/headers";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import type { Contact } from "@/components/ContactsTable";
import { InvokeCallDialog } from "@/components/InvokeCallDialog";
import { TriggerLogs } from "@/components/TriggerLogs";
import { requireSession } from "@/lib/auth";

export default async function HomePage() {
  const user = await requireSession();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";
  const response = await fetch(`${apiUrl}/contacts`, {
    cache: "no-store",
    headers: { Cookie: (await headers()).get("cookie") ?? "" },
  });
  if (!response.ok) throw new Error(`Contacts API failed with ${response.status}`);
  const { contacts } = (await response.json()) as { contacts: Contact[] };

  return (
    <SidebarProvider>
      <AppSidebar active="Home" user={user} />
      <main className="min-h-svh flex-1 bg-[#f7f7f5] p-6 md:p-10">
        <div className="mx-auto max-w-7xl space-y-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Describe what should trigger a call, then press Enter.
              </p>
            </div>
            <InvokeCallDialog />
          </div>
          <TriggerLogs contacts={contacts} />
        </div>
      </main>
    </SidebarProvider>
  );
}
