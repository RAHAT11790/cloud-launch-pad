// hls — compatibility shim.
//
// Older builds (and any stale 4h playback cache from before the rewrite was
// fixed) produced HLS proxy URLs of the form
//   `${SUPABASE_URL}/functions/v1/hls?url=...`
// instead of the correct
//   `${SUPABASE_URL}/functions/v1/an-api/hls?url=...`.
//
// Supabase routes those broken URLs to a function literally named `hls`. If
// that function doesn't exist the edge runtime returns RUNTIME_ERROR with a
// blank screen for the player. This shim just 302-redirects to the real
// an-api/hls endpoint so cached/stale links keep working.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const url = new URL(req.url);
  const target = url.searchParams.get('url') || '';
  if (!target) {
    return new Response(JSON.stringify({ error: 'missing ?url=' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const redirect = `${url.origin}/functions/v1/an-api/hls?url=${encodeURIComponent(target)}`;
  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: redirect, 'cache-control': 'no-store' },
  });
});
