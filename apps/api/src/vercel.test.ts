import { describe, expect, test } from "bun:test";
import { buildVercelInstallUrl, matchesVercelDeployment } from "./vercel";

describe("Vercel connection", () => {
  test("builds the official integration installation URL", () => {
    expect(buildVercelInstallUrl("kordy-call", "state-value")).toBe("https://vercel.com/integrations/kordy-call/new?state=state-value&source=external");
  });

  test("matches project and environment filters", () => {
    const deployment = { name: "Kordy", projectId: "prj_1", target: "production" as const };
    expect(matchesVercelDeployment(deployment, { projectIds: [], projectNames: ["kordy"], environments: ["production"] })).toBe(true);
    expect(matchesVercelDeployment(deployment, { projectIds: [], projectNames: ["other"], environments: [] })).toBe(false);
  });
});
