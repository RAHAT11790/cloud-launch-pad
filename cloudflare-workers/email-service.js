// ============================================================
// RS ANIME — EMAIL SERVICE (Cloudflare build) · v1
// ------------------------------------------------------------
// Sign-up email verification + forgot-password codes through
// the Resend API. Works without Lovable Cloud.
//
// Secrets (Cloudflare → Worker → Settings → Variables):
//   RESEND_API_KEY  (required)  Resend → API Keys
//   EMAIL_SECRET    (required)  any long random text (signs codes)
//   EMAIL_FROM      (optional)  "RS ANIME <no-reply@your-domain.com>"
//                               (domain must be verified in Resend;
//                                default onboarding@resend.dev only
//                                reaches your own Resend email)
//   SITE_URL        (optional)  default https://rsanime03.lovable.app
//
// Deploy, then paste the Worker URL into Admin → EGD Router →
// `email-service` and Save.
//
//   POST { action: "send",   email, purpose: "register"|"reset", name? }
//        → { ok, token, expiresAt, cooldown }
//   POST { action: "verify", token, code } → { ok, email, purpose }
//   GET  → health JSON
//
// Anti-spam: only real-looking @gmail.com addresses, 60 s cooldown
// per email, 8 sends / hour per IP, 5 wrong codes per code, codes
// expire after 10 minutes. No state is written to your database.
// ============================================================

const VERSION = "email-service-cf-v1";
const CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_COOLDOWN_S = 60;
const IP_LIMIT_PER_HOUR = 8;
const MAX_WRONG = 5;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store", "x-rs-edge": VERSION },
  });

const GMAIL_RE = /^(?=.{6,30}@)[a-z0-9](?:[a-z0-9]|\.(?!\.))*[a-z0-9]@gmail\.com$/;
const normEmail = (v) => String(v || "").trim().toLowerCase();

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uText = (s) => b64u(enc.encode(s));
const fromB64uText = (s) => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(p + "===".slice((p.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
const safeEq = (a, b) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

// Small counters on the edge cache (shared per data-centre, no KV needed).
const memo = new Map();
async function counter(key, ttlSeconds, inc = 1) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const req = new Request(`https://email-service.counter/${encodeURIComponent(key)}`);
  let n = memo.get(key)?.exp > Date.now() ? memo.get(key).n : 0;
  if (cache) {
    try { const hit = await cache.match(req); if (hit) n = Math.max(n, Number(await hit.text()) || 0); } catch {}
  }
  if (!inc) return n;
  n += inc;
  memo.set(key, { n, exp: Date.now() + ttlSeconds * 1000 });
  if (cache) {
    try { await cache.put(req, new Response(String(n), { headers: { "Cache-Control": `max-age=${ttlSeconds}` } })); } catch {}
  }
  return n;
}

const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function emailHtml({ code, link, purpose, name, site }) {
  const title = purpose === "reset" ? "Reset your password" : "Verify your email";
  const line = purpose === "reset"
    ? "Use this code to set a new password for your RS ANIME account."
    : "Welcome to RS ANIME! Confirm your email to finish creating your account.";
  const btn = purpose === "reset" ? "Open RS ANIME" : "Verify my email";
  return `<!doctype html><html><body style="margin:0;background:#0b0d12;font-family:Arial,Helvetica,sans-serif;color:#e8ecf3">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#141821;border-radius:18px;overflow:hidden;border:1px solid #232a38">
<tr><td style="padding:26px 24px 8px;text-align:center">
<div style="font-size:22px;font-weight:800;letter-spacing:2px;color:#2dd4bf">RS ANIME</div>
<div style="margin-top:18px;font-size:19px;font-weight:700;color:#fff">${esc(title)}</div>
<div style="margin-top:8px;font-size:14px;line-height:21px;color:#a3adbf">${name ? `Hi ${esc(name)}, ` : ""}${esc(line)}</div>
</td></tr>
<tr><td style="padding:18px 24px;text-align:center">
<div style="display:inline-block;padding:14px 22px;border-radius:14px;background:#0b0d12;border:1px dashed #2dd4bf;font-size:32px;font-weight:800;letter-spacing:10px;color:#fff">${esc(code)}</div>
<div style="margin-top:10px;font-size:12px;color:#7d879a">Code expires in 10 minutes</div>
</td></tr>
${link ? `<tr><td style="padding:4px 24px 22px;text-align:center"><a href="${esc(link)}" style="display:inline-block;padding:13px 26px;border-radius:12px;background:#2dd4bf;color:#06201d;font-weight:800;font-size:15px;text-decoration:none">${esc(btn)}</a></td></tr>` : ""}
<tr><td style="padding:14px 24px 22px;text-align:center;font-size:11px;line-height:17px;color:#6b7486;border-top:1px solid #232a38">
If you didn't ask for this, ignore this email — nothing will happen.<br/>${esc(site)}</td></tr>
</table></td></tr></table></body></html>`;
}

async function send(body, env, ip) {
  const email = normEmail(body.email);
  const purpose = body.purpose === "reset" ? "reset" : "register";
  if (!GMAIL_RE.test(email)) return json({ ok: false, error: "only_gmail", message: "Only real @gmail.com addresses are allowed." }, 400);

  const cool = await counter(`cool:${email}`, EMAIL_COOLDOWN_S, 0);
  if (cool > 0) return json({ ok: false, error: "cooldown", message: "Please wait a minute before asking for another code.", cooldown: EMAIL_COOLDOWN_S }, 429);
  const ipCount = await counter(`ip:${ip}`, 3600, 0);
  if (ipCount >= IP_LIMIT_PER_HOUR) return json({ ok: false, error: "too_many", message: "Too many codes from this network. Try again later." }, 429);

  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  const exp = Date.now() + CODE_TTL_MS;
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(9)));
  const payload = b64uText(JSON.stringify({ e: email, p: purpose, x: exp, n: nonce }));
  const sig = await hmac(env.EMAIL_SECRET, `${payload}.${code}`);
  const token = `${payload}.${sig}`;

  const site = String(env.SITE_URL || "https://rsanime03.lovable.app").replace(/\/+$/, "");
  const link = purpose === "register" ? `${site}/?verify=${encodeURIComponent(token)}&code=${code}` : "";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM || "RS ANIME <onboarding@resend.dev>",
      to: [email],
      subject: purpose === "reset" ? `${code} is your RS ANIME password reset code` : `${code} is your RS ANIME verification code`,
      html: emailHtml({ code, link, purpose, name: String(body.name || "").slice(0, 40), site }),
      text: `Your RS ANIME code: ${code}\nIt expires in 10 minutes.${link ? `\nOr open: ${link}` : ""}`,
    }),
  });
  if (!res.ok) {
    const details = (await res.text()).slice(0, 400);
    return json({ ok: false, error: "resend_failed", status: res.status, message: "Email could not be sent.", details }, 502);
  }
  await counter(`cool:${email}`, EMAIL_COOLDOWN_S);
  await counter(`ip:${ip}`, 3600);
  return json({ ok: true, token, expiresAt: exp, cooldown: EMAIL_COOLDOWN_S });
}

