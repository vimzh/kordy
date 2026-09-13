"use client";

// Signs visitors into the shared demo account and displays its public credentials.
import Image from "next/image";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DemoLoginForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007"}/auth/login`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      },
    ).catch(() => null);

    if (!response?.ok) {
      setIsSubmitting(false);
      setError(response?.status === 401 ? "Those credentials do not match the demo account." : "Could not sign in. Check that the API is running.");
      return;
    }

    window.location.replace("/home");
  }

  return (
    <>
      <DialogHeader className="border-b border-border p-6 pr-12">
        <div className="flex items-center gap-3">
          <Image src="/kyub-logo.png" alt="" width={36} height={36} className="rounded-lg" />
          <div>
            <DialogTitle className="text-xl tracking-[-0.04em]">Try Kordy</DialogTitle>
            <DialogDescription className="mt-1">Sign in to the shared demo workspace.</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <form onSubmit={signIn} className="space-y-5 p-6 pt-1">
        <div className="rounded-lg border border-primary/20 bg-secondary p-3">
          <p className="mb-2 text-xs font-semibold tracking-wide text-primary uppercase">Demo access</p>
          <dl className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1 font-mono text-xs">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="select-all">demo@gmail.com</dd>
            <dt className="text-muted-foreground">Password</dt>
            <dd className="select-all">demo1234</dd>
          </dl>
        </div>

        <div className="space-y-2">
          <Label htmlFor="demo-email">Email</Label>
          <Input id="demo-email" name="email" type="email" autoComplete="email" defaultValue="demo@gmail.com" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="demo-password">Password</Label>
          <Input id="demo-password" name="password" type="password" autoComplete="current-password" defaultValue="demo1234" required />
        </div>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Enter demo"}
        </Button>
      </form>
    </>
  );
}
