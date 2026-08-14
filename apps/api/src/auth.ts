// Google OAuth authorization-code flow and signed cookie sessions.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
type Session = { sub: string; email?: string; name?: string; picture?: string; exp: number };
const env = () => ({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3007/auth/google/callback", sessionSecret: process.env.SESSION_SECRET, webUrl: process.env.WEB_URL ?? "http://localhost:3006/home" });
const cookieValue = (cookie: string | undefined, name: string) => cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
const encode = (value: string) => Buffer.from(value).toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");
const sign = (value: string, secret: string) => createHmac("sha256", secret).update(value).digest("base64url");
const cookie = (name: string, value: string, maxAge: number) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
const required = (values: Record<string, string | undefined>) => { const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => key); if (missing.length) throw new Error(`Missing OAuth configuration: ${missing.join(", ")}`); };

export function startGoogleAuth(c: Context) {
  const config = env(); required({ GOOGLE_CLIENT_ID: config.clientId, SESSION_SECRET: config.sessionSecret });
  const state = randomBytes(24).toString("base64url");
  const url = new URL(GOOGLE_AUTH_URL); url.search = new URLSearchParams({ client_id: config.clientId!, redirect_uri: config.redirectUri, response_type: "code", scope: "openid email profile", state }).toString();
  c.header("Set-Cookie", cookie("oauth_state", state, 600)); return c.redirect(url.toString());
}

export async function finishGoogleAuth(c: Context) {
  const config = env(); required({ GOOGLE_CLIENT_ID: config.clientId, GOOGLE_CLIENT_SECRET: config.clientSecret, SESSION_SECRET: config.sessionSecret });
  const queryState = c.req.query("state"); const savedState = cookieValue(c.req.header("Cookie"), "oauth_state");
  if (!queryState || !savedState || queryState !== savedState) return c.text("Invalid OAuth state", 400);
  const code = c.req.query("code"); if (!code) return c.text("Missing OAuth code", 400);
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: config.clientId!, client_secret: config.clientSecret!, redirect_uri: config.redirectUri, grant_type: "authorization_code" }) });
  if (!tokenResponse.ok) return c.text(`Google token exchange failed: ${await tokenResponse.text()}`, 502);
  const token = (await tokenResponse.json()) as { access_token?: string }; if (!token.access_token) return c.text("Google did not return an access token", 502);
  const userResponse = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!userResponse.ok) return c.text(`Google profile lookup failed: ${await userResponse.text()}`, 502);
  const user = (await userResponse.json()) as { sub?: string; email?: string; name?: string; picture?: string }; if (!user.sub) return c.text("Google profile did not include a subject", 502);
  const payload = encode(JSON.stringify({ sub: user.sub, email: user.email, name: user.name, picture: user.picture, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 } satisfies Session));
  c.header("Set-Cookie", cookie("kyub_session", `${payload}.${sign(payload, config.sessionSecret!)}`, 60 * 60 * 24 * 7)); return c.redirect(config.webUrl);
}

export function currentSession(c: Context) {
  const secret = env().sessionSecret; if (!secret) return null; const value = cookieValue(c.req.header("Cookie"), "kyub_session"); const [payload, signature] = value?.split(".") ?? []; if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret)); const actual = Buffer.from(signature); if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const session = JSON.parse(decode(payload)) as Session; return session.exp > Math.floor(Date.now() / 1000) ? session : null;
}

export function clearSession(c: Context) { c.header("Set-Cookie", cookie("kyub_session", "", 0)); return c.json({ ok: true }); }
