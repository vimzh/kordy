import { afterAll, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import server from "./index";
import { db } from "./db";
import { contacts, users } from "./schema";

const phone = "+12025550199";

function cookie() {
  const payload = Buffer.from(JSON.stringify({ sub: "test", email: "test@example.com", name: "Test User", exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
  const signature = createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("base64url");
  return `kyub_session=${payload}.${signature}`;
}

afterAll(async () => {
  await db.delete(contacts).where(eq(contacts.phone, phone));
  await db.delete(users).where(eq(users.id, "test"));
});

test("creates and lists a contact", async () => {
  await db.delete(contacts).where(eq(contacts.phone, phone));
  const headers = { Cookie: cookie(), "Content-Type": "application/json" };
  const created = await server.fetch(new Request("http://localhost/contacts", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Test Contact", summary: "Created by the API integration check.", phone }),
  }));
  expect(created.status).toBe(201);

  const listed = await server.fetch(new Request("http://localhost/contacts", { headers }));
  expect(await listed.text()).toContain(phone);
});
