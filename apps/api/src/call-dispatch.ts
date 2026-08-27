// Enforces the per-user call budget before creating a billable CALL-E call.
import { createCalleCall } from "./calle";
import { hasCallDispatchCapacity, reserveCallDispatch } from "./db";

function dailyCallLimit() {
  const value = Number(process.env.CALLE_DAILY_CALL_LIMIT ?? "20");
  if (!Number.isInteger(value) || value < 1 || value > 1_000) throw new Error("CALLE_DAILY_CALL_LIMIT must be an integer from 1 to 1000");
  return value;
}

export class CallBudgetExceededError extends Error {}

export function hasCalleCallCapacity(userId: string) {
  return hasCallDispatchCapacity(userId, dailyCallLimit());
}

export async function dispatchCalleCall(input: Parameters<typeof createCalleCall>[0]) {
  if (!await reserveCallDispatch(input.userId, input.eventId, dailyCallLimit())) throw new CallBudgetExceededError("Daily CALL-E call limit reached");
  return createCalleCall(input);
}
