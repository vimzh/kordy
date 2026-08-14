"use client";

import { FormEvent, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type Contact = {
  id: string;
  name: string;
  summary: string;
  phone: string;
  createdAt: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";
const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" });

export function ContactsTable({ initialContacts }: { initialContacts: Contact[] }) {
  const [contacts, setContacts] = useState(initialContacts);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const contact = {
      name: values.name,
      summary: values.summary,
      phone: `${values.countryCode} ${values.phoneNumber}`,
    };
    setSaving(true);
    setError("");

    try {
      const response = await fetch(`${apiUrl}/contacts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contact),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not add contact");
      setContacts((current) => [result.contact, ...current]);
      form.reset();
      setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not add contact");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="mt-1 text-sm text-muted-foreground">People Kordy can reach when a trigger fires.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus />
              Add contact
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={addContact} className="space-y-4">
              <DialogHeader>
                <DialogTitle>Add contact</DialogTitle>
                <DialogDescription>Add the details Kordy needs to identify and call this person.</DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="contact-name">Name</Label>
                <Input id="contact-name" name="name" maxLength={100} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-summary">One-line summary</Label>
                <Input id="contact-summary" name="summary" maxLength={200} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-phone">International contact number</Label>
                <div className="flex gap-2">
                  <Select name="countryCode" defaultValue="+91">
                    <SelectTrigger aria-label="Country code" className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="+91">India (+91)</SelectItem>
                      <SelectItem value="+1">US / Canada (+1)</SelectItem>
                      <SelectItem value="+44">United Kingdom (+44)</SelectItem>
                      <SelectItem value="+61">Australia (+61)</SelectItem>
                      <SelectItem value="+65">Singapore (+65)</SelectItem>
                      <SelectItem value="+971">UAE (+971)</SelectItem>
                      <SelectItem value="+49">Germany (+49)</SelectItem>
                      <SelectItem value="+33">France (+33)</SelectItem>
                      <SelectItem value="+81">Japan (+81)</SelectItem>
                      <SelectItem value="+55">Brazil (+55)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    id="contact-phone"
                    name="phoneNumber"
                    type="tel"
                    inputMode="tel"
                    placeholder="98765 43210"
                    maxLength={24}
                    className="flex-1"
                    required
                  />
                </div>
              </div>
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button type="submit" disabled={saving}>{saving ? "Adding…" : "Add contact"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Name</TableHead>
              <TableHead>Who they are</TableHead>
              <TableHead>Contact number</TableHead>
              <TableHead>Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell className="font-medium">{contact.name}</TableCell>
                <TableCell className="max-w-xl whitespace-normal text-muted-foreground">{contact.summary}</TableCell>
                <TableCell><a className="hover:underline" href={`tel:${contact.phone}`}>{contact.phone}</a></TableCell>
                <TableCell className="text-muted-foreground">
                  <time dateTime={contact.createdAt}>{dateFormatter.format(new Date(contact.createdAt))}</time>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
