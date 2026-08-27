"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Profile = { defaultPhone: string | null; callRegion: string | null; callLocale: string | null };
type RegionOption = { value: string; label: string; locales: Array<{ value: string; label: string }> };

const english = (region: string) => ({ value: `en-${region}`, label: "English" });
const callRegions: RegionOption[] = [
  { value: "US", label: "United States", locales: [english("US")] },
  { value: "SG", label: "Singapore", locales: [english("SG")] },
  { value: "MY", label: "Malaysia", locales: [english("MY"), { value: "zh-MY", label: "Chinese" }, { value: "ms-MY", label: "Malay" }] },
  { value: "IN", label: "India", locales: [english("IN"), { value: "hi-IN", label: "Hindi" }, { value: "ta-IN", label: "Tamil" }] },
  { value: "AE", label: "United Arab Emirates", locales: [english("AE"), { value: "ar-AE", label: "Arabic" }] },
  { value: "AU", label: "Australia", locales: [english("AU")] },
  { value: "CA", label: "Canada", locales: [english("CA")] },
  { value: "GB", label: "United Kingdom", locales: [english("GB")] },
  { value: "VN", label: "Vietnam", locales: [{ value: "vi-VN", label: "Vietnamese" }, english("VN")] },
  { value: "DE", label: "Germany", locales: [{ value: "de-DE", label: "German" }, english("DE")] },
  { value: "JP", label: "Japan", locales: [{ value: "ja-JP", label: "Japanese" }, english("JP")] },
  { value: "FR", label: "France", locales: [{ value: "fr-FR", label: "French" }, english("FR")] },
  { value: "MX", label: "Mexico", locales: [{ value: "es-MX", label: "Spanish" }, english("MX")] },
  { value: "BR", label: "Brazil", locales: [{ value: "pt-BR", label: "Portuguese" }, english("BR")] },
  { value: "ID", label: "Indonesia", locales: [english("ID")] },
  { value: "PH", label: "Philippines", locales: [english("PH")] },
  { value: "KE", label: "Kenya", locales: [english("KE")] },
  { value: "NL", label: "Netherlands", locales: [english("NL")] },
  { value: "PL", label: "Poland", locales: [{ value: "pl-PL", label: "Polish" }, english("PL")] },
  { value: "BD", label: "Bangladesh", locales: [{ value: "bn-BD", label: "Bengali" }, english("BD")] },
  { value: "NG", label: "Nigeria", locales: [english("NG")] },
  { value: "OM", label: "Oman", locales: [english("OM"), { value: "ar-OM", label: "Arabic" }] },
  { value: "TH", label: "Thailand", locales: [{ value: "th-TH", label: "Thai" }, english("TH")] },
  { value: "NA", label: "Namibia", locales: [english("NA")] },
  { value: "CM", label: "Cameroon", locales: [english("CM"), { value: "fr-CM", label: "French" }] },
  { value: "MZ", label: "Mozambique", locales: [{ value: "pt-MZ", label: "Portuguese" }, english("MZ")] },
  { value: "SA", label: "Saudi Arabia", locales: [{ value: "ar-SA", label: "Arabic" }, english("SA")] },
  { value: "FI", label: "Finland", locales: [{ value: "fi-FI", label: "Finnish" }, english("FI")] },
  { value: "UA", label: "Ukraine", locales: [{ value: "uk-UA", label: "Ukrainian" }, english("UA")] },
  { value: "LK", label: "Sri Lanka", locales: [english("LK"), { value: "ta-LK", label: "Tamil" }, { value: "si-LK", label: "Sinhala" }] },
  { value: "BW", label: "Botswana", locales: [english("BW")] },
  { value: "PK", label: "Pakistan", locales: [{ value: "ur-PK", label: "Urdu" }, english("PK")] },
  { value: "TR", label: "Turkey", locales: [{ value: "tr-TR", label: "Turkish" }] },
  { value: "HN", label: "Honduras", locales: [{ value: "es-HN", label: "Spanish" }, english("HN")] },
  { value: "ES", label: "Spain", locales: [{ value: "es-ES", label: "Spanish" }, english("ES")] },
  { value: "TW", label: "Taiwan", locales: [english("TW")] },
  { value: "ZA", label: "South Africa", locales: [english("ZA")] },
  { value: "EG", label: "Egypt", locales: [{ value: "ar-EG", label: "Arabic" }, english("EG")] },
  { value: "GH", label: "Ghana", locales: [english("GH")] },
  { value: "IL", label: "Israel", locales: [{ value: "he-IL", label: "Hebrew" }, english("IL")] },
  { value: "IE", label: "Ireland", locales: [english("IE")] },
  { value: "TN", label: "Tunisia", locales: [english("TN")] },
];

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3007";
const e164Pattern = /^\+[1-9]\d{6,14}$/;
const automatic = "automatic";

