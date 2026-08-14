// Enables local AI SDK run inspection without capturing production traffic.
import { DevToolsTelemetry } from "@ai-sdk/devtools";
import { registerTelemetry } from "ai";

export function devToolsEnabled(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production" && env.AI_SDK_DEVTOOLS === "true";
}

if (devToolsEnabled()) registerTelemetry(DevToolsTelemetry());
