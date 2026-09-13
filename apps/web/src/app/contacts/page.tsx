import { headers } from "next/headers";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ContactsTable, type Contact } from "@/components/ContactsTable";
import { serverApiUrl } from "@/lib/api";
import { requireSession } from "@/lib/auth";

export default async function ContactsPage() {
  const user = await requireSession();
  const response = await fetch(`${serverApiUrl()}/contacts`, {
    cache: "no-store",
    headers: { Cookie: (await headers()).get("cookie") ?? "" },
  });
  if (!response.ok) throw new Error(`Contacts API failed with ${response.status}`);
  const { contacts } = (await response.json()) as { contacts: Contact[] };

  return (
    <SidebarProvider>
      <AppSidebar active="Contacts" user={user} />
      <main className="min-h-svh flex-1 p-6 md:p-10">
        <div className="mx-auto max-w-7xl">
          <ContactsTable initialContacts={contacts} />
        </div>
      </main>
    </SidebarProvider>
  );
}
