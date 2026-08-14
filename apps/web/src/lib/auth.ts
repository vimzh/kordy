import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function requireSession() {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007"}/auth/me`,
    {
      headers: { cookie: (await headers()).get("cookie") ?? "" },
      cache: "no-store",
    },
  );

  if (!response.ok) throw new Error("Could not verify the current session");

  const { user } = (await response.json()) as {
    user: { name?: string; email?: string } | null;
  };

  if (!user) redirect("/login");

  return user;
}
