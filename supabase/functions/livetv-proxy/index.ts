import { corsHeaders } from '@supabase/supabase-js/cors'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const targetUrl = url.searchParams.get('url')

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Missing ?url= parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Validate URL
    let parsedUrl: URL
    try {
      parsedUrl = new URL(targetUrl)
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get optional headers from query params
    const referer = url.searchParams.get('referer') || ''
    const userAgent = url.searchParams.get('ua') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

    // Fetch the target URL
    const fetchHeaders: Record<string, string> = {
      'User-Agent': userAgent,
    }
    if (referer) {
      fetchHeaders['Referer'] = referer
      fetchHeaders['Origin'] = new URL(referer).origin
    }

    const response = await fetch(targetUrl, {
      headers: fetchHeaders,
      redirect: 'follow',
    })

    // Get response body
    const body = await response.arrayBuffer()

    // Build response headers
    const responseHeaders: Record<string, string> = {
      ...corsHeaders,
    }

    // Forward content type
    const contentType = response.headers.get('content-type')
    if (contentType) {
      responseHeaders['Content-Type'] = contentType
    }

    // Forward content length
    const contentLength = response.headers.get('content-length')
    if (contentLength) {
      responseHeaders['Content-Length'] = contentLength
    }

    // Allow range requests
    responseHeaders['Accept-Ranges'] = 'bytes'
    const contentRange = response.headers.get('content-range')
    if (contentRange) {
      responseHeaders['Content-Range'] = contentRange
    }

    return new Response(body, {
      status: response.status,
      headers: responseHeaders,
    })
  } catch (error) {
    console.error('Proxy error:', error)
    return new Response(JSON.stringify({ error: 'Proxy fetch failed', detail: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
