import { headers } from "next/headers";
import { AppSidebar } from "@/components/AppSidebar";
import type { Contact } from "@/components/ContactsTable";
import { TriggersOverview } from "@/components/TriggersOverview";
import { SidebarProvider } from "@/components/ui/sidebar";
import { requireSession } from "@/lib/auth";

export default async function TriggersPage() {
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
      <AppSidebar active="Triggers" user={user} />
      <main className="min-h-svh flex-1 bg-[#f7f7f5] p-6 md:p-10">
        <TriggersOverview contacts={contacts} />
      </main>
    </SidebarProvider>
  );
}
