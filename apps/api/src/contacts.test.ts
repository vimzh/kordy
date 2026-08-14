import { afterAll, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { SQL } from "bun";
import server from "./index";

const databaseUrl = process.env.DATABASE_URL!;
const db = new SQL(databaseUrl);
const phone = "+1 202 555 0199";

function cookie() {
  const payload = Buffer.from(JSON.stringify({ sub: "test", exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
  const signature = createHmac("sha256", process.env.SESSION_SECRET!).update(payload).digest("base64url");
  return `kyub_session=${payload}.${signature}`;
}

afterAll(async () => {
  await db`DELETE FROM contacts WHERE phone = ${phone}`;
  await db.close();
});

test("creates and lists a contact", async () => {
  await db`DELETE FROM contacts WHERE phone = ${phone}`;
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
