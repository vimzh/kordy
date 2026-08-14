import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { requireSession } from "@/lib/auth";

export default async function TriggerDetailPage() {
  const user = await requireSession();

  return (
    <SidebarProvider>
      <AppSidebar active="Triggers" user={user} />
      <main className="min-h-svh flex-1 bg-[#f7f7f5]" />
    </SidebarProvider>
  );
}
