// ============================================================
// RS ANIME — AD SHIELD (Anti-AdBlock Gateway) · Supabase Edge · v2
// ------------------------------------------------------------
// Endpoints (append to the function URL):
//   /            → service info JSON
//   /health      → proof of life
//   /probe       → 204, first-party control probe (never on a blocklist)
//   /px          → 1x1 gif beacon
//   /s?u=<url>   → server-side relay for ANY ad script/asset. The browser
//                  only ever sees THIS domain, so DNS filters (AdGuard DNS,
//                  NextDNS, Pi-hole) and filter lists have nothing to match.
//   /t?u=<url>   → HTML trampoline for pop-under / direct links
//   /check?u=... → JSON reachability report for an ad host, measured from the
//                  EDGE (not the user). The client compares its own result:
//                  edge reachable + client blocked === blocker/DNS filter.
//   /v           → rotating verification token
//
// No secrets required.
// ============================================================

const AD_HOSTS = [
  "highperformanceformat.com",
  "profitabledisplaynetwork.com",
  "profitableratecpm.com",
  "adsterranet.com",
  "adsterra.com",
  "displaycontentnetwork.com",
  "effectivegatecpm.com",
  "pl-monetization.com",
  "googlesyndication.com",
  "doubleclick.net",
  "googletagservices.com",
  "google-analytics.com",
  "adnxs.com",
  "propellerads.com",
  "onclickalgo.com",
];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

const json = (obj: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors, ...extra },
  });

const isAdHost = (host: string) =>
  AD_HOSTS.some((h) => host === h || host.endsWith("." + h));

function decodeTarget(raw: string | null): string {
  if (!raw) return "";
  let v = raw.trim();
  if (!/^https?:\/\//i.test(v)) {
    try {
      const b = v.replace(/-/g, "+").replace(/_/g, "/");
      v = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
    } catch { /* keep */ }
  }
  return /^https?:\/\//i.test(v) ? v : "";
}

const b64url = (s: string) =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Rewrite every ad-network absolute URL inside a payload to the relay. */
function rewriteBody(text: string, selfBase: string) {
  return text.replace(/https?:\/\/[^\s"'`)\\]+/gi, (m) => {
    try {
      const u = new URL(m);
      if (!isAdHost(u.hostname)) return m;
      return `${selfBase}/s?u=${b64url(u.toString())}`;
    } catch {
      return m;
    }
  });
}

async function relay(request: Request, target: string, selfBase: string) {
  const upstream = new URL(target);
  const init: RequestInit = {
    method: request.method === "POST" ? "POST" : "GET",
    headers: {
      "User-Agent":
        request.headers.get("User-Agent") ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept": request.headers.get("Accept") || "*/*",
      "Accept-Language": request.headers.get("Accept-Language") || "en-US,en;q=0.9",
      "Referer": upstream.origin + "/",
      "Origin": upstream.origin,
    },
    redirect: "follow",
  };
  if (init.method === "POST") init.body = await request.arrayBuffer();

  const res = await fetch(upstream.toString(), init);
  const ct = (res.headers.get("Content-Type") || "").toLowerCase();
  const headers = new Headers(cors);
  headers.set("Cache-Control", "public, max-age=300");
  headers.set("X-Shield", "1");

  if (/javascript|json|text|html|xml/.test(ct)) {
    const body = rewriteBody(await res.text(), selfBase);
    headers.set(
      "Content-Type",
      /javascript/.test(ct)
        ? "application/javascript; charset=utf-8"
        : res.headers.get("Content-Type") || "text/plain; charset=utf-8",
    );
    return new Response(body, { status: res.status, headers });
  }

  headers.set("Content-Type", res.headers.get("Content-Type") || "application/octet-stream");
  return new Response(res.body, { status: res.status, headers });
}

const GIF = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
  0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00,
  0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
  0x01, 0x00, 0x3b,
]);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  // .../functions/v1/<slug>/<action>
  const slugIdx = parts.findIndex((p) => p === "v1");
  const action = (slugIdx >= 0 ? parts[slugIdx + 2] : parts[1]) || "";
  const selfBase = url.origin + "/" + parts.slice(0, (slugIdx >= 0 ? slugIdx + 2 : 1) + 1).join("/");

  try {
    switch (action) {
      case "probe":
        return new Response(null, {
          status: 204,
          headers: { ...cors, "Cache-Control": "no-store", "X-Shield": "1" },
        });

      case "px":
        return new Response(GIF, {
          headers: { ...cors, "Content-Type": "image/gif", "Cache-Control": "no-store" },
        });

      case "s": {
        const target = decodeTarget(url.searchParams.get("u"));
        if (!target) return json({ error: "missing u" }, 400);
        return await relay(request, target, selfBase);
      }

      case "t": {
        const target = decodeTarget(url.searchParams.get("u"));
        if (!target) return json({ error: "missing u" }, 400);
        const html = `<!doctype html><meta charset="utf-8"><title>…</title>
<script>location.replace(${JSON.stringify(target)});</script>
<noscript><a href="${target}">continue</a></noscript>`;
        return new Response(html, {
          headers: { ...cors, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      }

      case "check": {
        // Edge-side reachability. If the edge can reach the ad host but the
        // browser cannot, the user is running a blocker or a filtering DNS.
        const target =
          decodeTarget(url.searchParams.get("u")) ||
          "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 6000);
        let reachable = false;
        let status = 0;
        try {
          const r = await fetch(target, { method: "GET", signal: ac.signal });
          status = r.status;
          reachable = r.status < 500;
          await r.body?.cancel();
        } catch { /* unreachable */ } finally { clearTimeout(t); }
        return json({ ok: true, target, reachable, status, ts: Date.now() }, 200, {
          "Cache-Control": "no-store",
        });
      }

      case "v": {
        const slice = Math.floor(Date.now() / 60000);
        return json({ ok: true, ts: Date.now(), token: b64url(`rs:${slice}`) }, 200, {
          "Cache-Control": "no-store",
        });
      }

      case "health":
      default:
        return json({
          ok: true,
          service: "rs-ad-shield",
          version: 2,
          endpoints: ["/health", "/probe", "/px", "/s?u=", "/t?u=", "/check?u=", "/v"],
        });
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
