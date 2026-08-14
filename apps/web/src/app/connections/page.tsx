import { AppSidebar } from "@/components/AppSidebar";
import { ConnectionsCatalog } from "@/components/ConnectionsCatalog";
import { SidebarProvider } from "@/components/ui/sidebar";
import { requireSession } from "@/lib/auth";

export default async function ConnectionsPage() {
  const user = await requireSession();

  return (
    <SidebarProvider>
      <AppSidebar active="Connections" user={user} />
      <main className="min-h-svh flex-1 p-6 md:p-10">
        <div className="mx-auto max-w-7xl">
          <ConnectionsCatalog />
        </div>
      </main>
    </SidebarProvider>
  );
}
