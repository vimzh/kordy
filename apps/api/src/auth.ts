// Demo credential authentication and signed cookie sessions.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { upsertUser } from "./db";

const DEMO_USER = { sub: "demo-user", email: "demo@gmail.com", name: "Demo User" } as const;
const DEMO_PASSWORD = "demo1234";
export type Session = { sub: string; email?: string; name?: string; picture?: string; exp: number };
const env = () => ({ sessionSecret: process.env.SESSION_SECRET });
export const cookieValue = (cookie: string | undefined, name: string) => cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
const encode = (value: string) => Buffer.from(value).toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");
const sign = (value: string, secret: string) => createHmac("sha256", secret).update(value).digest("base64url");
export const sessionCookie = (name: string, value: string, maxAge: number) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

function equalCredential(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function demoCredentialsMatch(email: string, password: string) {
  return equalCredential(email.toLowerCase(), DEMO_USER.email) && equalCredential(password, DEMO_PASSWORD);
}

export function validReturnTo(value: string | undefined) {
  if (!value || value.length > 500 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

export function oauthReturnTo(c: Context, cookieName: string, fallback: string) {
  const encoded = cookieValue(c.req.header("Cookie"), cookieName);
  if (!encoded) return fallback;
  try {
    return validReturnTo(decodeURIComponent(encoded)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function setOAuthReturnTo(c: Context, cookieName: string, value: string | undefined) {
  c.header("Set-Cookie", sessionCookie(cookieName, encodeURIComponent(validReturnTo(value) ?? ""), 600), { append: true });
}

export async function loginWithDemoCredentials(c: Context) {
  const body = await c.req.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  if (typeof body?.email !== "string" || typeof body.password !== "string" || !demoCredentialsMatch(body.email.trim(), body.password)) {
    return c.json({ error: "Invalid email or password" }, 401);
  }
  const secret = env().sessionSecret;
  if (!secret) throw new Error("Missing SESSION_SECRET");
  await upsertUser(DEMO_USER);
  const maxAge = 60 * 60 * 24 * 7;
  const payload = encode(JSON.stringify({ ...DEMO_USER, exp: Math.floor(Date.now() / 1000) + maxAge } satisfies Session));
  c.header("Set-Cookie", sessionCookie("kyub_session", `${payload}.${sign(payload, secret)}`, maxAge));
  return c.json({ user: DEMO_USER });
}

export function currentSession(c: Context) {
  const secret = env().sessionSecret; if (!secret) return null; const value = cookieValue(c.req.header("Cookie"), "kyub_session"); const [payload, signature] = value?.split(".") ?? []; if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload, secret)); const actual = Buffer.from(signature); if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const session = JSON.parse(decode(payload)) as Session; return session.exp > Math.floor(Date.now() / 1000) ? session : null;
}

export function clearSession(c: Context) { c.header("Set-Cookie", sessionCookie("kyub_session", "", 0)); return c.json({ ok: true }); }
