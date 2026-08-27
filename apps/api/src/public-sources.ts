// Fetches and evaluates Kyub's built-in public-data triggers.
import type { PublicTaskTrigger } from "./db";

export type PublicSignal = {
  kind: "threshold" | "event";
  matched: boolean;
  fingerprint: string;
  occurredAt: string;
  summary: string;
};

export type PublicSourceState = {
  matched: boolean;
  fingerprint: string;
};

type Fetcher = typeof fetch;
const responseCaches = new WeakMap<Fetcher, Map<string, { expiresAt: number; response: Promise<unknown> }>>();

function publicDataUserAgent() {
  const value = process.env.PUBLIC_DATA_USER_AGENT?.trim();
  if (!value) throw new Error("Set PUBLIC_DATA_USER_AGENT to the product name and a monitored contact email");
  return value;
}

function twelveDataApiKey() {
  const value = process.env.TWELVE_DATA_API_KEY?.trim();
  if (!value) throw new Error("Missing TWELVE_DATA_API_KEY for Indian stock triggers");
  return value;
}

async function fetchJson<T>(url: URL | string, fetcher: Fetcher, userAgent?: string): Promise<T> {
  const key = String(url);
  const cache = responseCaches.get(fetcher) ?? new Map<string, { expiresAt: number; response: Promise<unknown> }>();
  responseCaches.set(fetcher, cache);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.response as Promise<T>;
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  const request = fetcher(url, userAgent ? { headers: { "User-Agent": userAgent } } : undefined).then(async (response) => {
    if (!response.ok) throw new Error(`Public source returned HTTP ${response.status}`);
    return response.json();
  });
  cache.set(key, { expiresAt: Date.now() + 60_000, response: request });
  try {
    return await request as T;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

export function shouldFirePublicSignal(previous: PublicSourceState | null, signal: PublicSignal) {
  if (!previous || !signal.matched) return false;
  return signal.kind === "event" ? signal.fingerprint !== previous.fingerprint : !previous.matched;
}

export function publicSourceState(signal: PublicSignal): PublicSourceState {
  return { matched: signal.matched, fingerprint: signal.fingerprint };
}

export async function evaluatePublicTrigger(trigger: PublicTaskTrigger, fetcher: Fetcher = fetch): Promise<PublicSignal> {
  if (trigger.type === "weather.rain_forecast") {
    const url = new URL("https://api.met.no/weatherapi/locationforecast/2.0/complete");
    url.search = new URLSearchParams({ lat: String(trigger.latitude), lon: String(trigger.longitude) }).toString();
    const body = await fetchJson<{
      properties?: {
        meta?: { updated_at?: string };
        timeseries?: Array<{ time?: string; data?: { next_1_hours?: { details?: { precipitation_amount?: number } } } }>;
      };
    }>(url, fetcher, process.env.MET_USER_AGENT ?? "Kordy/1.0 https://github.com/vimzh/kordy");
    const cutoff = Date.now() + trigger.withinHours * 60 * 60 * 1000;
    const periods = (body.properties?.timeseries ?? []).filter((period) => {
      const time = Date.parse(period.time ?? "");
      return Number.isFinite(time) && time >= Date.now() && time <= cutoff;
    });
    let streak = 0;
    let start = "";
    let peak = 0;
    for (const period of periods) {
      const amount = period.data?.next_1_hours?.details?.precipitation_amount ?? 0;
      peak = Math.max(peak, amount);
      if (amount >= trigger.minimumPrecipitationMm) {
        if (!streak) start = period.time ?? "";
        streak += 1;
        if (streak >= trigger.consecutiveHours) break;
      } else {
        streak = 0;
        start = "";
      }
    }
    const updatedAt = body.properties?.meta?.updated_at ?? new Date().toISOString();
    const matched = streak >= trigger.consecutiveHours;
    return {
      kind: "threshold",
      matched,
      fingerprint: `${updatedAt}:${matched ? start : "clear"}`,
      occurredAt: matched && start ? start : updatedAt,
      summary: matched
        ? `MET Norway forecasts at least ${trigger.minimumPrecipitationMm} mm of rain for ${trigger.consecutiveHours} consecutive hour${trigger.consecutiveHours === 1 ? "" : "s"} in ${trigger.location}, starting ${start}. Peak forecast: ${peak} mm.`
        : `No qualifying rain forecast for ${trigger.location} within ${trigger.withinHours} hours.`,
    };
  }

  if (trigger.type === "sec.filing.published") {
    const cik = trigger.cik.padStart(10, "0");
    const body = await fetchJson<{
      filings?: { recent?: { form?: string[]; accessionNumber?: string[]; filingDate?: string[]; primaryDocument?: string[] } };
    }>(`https://data.sec.gov/submissions/CIK${cik}.json`, fetcher, publicDataUserAgent());
    const recent = body.filings?.recent;
    const index = recent?.form?.findIndex((form) => trigger.forms.includes(form)) ?? -1;
    const accession = index >= 0 ? recent?.accessionNumber?.[index] : undefined;
    const form = index >= 0 ? recent?.form?.[index] : undefined;
    const filingDate = index >= 0 ? recent?.filingDate?.[index] : undefined;
    const document = index >= 0 ? recent?.primaryDocument?.[index] : undefined;
    return {
      kind: "event",
      matched: Boolean(accession),
      fingerprint: accession ?? "none",
      occurredAt: filingDate ? `${filingDate}T00:00:00.000Z` : new Date().toISOString(),
      summary: accession
        ? `${trigger.companyName} filed ${form} with the SEC on ${filingDate}. Accession ${accession}${document ? `, document ${document}` : ""}.`
        : `No ${trigger.forms.join(" or ")} filing was found for ${trigger.companyName}.`,
    };
  }

  if (trigger.type === "usgs.earthquake.detected") {
    const minute = 60_000;
    const url = new URL("https://earthquake.usgs.gov/fdsnws/event/1/query");
    url.search = new URLSearchParams({
      format: "geojson",
      orderby: "time",
      limit: "1",
      starttime: new Date(Math.floor((Date.now() - 24 * 60 * 60 * 1000) / minute) * minute).toISOString(),
      latitude: String(trigger.latitude),
      longitude: String(trigger.longitude),
      maxradiuskm: String(trigger.radiusKm),
      minmagnitude: String(trigger.minimumMagnitude),
    }).toString();
    const body = await fetchJson<{ features?: Array<{ id?: string; properties?: { mag?: number; place?: string; time?: number; url?: string } }> }>(url, fetcher);
    const event = body.features?.[0];
    return {
      kind: "event",
      matched: Boolean(event?.id),
      fingerprint: event?.id ?? "none",
      occurredAt: event?.properties?.time ? new Date(event.properties.time).toISOString() : new Date().toISOString(),
      summary: event?.id
        ? `USGS detected a magnitude ${event.properties?.mag ?? "unknown"} earthquake ${event.properties?.place ?? `near ${trigger.location}`}.${event.properties?.url ? ` ${event.properties.url}` : ""}`
        : `No qualifying earthquake was found near ${trigger.location}.`,
    };
  }

  if (trigger.type === "nasa.event.opened") {
    const url = new URL("https://eonet.gsfc.nasa.gov/api/v3/events");
    url.search = new URLSearchParams({
      status: "open",
      days: "30",
      limit: "50",
      category: trigger.categories.join(","),
      ...(trigger.bbox.length === 4 ? { bbox: trigger.bbox.join(",") } : {}),
    }).toString();
    const body = await fetchJson<{ events?: Array<{ id?: string; title?: string; link?: string; categories?: Array<{ title?: string }>; geometry?: Array<{ date?: string }> }> }>(url, fetcher);
    const event = (body.events ?? []).sort((a, b) => Date.parse(b.geometry?.at(-1)?.date ?? "") - Date.parse(a.geometry?.at(-1)?.date ?? ""))[0];
    const date = event?.geometry?.at(-1)?.date;
    return {
      kind: "event",
      matched: Boolean(event?.id),
      fingerprint: event?.id ?? "none",
      occurredAt: date ?? new Date().toISOString(),
      summary: event?.id
        ? `NASA EONET opened ${event.title ?? "a natural event"}${event.categories?.[0]?.title ? ` (${event.categories[0].title})` : ""}${trigger.location ? ` near ${trigger.location}` : ""}.${event.link ? ` ${event.link}` : ""}`
        : `No qualifying NASA EONET event was found${trigger.location ? ` near ${trigger.location}` : ""}.`,
    };
  }

  if (trigger.type === "india.stock.price_threshold" || trigger.type === "india.stock.daily_move" || trigger.type === "india.stock.volume_threshold") {
    const url = new URL("https://api.twelvedata.com/quote");
    url.search = new URLSearchParams({
      symbol: trigger.symbol,
      mic_code: trigger.exchange === "NSE" ? "XNSE" : "XBOM",
      interval: "1day",
      apikey: twelveDataApiKey(),
    }).toString();
    const body = await fetchJson<{
      status?: string;
      message?: string;
      name?: string;
      datetime?: string;
      timestamp?: number;
      close?: string;
      percent_change?: string;
      volume?: string;
    }>(url, fetcher);
    if (body.status === "error") throw new Error(`Twelve Data error: ${body.message ?? "unknown error"}`);
    const price = Number(body.close);
    const percentChange = Number(body.percent_change);
    const volume = Number(body.volume);
    const occurredAt = Number.isFinite(body.timestamp) ? new Date(body.timestamp! * 1000).toISOString() : new Date().toISOString();
    const label = `${body.name ?? trigger.companyName} (${trigger.symbol}:${trigger.exchange})`;

    if (trigger.type === "india.stock.price_threshold") {
      if (!Number.isFinite(price)) throw new Error("Twelve Data returned an invalid Indian stock price");
      const matched = trigger.operator === "above" ? price >= trigger.price : price <= trigger.price;
      return {
        kind: "threshold",
        matched,
        fingerprint: `${body.datetime ?? "unknown"}:${price}`,
        occurredAt,
        summary: `${label} closed at ₹${price}, ${matched ? "meeting" : "not meeting"} the ${trigger.operator} ₹${trigger.price} trigger. Twelve Data EOD quote.`,
      };
    }
    if (trigger.type === "india.stock.daily_move") {
      if (!Number.isFinite(percentChange)) throw new Error("Twelve Data returned an invalid Indian stock percentage change");
      const matched = trigger.direction === "gain" ? percentChange >= trigger.percent : percentChange <= -trigger.percent;
      return {
        kind: "event",
        matched,
        fingerprint: `move:${body.datetime ?? "unknown"}`,
        occurredAt,
        summary: `${label} moved ${percentChange}% for the day, ${matched ? "meeting" : "not meeting"} the ${trigger.percent}% ${trigger.direction} trigger. Twelve Data EOD quote.`,
      };
    }
    if (!Number.isFinite(volume)) throw new Error("Twelve Data returned an invalid Indian stock volume");
    const matched = volume >= trigger.minimumVolume;
    return {
      kind: "event",
      matched,
      fingerprint: `volume:${body.datetime ?? "unknown"}`,
      occurredAt,
      summary: `${label} traded ${volume.toLocaleString("en-IN")} shares for the day, ${matched ? "meeting" : "not meeting"} the ${trigger.minimumVolume.toLocaleString("en-IN")} volume trigger. Twelve Data EOD quote.`,
    };
  }

  const body = await fetchJson<{ date?: string; base?: string; quote?: string; rate?: number }>(
    `https://api.frankfurter.dev/v2/rate/${trigger.base}/${trigger.quote}`,
    fetcher,
  );
  if (typeof body.rate !== "number" || !Number.isFinite(body.rate)) throw new Error("Frankfurter returned an invalid rate");
  const matched = trigger.operator === "above" ? body.rate > trigger.threshold : body.rate < trigger.threshold;
  return {
    kind: "threshold",
    matched,
    fingerprint: `${body.date ?? "unknown"}:${body.rate}`,
    occurredAt: body.date ? `${body.date}T00:00:00.000Z` : new Date().toISOString(),
    summary: `${body.base ?? trigger.base}/${body.quote ?? trigger.quote} is ${body.rate}, ${matched ? "which crossed" : "which has not crossed"} the ${trigger.operator} ${trigger.threshold} trigger.`,
  };
}
