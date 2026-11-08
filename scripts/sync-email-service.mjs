// Regenerates the Lovable Cloud copy of the email worker from the Cloudflare build.
// Run: node scripts/sync-email-service.mjs   (src/test/emailWorker.test.ts checks they match)
import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync("cloudflare-workers/email-service.js", "utf8");
if (src.split("export default {").length !== 2) throw new Error("expected exactly one `export default {`");
const head = `// @ts-nocheck
// Lovable Cloud copy of cloudflare-workers/email-service.js (same code, Deno adapter
// at the end). Keep both files identical above the adapter — a unit test checks it.
`;
const tail = `
// ---- Deno / Lovable Cloud adapter ----
Deno.serve((req) => worker.fetch(req, Deno.env.toObject(), {
  waitUntil: (p) => { try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* ignore */ } },
}));
`;
writeFileSync("supabase/functions/email-service/index.ts", head + src.replace("export default {", "const worker = {") + tail);
console.log("synced supabase/functions/email-service/index.ts");
