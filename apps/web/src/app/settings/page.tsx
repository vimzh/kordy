import { AccountSettings } from "@/components/AccountSettings";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { requireSession } from "@/lib/auth";

export default async function SettingsPage() {
  const user = await requireSession();
  return (
    <SidebarProvider>
      <AppSidebar active="Settings" user={user} />
      <main className="min-h-svh flex-1 p-6 md:p-10"><div className="mx-auto max-w-7xl"><AccountSettings /></div></main>
    </SidebarProvider>
  );
}
