// Lovable email relay for the RS ANIME03 email-service Worker.
// The Worker (Cloudflare) creates the code ticket, then asks this function to
// deliver the code from the project's own domain through Lovable's email
// service. Before sending, the request is confirmed with the Worker that owns
// the ticket (its URL comes only from the EGD Router row `email-service`), so
// nobody else can use this function to send mail. The Worker falls back to its
// own SMTP mailbox whenever this returns anything but { ok: true }.
import { createClient } from 'npm:@supabase/supabase-js@2'

const DB = (Deno.env.get('FIREBASE_DB_URL') || 'https://animeverse-d7b79-default-rtdb.asia-southeast1.firebasedatabase.app').replace(/\/+$/, '')
const TEMPLATE = 'otp-code'
const RID_RE = /^[a-z0-9]{14,40}$/
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i
const WAIT_MS = 20_000
const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
const out = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS })

let workerMemo = { url: '', exp: 0 }
async function workerUrl(): Promise<string> {
  if (workerMemo.url && workerMemo.exp > Date.now()) return workerMemo.url
  const r = await fetch(`${DB}/settings/functionOverrides/email-service.json`)
  const row = r.ok ? await r.json().catch(() => null) : null
  const url = row && row.enabled !== false && typeof row.customUrl === 'string' ? row.customUrl.trim().replace(/\/+$/, '') : ''
  workerMemo = { url: /^https:\/\//i.test(url) ? url : '', exp: Date.now() + 60_000 }
  return workerMemo.url
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

Deno.serve(async (req) => {
  if (req.method !== 'POST') return out({ ok: false, error: 'method' }, 405)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return out({ ok: false, error: 'not_configured' }, 503)
  if (Number(req.headers.get('content-length') || 0) > 2048) return out({ ok: false, error: 'too_large' }, 413)

  const body = await req.json().catch(() => null)
  const rid = String(body?.rid || '')
  const to = String(body?.to || '').trim().toLowerCase()
  const code = String(body?.code || '')
  const purpose = body?.purpose === 'reset' ? 'reset' : 'register'
  const name = String(body?.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30)
  const otpMinutes = Math.min(30, Math.max(1, Math.round(Number(body?.otpMinutes) || 5)))
  if (!RID_RE.test(rid) || !EMAIL_RE.test(to) || to.length > 80 || !/^\d{6}$/.test(code)) return out({ ok: false, error: 'bad_request' }, 400)

  // 1) Only the Worker that issued this exact code may ask for it to be sent.
  const base = await workerUrl().catch(() => '')
  if (!base) return out({ ok: false, error: 'no_worker' }, 503)
  const check = await fetch(`${base}/relay-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rid, to, code, purpose }),
  }).then((r) => r.json()).catch(() => null)
  if (!check?.ok) return out({ ok: false, error: 'not_confirmed' }, 403)

  // 2) Queue the email (suppression, unsubscribe footer and retries are handled there).
  const started = new Date(Date.now() - 2000).toISOString()
  const fnHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}`, apikey: serviceKey }
  const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
    method: 'POST',
    headers: fnHeaders,
    body: JSON.stringify({
      templateName: TEMPLATE,
      recipientEmail: to,
      idempotencyKey: `otp-${rid}`,
      templateData: { code, purpose, name, otpMinutes },
    }),
  })
  const sent = await sendRes.json().catch(() => null)
  if (!sendRes.ok || !sent?.success) return out({ ok: false, error: sent?.reason || sent?.error || `send_${sendRes.status}` }, 502)

  // 3) Send right away instead of waiting for the next queue tick, then wait for the result.
  fetch(`${supabaseUrl}/functions/v1/process-email-queue`, { method: 'POST', headers: fnHeaders, body: '{}' }).catch(() => {})
  const db = createClient(supabaseUrl, serviceKey)
  const until = Date.now() + WAIT_MS
  let last = 'pending'
  let why = ''
  while (Date.now() < until) {
    await sleep(1200)
    const { data } = await db
      .from('email_send_log')
      .select('status, error_message, created_at')
      .eq('recipient_email', to)
      .eq('template_name', TEMPLATE)
      .gte('created_at', started)
      .order('created_at', { ascending: false })
      .limit(1)
    const row = data?.[0]
    if (!row) continue
    last = String(row.status || 'pending')
    why = String(row.error_message || '').slice(0, 200)
    if (last === 'sent') return out({ ok: true, provider: 'lovable', status: 'sent' })
    if (last === 'failed' || last === 'dlq' || last === 'suppressed' || last === 'bounced') break
  }
  return out({ ok: false, error: last === 'pending' || last === 'rate_limited' ? 'timeout' : last, why }, 502)
})
