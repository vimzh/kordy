import { headers } from "next/headers";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ContactsTable, type Contact } from "@/components/ContactsTable";
import { requireSession } from "@/lib/auth";

export default async function ContactsPage() {
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
      <AppSidebar active="Contacts" user={user} />
      <main className="min-h-svh flex-1 p-6 md:p-10">
        <div className="mx-auto max-w-7xl">
          <ContactsTable initialContacts={contacts} />
        </div>
      </main>
    </SidebarProvider>
  );
}
