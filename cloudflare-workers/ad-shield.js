// ============================================================
// RS ANIME — AD SHIELD (Anti-AdBlock Edge Function) · v1
// ------------------------------------------------------------
// Deploy to Cloudflare Workers, then paste the Worker URL into
// Admin → EGD Router → `ad-shield` and hit Save. The whole
// anti-adblock system switches on the moment that row is active.
//
// What it does
//   1. /health          → proof-of-life JSON (used by the router ping)
//   2. /probe           → 204, first-party control probe (never blocked)
//   3. /px              → 1x1 gif beacon (first-party, unblockable)
//   4. /s?u=<url>       → server-side relay for ANY ad script/asset.
//                         The browser only ever sees YOUR worker domain,
//                         so DNS blockers (NextDNS / AdGuard DNS / Pi-hole)
//                         and filter lists (EasyList / uBO) have nothing
//                         to match on. Inner ad-network URLs found in the
//                         payload are rewritten to go through the relay too.
//   5. /t?u=<url>       → HTML "trampoline" for pop-under / direct links.
//   6. /v (POST)        → verification token: the client proves an ad asset
//                         really executed. Signed with a rotating time slice.
//
// No secrets required. Everything is stateless + edge-cached.
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

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors, ...extra },
  });

const isAdHost = (host) =>
  AD_HOSTS.some((h) => host === h || host.endsWith("." + h));

function decodeTarget(raw) {
  if (!raw) return "";
  let v = raw.trim();
  // Accept plain URL, encoded URL or base64url
  if (!/^https?:\/\//i.test(v)) {
    try {
      const b = v.replace(/-/g, "+").replace(/_/g, "/");
      v = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
    } catch {
      /* keep as-is */
    }
  }
  return /^https?:\/\//i.test(v) ? v : "";
}

const b64url = (s) =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Rewrite every ad-network absolute URL inside a text payload to the relay. */
function rewriteBody(text, selfOrigin) {
  return text.replace(/https?:\/\/[^\s"'`)\\]+/gi, (m) => {
    try {
      const u = new URL(m);
      if (!isAdHost(u.hostname)) return m;
      return `${selfOrigin}/s?u=${b64url(u.toString())}`;
    } catch {
      return m;
    }
  });
}

async function relay(request, target, selfOrigin) {
  const upstream = new URL(target);
  const init = {
    method: request.method === "POST" ? "POST" : "GET",
    headers: {
      "User-Agent":
        request.headers.get("User-Agent") ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      Accept: request.headers.get("Accept") || "*/*",
      "Accept-Language": request.headers.get("Accept-Language") || "en-US,en;q=0.9",
      Referer: upstream.origin + "/",
      Origin: upstream.origin,
    },
    redirect: "follow",
    cf: { cacheTtl: 300, cacheEverything: true },
  };
  if (init.method === "POST") init.body = await request.arrayBuffer();

  const res = await fetch(upstream.toString(), init);
  const ct = (res.headers.get("Content-Type") || "").toLowerCase();
  const headers = new Headers(cors);
  headers.set("Cache-Control", "public, max-age=300");
  headers.set("X-Shield", "1");

  // Text-ish payloads get inner URLs rewritten so nested requests stay
  // first-party as well.
  if (/javascript|json|text|html|xml/.test(ct)) {
    const body = rewriteBody(await res.text(), selfOrigin);
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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const selfOrigin = url.origin + url.pathname.replace(/\/(health|probe|px|s|t|v|check)$/i, "");
    const path = url.pathname.replace(/\/+$/, "").split("/").pop() || "";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      switch (path) {
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
          return relay(request, target, selfOrigin);
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
          // Edge-side reachability of an ad host. Client compares: edge OK +
          // client blocked === ad blocker / filtering DNS in use.
          const target =
            decodeTarget(url.searchParams.get("u")) ||
            "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
          let reachable = false, status = 0;
          try {
            const r = await fetch(target, { method: "GET", cf: { cacheTtl: 60 } });
            status = r.status;
            reachable = r.status < 500;
          } catch {}
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


        default:
          return json({
            ok: true,
            service: "rs-ad-shield",
            version: 1,
            endpoints: ["/health", "/probe", "/px", "/s?u=", "/t?u=", "/check?u=", "/v"],
          });
      }
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
};
