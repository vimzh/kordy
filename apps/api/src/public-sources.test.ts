import { describe, expect, test } from "bun:test";
import { evaluatePublicTrigger, shouldFirePublicSignal } from "./public-sources";

process.env.PUBLIC_DATA_USER_AGENT = "Kyub tests test@example.com";
process.env.TWELVE_DATA_API_KEY = "test-key";

const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

describe("public source evaluation", () => {
  test("fires only for new events or false-to-true thresholds", () => {
    const event = { kind: "event" as const, matched: true, fingerprint: "event-2", occurredAt: "2026-08-25T00:00:00Z", summary: "event" };
    const threshold = { ...event, kind: "threshold" as const, fingerprint: "rate-2" };
    expect(shouldFirePublicSignal(null, event)).toBe(false);
    expect(shouldFirePublicSignal({ matched: true, fingerprint: "event-1" }, event)).toBe(true);
    expect(shouldFirePublicSignal({ matched: true, fingerprint: "event-2" }, event)).toBe(false);
    expect(shouldFirePublicSignal({ matched: false, fingerprint: "rate-1" }, threshold)).toBe(true);
    expect(shouldFirePublicSignal({ matched: true, fingerprint: "rate-1" }, threshold)).toBe(false);
  });

  test("evaluates the public providers and Indian stock activities", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.hostname === "api.met.no") return json({ properties: { meta: { updated_at: "2026-08-25T00:00:00Z" }, timeseries: [{ time: future, data: { next_1_hours: { details: { precipitation_amount: 2 } } } }] } });
      if (url.hostname === "data.sec.gov") return json({ filings: { recent: { form: ["8-K"], accessionNumber: ["0001"], filingDate: ["2026-08-25"], primaryDocument: ["report.htm"] } } });
      if (url.hostname === "earthquake.usgs.gov") return json({ features: [{ id: "quake-1", properties: { mag: 5.2, place: "near Bengaluru", time: Date.parse("2026-08-25T00:00:00Z") } }] });
      if (url.hostname === "eonet.gsfc.nasa.gov") return json({ events: [{ id: "event-1", title: "Wildfire", categories: [{ title: "Wildfires" }], geometry: [{ date: "2026-08-25T00:00:00Z" }] }] });
      if (url.hostname === "api.twelvedata.com") return json({ name: "Reliance Industries", datetime: "2026-08-25", timestamp: 1787616000, close: "3000", percent_change: "-6.5", volume: "10000000" });
      return json({ date: "2026-08-25", base: "USD", quote: "INR", rate: 91 });
    }) as typeof fetch;

    const signals = await Promise.all([
      evaluatePublicTrigger({ type: "weather.rain_forecast", location: "Bengaluru", latitude: 12.97, longitude: 77.59, minimumPrecipitationMm: 1, withinHours: 24, consecutiveHours: 1 }, fetcher),
      evaluatePublicTrigger({ type: "sec.filing.published", cik: "320193", companyName: "Apple", forms: ["8-K"] }, fetcher),
      evaluatePublicTrigger({ type: "usgs.earthquake.detected", location: "Bengaluru", latitude: 12.97, longitude: 77.59, radiusKm: 100, minimumMagnitude: 5 }, fetcher),
      evaluatePublicTrigger({ type: "nasa.event.opened", categories: ["wildfires"], location: "", bbox: [] }, fetcher),
      evaluatePublicTrigger({ type: "fx.rate.threshold", base: "USD", quote: "INR", operator: "above", threshold: 90 }, fetcher),
      evaluatePublicTrigger({ type: "india.stock.price_threshold", symbol: "RELIANCE", companyName: "Reliance Industries", exchange: "NSE", operator: "above", price: 2500 }, fetcher),
      evaluatePublicTrigger({ type: "india.stock.daily_move", symbol: "RELIANCE", companyName: "Reliance Industries", exchange: "NSE", direction: "loss", percent: 5 }, fetcher),
      evaluatePublicTrigger({ type: "india.stock.volume_threshold", symbol: "RELIANCE", companyName: "Reliance Industries", exchange: "NSE", minimumVolume: 5_000_000 }, fetcher),
    ]);
    expect(signals.map(({ matched }) => matched)).toEqual([true, true, true, true, true, true, true, true]);
    expect(signals.map(({ fingerprint }) => fingerprint)).toEqual([`2026-08-25T00:00:00Z:${future}`, "0001", "quake-1", "event-1", "2026-08-25:91", "2026-08-25:3000", "move:2026-08-25", "volume:2026-08-25"]);
  });

  test("coalesces identical public-data requests for one minute", async () => {
    let requests = 0;
    const fetcher = (async (_input: URL | RequestInfo) => {
      requests += 1;
      return json({ date: "2026-08-27", base: "USD", quote: "INR", rate: 91 });
    }) as typeof fetch;
    const trigger = { type: "fx.rate.threshold" as const, base: "USD", quote: "INR", operator: "above" as const, threshold: 90 };
    await Promise.all([evaluatePublicTrigger(trigger, fetcher), evaluatePublicTrigger(trigger, fetcher)]);
    expect(requests).toBe(1);
  });
});
