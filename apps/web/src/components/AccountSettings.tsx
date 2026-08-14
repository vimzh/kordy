"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Profile = { defaultPhone: string };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";
const e164Pattern = /^\+[1-9]\d{7,14}$/;

// Account-level preferences, kept separate from external-service connections.
export function AccountSettings() {
  const [defaultPhone, setDefaultPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(`${apiUrl}/profile`, { credentials: "include" })
      .then(async (response) => {
        const result = await response.json().catch(() => null) as { profile?: Profile; error?: string } | null;
        if (!response.ok || !result?.profile) throw new Error(result?.error ?? "Could not load settings");
        if (active) setDefaultPhone(result.profile.defaultPhone ?? "");
      })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Could not load settings"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function saveDefaultPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const phone = defaultPhone.trim();
    setMessage("");
    if (!e164Pattern.test(phone)) return setMessage("Use E.164 format, for example +919876543210.");
    setSaving(true);
    try {
      const response = await fetch(`${apiUrl}/profile`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultPhone: phone }),
      });
      const result = await response.json().catch(() => null) as { profile?: Profile; error?: string } | null;
      if (!response.ok || !result?.profile) throw new Error(result?.error ?? "Could not save your call number");
      setDefaultPhone(result.profile.defaultPhone);
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save your call number");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-heading">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your Kordy account preferences.</p>
      </div>
      <Card size="sm" className="max-w-xl gap-3">
        <CardHeader className="gap-1">
          <div className="flex items-center gap-2"><Phone className="size-4" /><CardTitle className="text-sm font-medium">Default call number</CardTitle></div>
          <p className="text-sm text-muted-foreground">The number Kordy calls when a trigger says “call me”.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveDefaultPhone} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="default-phone">Phone number</Label>
              <Input id="default-phone" type="tel" inputMode="tel" autoComplete="tel" value={defaultPhone} onChange={(event) => setDefaultPhone(event.target.value)} placeholder="+919876543210" pattern="\+[1-9][0-9]{7,14}" required />
            </div>
            <Button type="submit" disabled={loading || saving}>{saving ? "Saving…" : "Save"}</Button>
          </form>
          {message ? <p role="status" className={`mt-2 text-sm ${message === "Saved." ? "text-muted-foreground" : "text-destructive"}`}>{message}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
