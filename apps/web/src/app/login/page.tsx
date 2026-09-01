import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth";

export default async function LoginPage({
}: PageProps<"/login">) {
  if (await getSession()) {
    redirect("/home");
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Kordy</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <a href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007"}/auth/google`}>
              Continue with Google
            </a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
