import { AppSidebar } from "@/components/AppSidebar";
import { TriggerDetails } from "@/components/TriggersOverview";
import { SidebarProvider } from "@/components/ui/sidebar";
import { requireSession } from "@/lib/auth";

export default async function TriggerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession();
  const { id } = await params;

  return (
    <SidebarProvider>
      <AppSidebar active="Triggers" user={user} />
      <main className="min-h-svh flex-1 bg-[#f7f7f5] p-6 md:p-10">
        <TriggerDetails taskId={id} />
      </main>
    </SidebarProvider>
  );
}
