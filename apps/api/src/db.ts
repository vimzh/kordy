// PostgreSQL access for contacts, including the local demo seed.
import { SQL } from "bun";

export type Contact = {
  id: string;
  name: string;
  summary: string;
  phone: string;
  createdAt: string;
};

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Missing DATABASE_URL");

const db = new SQL(databaseUrl);

export async function initializeDatabase() {
  await db`
    CREATE TABLE IF NOT EXISTS contacts (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      summary VARCHAR(200) NOT NULL,
      phone VARCHAR(30) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await db`
    INSERT INTO contacts (name, summary, phone)
    VALUES
      ('Aarav Mehta', 'Founder building finance tools for independent retailers.', '+91 98765 43210'),
      ('Maya Chen', 'Product lead evaluating workflow automation for her operations team.', '+1 415 555 0136'),
      ('Noah Williams', 'Angel investor focused on early-stage developer infrastructure.', '+44 20 7946 0182'),
      ('Sofia Ramirez', 'Operations director modernising customer support workflows.', '+1 202 555 0101'),
      ('Ethan Brooks', 'Engineering manager responsible for platform reliability.', '+1 202 555 0102'),
      ('Priya Shah', 'Growth lead running partnerships for a B2B software company.', '+1 202 555 0103'),
      ('Lucas Martin', 'Independent consultant helping startups improve sales operations.', '+1 202 555 0104'),
      ('Amara Okafor', 'Community founder organising events for product builders.', '+1 202 555 0105'),
      ('Daniel Kim', 'Security lead monitoring infrastructure and incident response.', '+1 202 555 0106'),
      ('Elena Petrova', 'Customer success manager overseeing strategic accounts.', '+1 202 555 0107')
    ON CONFLICT (phone) DO NOTHING
  `;
}

export async function listContacts() {
  return db<Contact[]>`
    SELECT id, name, summary, phone, created_at::text AS "createdAt"
    FROM contacts
    ORDER BY created_at DESC, id DESC
  `;
}

export async function createContact(contact: Pick<Contact, "name" | "summary" | "phone">) {
  const [created] = await db<Contact[]>`
    INSERT INTO contacts (name, summary, phone)
    VALUES (${contact.name}, ${contact.summary}, ${contact.phone})
    RETURNING id, name, summary, phone, created_at::text AS "createdAt"
  `;
  return created;
}