async function verify(body, env) {
  const token = String(body.token || "");
  const code = String(body.code || "").replace(/\D/g, "");
  const [payload, sig] = token.split(".");
  if (!payload || !sig || code.length !== 6) return json({ ok: false, error: "bad_code", message: "Incorrect code." }, 400);
  let data;
  try { data = JSON.parse(fromB64uText(payload)); } catch { return json({ ok: false, error: "bad_token", message: "Invalid code. Ask for a new one." }, 400); }
  if (!data?.x || Date.now() > data.x) return json({ ok: false, error: "expired", message: "Code expired. Ask for a new one." }, 400);
  const wrongKey = `wrong:${data.n}`;
  if ((await counter(wrongKey, 900, 0)) >= MAX_WRONG) return json({ ok: false, error: "locked", message: "Too many wrong tries. Ask for a new code." }, 429);
  const expected = await hmac(env.EMAIL_SECRET, `${payload}.${code}`);
  if (!safeEq(expected, sig)) {
    await counter(wrongKey, 900);
    return json({ ok: false, error: "bad_code", message: "Incorrect code." }, 400);
  }
  return json({ ok: true, email: data.e, purpose: data.p });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const ready = !!(env.RESEND_API_KEY && env.EMAIL_SECRET);
    if (request.method === "GET") return json({ ok: true, service: VERSION, ready, missing: [!env.RESEND_API_KEY && "RESEND_API_KEY", !env.EMAIL_SECRET && "EMAIL_SECRET"].filter(Boolean) });
    if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
    if (!ready) return json({ ok: false, error: "not_configured", message: "Email service is not set up yet (RESEND_API_KEY / EMAIL_SECRET missing)." }, 503);
    let body = {};
    try { body = await request.json(); } catch {}
    const ip = request.headers.get("cf-connecting-ip") || "0";
    try {
      if (body.action === "send") return await send(body, env, ip);
      if (body.action === "verify") return await verify(body, env);
      return json({ ok: false, error: "action" }, 400);
    } catch (err) {
      return json({ ok: false, error: "server", message: String(err?.message || err) }, 500);
    }
  },
};
