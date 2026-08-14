import { describe, expect, test } from "bun:test";
import { devToolsEnabled } from "./ai-telemetry";

describe("AI SDK DevTools", () => {
  test("is explicit and never enabled in production", () => {
    expect(devToolsEnabled({ NODE_ENV: "development", AI_SDK_DEVTOOLS: "true" })).toBe(true);
    expect(devToolsEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(devToolsEnabled({ NODE_ENV: "production", AI_SDK_DEVTOOLS: "true" })).toBe(false);
  });
});
