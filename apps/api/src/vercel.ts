// Minimal Vercel OAuth and deployment API client for connected accounts.
export class VercelApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "VercelApiError";
  }
}

async function vercelRequest<T>(path: string, accessToken: string) {
  const response = await fetch(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new VercelApiError(response.status, await response.text());
  return response.json() as Promise<T>;
}

export function buildVercelInstallUrl(slug: string, state: string) {
  return `https://vercel.com/integrations/${encodeURIComponent(slug)}/new?${new URLSearchParams({ state, source: "external" })}`;
}

export async function exchangeVercelCode(input: { code: string; clientId: string; clientSecret: string; redirectUri: string }) {
  const response = await fetch("https://api.vercel.com/v2/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });
  if (!response.ok) throw new VercelApiError(response.status, await response.text());
  return response.json() as Promise<{ access_token: string; user_id: string; team_id: string | null; installation_id: string }>;
}

export type VercelProject = { id: string; name: string };
export type VercelDeployment = {
  uid: string;
  name: string;
  url: string;
  projectId: string;
  target: "production" | "preview" | null;
  created: number;
  meta?: Record<string, string>;
};

export function matchesVercelDeployment(
  deployment: Pick<VercelDeployment, "name" | "projectId" | "target">,
  rule: { projectIds: string[]; projectNames: string[]; environments: string[] },
) {
  const projectMatches = (!rule.projectIds.length && !rule.projectNames.length)
    || rule.projectIds.includes(deployment.projectId)
    || rule.projectNames.some((name) => name.toLowerCase() === deployment.name.toLowerCase());
  return projectMatches && (!rule.environments.length || (deployment.target !== null && rule.environments.includes(deployment.target)));
}

export async function getVercelAccount(accessToken: string, userId: string, teamId: string | null) {
  if (teamId) {
    const team = await vercelRequest<{ id: string; name: string; slug: string }>(`/v2/teams/${encodeURIComponent(teamId)}`, accessToken);
    return { id: team.id, name: team.name, slug: team.slug, type: "team" as const };
  }
  const user = await vercelRequest<{ user: { id: string; name?: string; username: string } }>("/v2/user", accessToken);
  return { id: userId, name: user.user.name || user.user.username, slug: user.user.username, type: "personal" as const };
}

export async function listVercelProjects(accessToken: string, teamId: string | null) {
  const query = new URLSearchParams({ limit: "100" });
  if (teamId) query.set("teamId", teamId);
  const result = await vercelRequest<{ projects: VercelProject[] }>(`/v9/projects?${query}`, accessToken);
  return result.projects.map(({ id, name }) => ({ id, name }));
}

export async function listFailedVercelDeployments(accessToken: string, teamId: string | null, since: Date) {
  const query = new URLSearchParams({ limit: "100", state: "ERROR", since: String(since.getTime()) });
  if (teamId) query.set("teamId", teamId);
  const result = await vercelRequest<{ deployments: VercelDeployment[] }>(`/v6/deployments?${query}`, accessToken);
  return result.deployments;
}
