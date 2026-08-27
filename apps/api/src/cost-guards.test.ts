import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  claimCalendarConnectionForPolling,
  claimNotionConnectionForPolling,
  claimVercelConnectionForPolling,
  db,
  hasCallDispatchCapacity,
  initializeDatabase,
  reserveCallDispatch,
  saveIntegrationConnection,
  saveNotionConnection,
  saveVercelConnection,
  upsertUser,
} from "./db";
import { integrationConnections, notionConnections, users, vercelConnections } from "./schema";

test("enforces a per-user call budget without charging an idempotent retry twice", async () => {
  await initializeDatabase();
  const userId = `call-budget-${crypto.randomUUID()}`;
  await upsertUser({ sub: userId, email: `${userId}@example.com` });
  expect(await hasCallDispatchCapacity(userId, 1)).toBe(true);
  expect(await reserveCallDispatch(userId, "event-1", 1)).toBe(true);
  expect(await hasCallDispatchCapacity(userId, 1)).toBe(false);
  expect(await reserveCallDispatch(userId, "event-1", 1)).toBe(true);
  expect(await reserveCallDispatch(userId, "event-2", 1)).toBe(false);
  await db.delete(users).where(eq(users.id, userId));
});

test("does not poll paid providers when a connection has no active tasks", async () => {
  await initializeDatabase();
  const userId = `idle-provider-${crypto.randomUUID()}`;
  const stale = "2000-01-01T00:00:00.000Z";
  await upsertUser({ sub: userId, email: `${userId}@example.com` });
  await saveVercelConnection({ id: `${userId}-vercel`, userId, accountId: "account", accountName: "Idle", accountSlug: "idle", teamId: null, encryptedAccessToken: "test", projects: [], status: "connected" });
  await saveNotionConnection({ id: `${userId}-notion`, userId, workspaceId: "workspace", workspaceName: "Idle", workspaceIcon: null, encryptedAccessToken: "test", encryptedRefreshToken: "test", pages: [], status: "connected" });
  await saveIntegrationConnection({ id: `${userId}-calendar`, userId, provider: "google_calendar", label: "idle@example.com", encryptedCredential: "test", metadata: {}, status: "connected" });
  await db.update(vercelConnections).set({ lastPolledAt: stale }).where(eq(vercelConnections.id, `${userId}-vercel`));
  await db.update(notionConnections).set({ lastPolledAt: stale }).where(eq(notionConnections.id, `${userId}-notion`));
  await db.update(integrationConnections).set({ lastPolledAt: stale }).where(eq(integrationConnections.id, `${userId}-calendar`));

  try {
    expect((await claimVercelConnectionForPolling())?.id).not.toBe(`${userId}-vercel`);
    expect((await claimNotionConnectionForPolling())?.id).not.toBe(`${userId}-notion`);
    expect((await claimCalendarConnectionForPolling())?.id).not.toBe(`${userId}-calendar`);
  } finally {
    await db.delete(users).where(eq(users.id, userId));
  }
});
