"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Circle, PhoneCall, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type OnboardingData = {
  profile: {
    defaultPhone: string | null;
    callRegion: string | null;
    callLocale: string | null;
    outboundCallConsentAt: string | null;
    phoneVerifiedAt: string | null;
    readyForAutomaticCalls: boolean;
  };
  steps: {
    phone: boolean;
    consent: boolean;
    verified: boolean;
    connection: boolean;
    trigger: boolean;
  };
  usage: {
    callsUsed: number;
    callsLimit: number;
    tasksCreatedLastHour: number;
    taskHourlyLimit: number;
    activeTasks: number;
    taskActiveLimit: number;
  };
  reconnectNeeded: unknown[];
  latestVerificationCall: {
    id: string;
    status: string;
    failureMessage?: string | null;
    createdAt: string;
  } | null;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";
const dismissedKey = "kyub:onboarding-dismissed";
const pendingCallStatuses = new Set(["queued", "dispatching", "calling", "in_progress", "initiated", "ringing"]);

export function OnboardingChecklist() {
  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null);
  const [dismissed, setDismissed] = useState(() => typeof window !== "undefined" && sessionStorage.getItem(dismissedKey) === "true");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"consent" | "verification" | null>(null);
  const [pollVerification, setPollVerification] = useState(false);
  const [message, setMessage] = useState("");

  const loadOnboarding = useCallback(async () => {
    const response = await fetch(`${apiUrl}/onboarding`, { credentials: "include" });
    const result = await response.json().catch(() => null) as OnboardingData | { error?: string } | null;
    if (!response.ok || !result || !("steps" in result)) {
      throw new Error(result && "error" in result ? result.error : "Could not load account setup");
    }
    setOnboarding(result);
    window.dispatchEvent(new Event("kyub:onboarding-updated"));
    return result;
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void loadOnboarding()
        .then((result) => {
          if (result.latestVerificationCall && pendingCallStatuses.has(result.latestVerificationCall.status)) {
            setPollVerification(true);
          }
        })
        .catch((caught) => setMessage(caught instanceof Error ? caught.message : "Could not load account setup"))
        .finally(() => setLoading(false));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loadOnboarding]);

  useEffect(() => {
    if (!pollVerification) return;
    const interval = window.setInterval(() => {
      void loadOnboarding()
        .then((result) => {
          const status = result.latestVerificationCall?.status;
          if (result.steps.verified || (status && !pendingCallStatuses.has(status))) setPollVerification(false);
        })
        .catch(() => setPollVerification(false));
    }, 3_000);
    return () => window.clearInterval(interval);
  }, [loadOnboarding, pollVerification]);

  async function acceptConsent() {
    setSaving("consent");
    setMessage("");
    try {
      const response = await fetch(`${apiUrl}/onboarding/consent`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Could not save call consent");
      await loadOnboarding();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not save call consent");
    } finally {
      setSaving(null);
    }
  }

  async function startVerification() {
    setSaving("verification");
    setMessage("");
    try {
      const response = await fetch(`${apiUrl}/onboarding/test-call`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledgeCost: true }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Could not start the verification call");
      setMessage("Verification call started. Answer it to confirm this number.");
      setPollVerification(true);
      await loadOnboarding();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not start the verification call");
    } finally {
      setSaving(null);
    }
  }

  function dismiss() {
    sessionStorage.setItem(dismissedKey, "true");
    setDismissed(true);
  }

  if (dismissed || loading) return null;
  if (!onboarding) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm">
        <span>{message || "Could not load account setup."}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadOnboarding().catch((caught) => setMessage(caught instanceof Error ? caught.message : "Could not load account setup"))}>
          Retry
        </Button>
      </div>
    );
  }

  const completed = Object.values(onboarding.steps).filter(Boolean).length;
  const verificationPending = pollVerification || Boolean(
    onboarding.latestVerificationCall && pendingCallStatuses.has(onboarding.latestVerificationCall.status),
  );
  const steps = [
    {
      key: "phone",
      title: "Set your call number",
      description: onboarding.profile.defaultPhone ?? "Choose the number, region, and language Kordy should use.",
      action: <Button asChild variant="outline" size="sm"><Link href="/settings#call-delivery">Open settings</Link></Button>,
    },
    {
      key: "consent",
      title: "Allow outbound calls",
      description: "Allow Kordy to place verification, trigger, and other calls you request from this account.",
      action: onboarding.steps.consent ? null : (
        <Button type="button" variant="outline" size="sm" disabled={saving === "consent"} onClick={() => void acceptConsent()}>
          {saving === "consent" ? "Saving…" : "I consent"}
        </Button>
      ),
    },
    {
      key: "verified",
      title: "Verify your number",
      description: verificationPending
        ? "A verification call is in progress."
        : onboarding.latestVerificationCall?.failureMessage ?? "Place one controlled test call before enabling automatic calls.",
      action: onboarding.steps.verified ? null : onboarding.steps.phone && onboarding.steps.consent ? (
        <Dialog>
          <DialogTrigger asChild>
            <Button type="button" variant="outline" size="sm">Verify number</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Place a verification call?</DialogTitle>
              <DialogDescription>
                Kordy will call {onboarding.profile.defaultPhone}. This uses one call from your rolling allowance and may incur provider charges.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <DialogClose asChild>
                <Button type="button" disabled={saving === "verification"} onClick={() => void startVerification()}>
                  <PhoneCall aria-hidden="true" />
                  {saving === "verification" ? "Starting…" : "Place verification call"}
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : <span className="text-xs text-muted-foreground">Save a number and consent first.</span>,
    },
    {
      key: "connection",
      title: "Connect an event source",
      description: "Connect the account Kordy should watch for events.",
      action: <Button asChild variant="outline" size="sm"><Link href="/connections">Open connections</Link></Button>,
    },
    {
      key: "trigger",
      title: "Create your first trigger",
      description: "Describe one event and decide whether its call needs approval.",
      action: (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => document.getElementById("new-trigger")?.focus()}
        >
          Create trigger
        </Button>
      ),
    },
  ] as const;

  return (
    <Card size="sm" className="gap-3" aria-labelledby="onboarding-title">
      <CardHeader className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <CardTitle id="onboarding-title" className="text-base font-medium">Finish setup</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{completed} of 5 complete. Automatic calls stay off until your number is verified.</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Dismiss setup checklist" onClick={dismiss}>
          <X aria-hidden="true" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="divide-y divide-border">
          {steps.map((step) => {
            const complete = onboarding.steps[step.key];
            return (
              <li key={step.key} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {complete ? (
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3.5" aria-hidden="true" />
                      <span className="sr-only">Complete</span>
                    </span>
                  ) : <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{step.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
                  </div>
                </div>
                {!complete && step.action ? <div className="shrink-0 pl-8 sm:pl-0">{step.action}</div> : null}
              </li>
            );
          })}
        </ol>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
          <span><strong className="font-medium tabular-nums text-foreground">{onboarding.usage.callsUsed}/{onboarding.usage.callsLimit}</strong> calls in 24 hours</span>
          <span><strong className="font-medium tabular-nums text-foreground">{onboarding.usage.tasksCreatedLastHour}/{onboarding.usage.taskHourlyLimit}</strong> triggers this hour</span>
          <span><strong className="font-medium tabular-nums text-foreground">{onboarding.usage.activeTasks}/{onboarding.usage.taskActiveLimit}</strong> active triggers</span>
          {message ? <span role="status" aria-live="polite" className="basis-full text-foreground">{message}</span> : null}
          {completed === 5 ? (
            <span className="ml-auto inline-flex items-center gap-1 text-foreground">Setup complete <ArrowRight className="size-3.5" aria-hidden="true" /></span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
