// Starts a temporary Cloudflare tunnel and points the configured Pub/Sub subscription at it.
export {};
const subscription = process.env.GOOGLE_PUBSUB_SUBSCRIPTION;
const serviceAccount = process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT;
if (!subscription || !serviceAccount) throw new Error("Set GOOGLE_PUBSUB_SUBSCRIPTION and GOOGLE_PUBSUB_SERVICE_ACCOUNT");
if (!Bun.which("cloudflared")) throw new Error("cloudflared is not installed");
if (!Bun.which("gcloud")) throw new Error("gcloud is not installed or authenticated");

const tunnel = Bun.spawn(["cloudflared", "tunnel", "--url", "http://localhost:3007", "--no-autoupdate"], {
  stdout: "pipe",
  stderr: "pipe",
});
const decoder = new TextDecoder();
let output = "";
let publicUrl = "";

const reader = tunnel.stderr.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const text = decoder.decode(value);
  process.stderr.write(text);
  output += text;
  publicUrl = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0] ?? "";
  if (publicUrl) break;
}
if (!publicUrl) throw new Error("cloudflared did not provide a temporary HTTPS URL");

const pushUrl = `${publicUrl}/webhooks/gmail`;
const update = Bun.spawnSync([
  "gcloud", "pubsub", "subscriptions", "update", subscription,
  `--push-endpoint=${pushUrl}`,
  `--push-auth-service-account=${serviceAccount}`,
  `--push-auth-token-audience=${pushUrl}`,
], { stdout: "inherit", stderr: "inherit" });
if (update.exitCode !== 0) {
  tunnel.kill();
  throw new Error("Could not update the Pub/Sub push subscription");
}

console.log(`Restart the API with GOOGLE_PUBSUB_AUDIENCE=${pushUrl}`);
await tunnel.exited;
