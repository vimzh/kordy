import { redirect } from "next/navigation";
import { DemoLoginForm } from "@/components/DemoLoginForm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { getSession } from "@/lib/auth";

export default async function LoginPage() {
  if (await getSession()) {
    redirect("/home");
  }

  return (
    <main className="min-h-svh bg-secondary/60">
      <Dialog open>
        <DialogContent
          className="max-w-sm p-0"
          showCloseButton={false}
        >
          <DemoLoginForm />
        </DialogContent>
      </Dialog>
    </main>
  );
}
