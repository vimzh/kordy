"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Provider = "github" | "stripe" | "n8n";
type CreatedConnection = { id: string; provider: Provider; label: string; status: "connected"; webhookUrl: string; secret?: string };

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";

export function WebhookConnectionDialog({ provider, onClose, onCreated }: { provider: Provider | null; onClose: () => void; onCreated: (connection: CreatedConnection) => void }) {
  const [secret, setSecret] = useState("");
  const [created, setCreated] = useState<CreatedConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = provider === "github" ? "GitHub" : provider === "stripe" ? "Stripe" : "n8n";

  function close() {
    setSecret("");
    setCreated(null);
    setError("");
    onClose();
  }

  async function connect() {
    if (!provider) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/connections/integrations`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, ...(secret ? { secret } : {}) }),
      });
      const result = await response.json().catch(() => null) as { connection?: CreatedConnection; error?: string } | null;
      if (!response.ok || !result?.connection) throw new Error(result?.error ?? `Could not connect ${name}`);
      setCreated(result.connection);
      onCreated(result.connection);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not connect ${name}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={provider !== null} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {name}</DialogTitle>
          <DialogDescription>
            {provider === "stripe" ? "Paste the endpoint signing secret Stripe provides." : `Kordy will generate a secret for your ${name} webhook.`}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className="space-y-3">
            <div><Label>Webhook URL</Label><Input className="mt-1 font-mono text-xs" readOnly value={created.webhookUrl} /></div>
            {created.secret ? <div><Label>Secret (shown once)</Label><Input className="mt-1 font-mono text-xs" readOnly value={created.secret} /></div> : null}
            <p className="text-xs text-muted-foreground">Add these values to the provider, then create a flow using this source.</p>
          </div>
        ) : provider === "stripe" ? (
          <div><Label htmlFor="stripe-secret">Endpoint secret</Label><Input id="stripe-secret" className="mt-1" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="whsec_…" /></div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          {created ? <Button type="button" onClick={close}>Done</Button> : <Button type="button" disabled={busy || (provider === "stripe" && !secret)} onClick={() => void connect()}>{busy ? "Connecting…" : "Create webhook"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
