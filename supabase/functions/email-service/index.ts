// RS ANIME — EMAIL SERVICE (Lovable copy). Same request/response shape as
// cloudflare-workers/email-service.js so EGD Router can point at either.
// Secrets: RESEND_API_KEY, EMAIL_SECRET, optional EMAIL_FROM, SITE_URL.
import worker from "./worker.ts";

Deno.serve((req) =>
  worker.fetch(req, {
    RESEND_API_KEY: Deno.env.get("RESEND_API_KEY"),
    EMAIL_SECRET: Deno.env.get("EMAIL_SECRET"),
    EMAIL_FROM: Deno.env.get("EMAIL_FROM"),
    SITE_URL: Deno.env.get("SITE_URL"),
  }),
);
