import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { serverApiUrl } from "@/lib/api";

export async function getSession() {
  const response = await fetch(
    `${serverApiUrl()}/auth/me`,
    {
      headers: { cookie: (await headers()).get("cookie") ?? "" },
      cache: "no-store",
    },
  );

  if (!response.ok) throw new Error("Could not verify the current session");

  const { user } = (await response.json()) as {
    user: { name?: string; email?: string } | null;
  };

  return user;
}

export async function requireSession() {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}