// Account-level call delivery preferences, kept separate from source connections.
export function AccountSettings() {
  const [defaultPhone, setDefaultPhone] = useState("");
  const [callRegion, setCallRegion] = useState(automatic);
  const [callLocale, setCallLocale] = useState(automatic);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const selectedRegion = callRegions.find(({ value }) => value === callRegion);

  useEffect(() => {
    let active = true;
    void fetch(`${apiUrl}/profile`, { credentials: "include" })
      .then(async (response) => {
        const result = await response.json().catch(() => null) as { profile?: Profile; error?: string } | null;
        if (!response.ok || !result?.profile) throw new Error(result?.error ?? "Could not load settings");
        if (active) {
          setDefaultPhone(result.profile.defaultPhone ?? "");
          setCallRegion(result.profile.callRegion ?? automatic);
          setCallLocale(result.profile.callLocale ?? automatic);
        }
      })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Could not load settings"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function changeRegion(region: string) {
    setCallRegion(region);
    setCallLocale(region === automatic ? automatic : callRegions.find(({ value }) => value === region)?.locales[0]?.value ?? automatic);
  }

  async function saveCallPreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const phone = defaultPhone.trim();
    setMessage("");
    if (!e164Pattern.test(phone)) return setMessage("Use E.164 format, for example +919876543210.");
    setSaving(true);
    try {
      const response = await fetch(`${apiUrl}/profile`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultPhone: phone,
          callRegion: callRegion === automatic ? null : callRegion,
          callLocale: callLocale === automatic ? null : callLocale,
        }),
      });
      const result = await response.json().catch(() => null) as { profile?: Profile; error?: string } | null;
      if (!response.ok || !result?.profile) throw new Error(result?.error ?? "Could not save call preferences");
      setDefaultPhone(result.profile.defaultPhone ?? "");
      setCallRegion(result.profile.callRegion ?? automatic);
      setCallLocale(result.profile.callLocale ?? automatic);
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save call preferences");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-heading">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your Kordy account preferences.</p>
      </div>
      <Card size="sm" className="max-w-xl gap-3">
        <CardHeader className="gap-1">
          <div className="flex items-center gap-2"><Phone className="size-4" aria-hidden="true" /><CardTitle className="text-sm font-medium">Call delivery and language</CardTitle></div>
          <p className="text-sm text-muted-foreground">Choose where Kordy calls you and how CALL-E speaks.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveCallPreferences} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="default-phone">Phone number</Label>
              <p id="default-phone-help" className="text-xs text-muted-foreground">Used when a trigger says “call me”. Include the country code.</p>
              <Input id="default-phone" name="defaultPhone" type="tel" inputMode="tel" autoComplete="tel" value={defaultPhone} onChange={(event) => setDefaultPhone(event.target.value)} placeholder="+919876543210" pattern="\+[1-9][0-9]{6,14}" aria-describedby="default-phone-help" className="h-11 text-base sm:text-sm" disabled={loading || saving} required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="call-region">Calling region</Label>
                <Select value={callRegion} onValueChange={changeRegion} disabled={loading || saving}>
                  <SelectTrigger id="call-region" className="h-11 w-full text-base sm:text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={automatic}>Automatic from phone number</SelectItem>
                    {callRegions.map((region) => <SelectItem key={region.value} value={region.value}>{region.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="call-locale">Call language</Label>
                <Select value={callLocale} onValueChange={setCallLocale} disabled={loading || saving || !selectedRegion}>
                  <SelectTrigger id="call-locale" className="h-11 w-full text-base sm:text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={automatic}>Automatic</SelectItem>
                    {selectedRegion?.locales.map((locale) => <SelectItem key={locale.value} value={locale.value}>{locale.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {callRegion === "IN" ? <p className="text-xs text-muted-foreground">CALL-E currently routes India calls through international testing lines. A local production line requires CALL-E enablement.</p> : null}
            <Button type="submit" className="h-11" disabled={loading || saving}>{saving ? "Saving…" : "Save call preferences"}</Button>
          </form>
          {message ? <p role="status" aria-live="polite" className={`mt-3 text-sm ${message === "Saved." ? "text-muted-foreground" : "text-destructive"}`}>{message}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
