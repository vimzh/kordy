"use client";

// Lets signed-in users place one explicit CALL-E demo call from Home.
import { useState } from "react";
import { CloudRain, MailWarning, PhoneCall, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";
const scenarios = [
  {
    id: "weather",
    label: "Severe weather",
    detail: "A heavy storm is approaching Bengaluru.",
    icon: CloudRain,
    source: "weather",
    task: "This is a Kordy demo call. Tell the recipient that heavy rain and thunderstorms are expected in Bengaluru within 30 minutes, then ask them to acknowledge the alert.",
  },
  {
    id: "deployment",
    label: "Failed deployment",
    detail: "The production checkout deployment failed.",
    icon: Rocket,
    source: "vercel",
    task: "This is a Kordy demo call. Tell the recipient that the production checkout deployment failed and needs attention, then ask them to acknowledge the incident.",
  },
  {
    id: "email",
    label: "Urgent email",
    detail: "A priority customer needs a response.",
    icon: MailWarning,
    source: "gmail",
    task: "This is a Kordy demo call. Tell the recipient that an urgent email arrived from a priority customer asking for a response today, then ask them to acknowledge it.",
  },
] as const;

export function InvokeCallDialog() {
  const [selectedId, setSelectedId] = useState<(typeof scenarios)[number]["id"]>("weather");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [callId, setCallId] = useState("");
  const [needsVerification, setNeedsVerification] = useState(false);

  async function invokeCall() {
    const scenario = scenarios.find(({ id }) => id === selectedId)!;
    setSubmitting(true);
    setError("");
    const onboardingResponse = await fetch(`${apiUrl}/onboarding`, { credentials: "include" }).catch(() => null);
    const onboarding = await onboardingResponse?.json().catch(() => null) as { profile?: { defaultPhone?: string | null; phoneVerifiedAt?: string | null }; error?: string } | null;

    if (!onboardingResponse?.ok || !onboarding?.profile?.defaultPhone) {
      setSubmitting(false);
      setError(onboarding?.error ?? "Save your phone number in Settings before invoking a call.");
      return;
    }

    if (!onboarding.profile.phoneVerifiedAt) {
      setSubmitting(false);
      setNeedsVerification(true);
      return;
    }

    const response = await fetch(`${apiUrl}/calls`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: scenario.task,
        phone: onboarding.profile.defaultPhone,
        eventId: `home-demo:${scenario.id}:${crypto.randomUUID()}`,
        source: scenario.source,
      }),
    }).catch(() => null);
    const result = await response?.json().catch(() => null) as { call?: { id?: string }; error?: string } | null;
    setSubmitting(false);

    if (!response?.ok || !result?.call?.id) {
      setError(result?.error ?? "Could not start the demo call. Check the API and CALL-E configuration.");
      return;
    }

    setCallId(result.call.id);
  }

  async function verifyNumber() {
    setSubmitting(true);
    setError("");
    const response = await fetch(`${apiUrl}/onboarding/test-call`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledgeCost: true }),
    }).catch(() => null);
    const result = await response?.json().catch(() => null) as { call?: { id?: string }; error?: string } | null;
    setSubmitting(false);
    if (!response?.ok || !result?.call?.id) {
      setError(result?.error ?? "Could not start the verification call.");
      return;
    }
    setCallId(result.call.id);
  }

  return (
    <Dialog onOpenChange={(open) => {
      if (open) {
        setError("");
        setCallId("");
        setNeedsVerification(false);
      }
    }}>
      <DialogTrigger asChild>
        <Button type="button" size="lg">
          <PhoneCall aria-hidden="true" />
          Invoke call
        </Button>
      </DialogTrigger>

      <DialogContent className="z-[110] max-h-[calc(100svh-2rem)] max-w-md overflow-y-auto p-0 text-left" style={{ fontFamily: "var(--font-kordy)" }}>
        <DialogHeader className="border-b p-6 pr-12">
          <DialogTitle className="text-xl tracking-[-0.04em]">Choose a demo call</DialogTitle>
          <DialogDescription>
            Kordy will call your verified number with the scenario you choose.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 px-6">
          {scenarios.map((scenario) => {
            const Icon = scenario.icon;
            return (
              <label key={scenario.id} className="cursor-pointer">
                <input
                  className="peer sr-only"
                  type="radio"
                  name="demo-call-scenario"
                  value={scenario.id}
                  checked={selectedId === scenario.id}
                  onChange={() => setSelectedId(scenario.id)}
                />
                <span className="flex items-start gap-3 rounded-xl border bg-card p-4 transition-colors peer-checked:border-primary peer-checked:bg-secondary peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background text-primary ring-1 ring-border">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block font-medium text-foreground">{scenario.label}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">{scenario.detail}</span>
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        <DialogFooter className="mx-0 mb-0 mt-2">
          <div className="w-full space-y-3">
            <p className="text-xs text-muted-foreground">
              This places a real provider call, uses your call allowance, and may incur charges.
            </p>
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            {needsVerification ? <p className="text-sm text-foreground">Verify your saved number once before placing demo calls.</p> : null}
            {callId ? <p className="text-sm text-primary" role="status">{needsVerification ? "Verification call started. Answer and confirm you own the number." : "Call started."} <a className="underline" href={`/calls/${callId}`}>View call</a></p> : null}
            <Button type="button" className="w-full" disabled={submitting || Boolean(callId)} onClick={() => void (needsVerification ? verifyNumber() : invokeCall())}>
              <PhoneCall aria-hidden="true" />
              {submitting ? "Starting call…" : callId ? "Call started" : needsVerification ? "Verify number first" : "Invoke this call"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
