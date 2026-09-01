// Enforces the per-user call budget before creating a billable CALL-E call.
import { createCalleCall } from "./calle";
import { getProfile, hasCallDispatchCapacity, reserveCallDispatch } from "./db";

export function dailyCallLimit() {
  const value = Number(process.env.CALLE_DAILY_CALL_LIMIT ?? "20");
  if (!Number.isInteger(value) || value < 1 || value > 1_000) throw new Error("CALLE_DAILY_CALL_LIMIT must be an integer from 1 to 1000");
  return value;
}

export class CallBudgetExceededError extends Error {}
export class OutboundCallConsentRequiredError extends Error {}
export class PhoneVerificationRequiredError extends Error {}

export function hasCalleCallCapacity(userId: string) {
  return hasCallDispatchCapacity(userId, dailyCallLimit());
}

export async function dispatchCalleCall(input: Parameters<typeof createCalleCall>[0]) {
  const profile = await getProfile(input.userId);
  const isDefaultNumber = profile?.defaultPhone === input.phone;
  if (!profile?.outboundCallConsentAt) throw new OutboundCallConsentRequiredError("Outbound call consent is required");
  if (input.source === "verification" && !isDefaultNumber) throw new PhoneVerificationRequiredError("Verification calls must use the saved default phone number");
  if (input.source !== "verification" && isDefaultNumber && !profile.phoneVerifiedAt) throw new PhoneVerificationRequiredError("Verify the saved phone number before calling it");
  if (!await reserveCallDispatch(input.userId, input.eventId, dailyCallLimit())) throw new CallBudgetExceededError("Daily CALL-E call limit reached");
  return createCalleCall({
    ...input,
    region: input.region ?? (isDefaultNumber ? profile.callRegion : null),
    locale: input.locale ?? (isDefaultNumber ? profile.callLocale : null),
  });
}
