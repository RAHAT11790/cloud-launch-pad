const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, range',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
}

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

    let parsedUrl: URL
    try {
      parsedUrl = new URL(targetUrl)
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const referer = url.searchParams.get('referer') || ''
    const userAgent = url.searchParams.get('ua') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

    const fetchHeaders: Record<string, string> = {
      'User-Agent': userAgent,
    }

    // Forward range header for seeking
    const rangeHeader = req.headers.get('range')
    if (rangeHeader) {
      fetchHeaders['Range'] = rangeHeader
    }

    if (referer) {
      fetchHeaders['Referer'] = referer
      fetchHeaders['Origin'] = new URL(referer).origin
    }

    const response = await fetch(targetUrl, {
      headers: fetchHeaders,
      redirect: 'follow',
    })

    const contentType = response.headers.get('content-type') || ''
    const isM3U8 = targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegurl')

    // For M3U8 playlists, rewrite relative URLs to absolute proxied URLs
    if (isM3U8) {
      const text = await response.text()
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1)
      const proxyBase = `${url.origin}${url.pathname}`

      const rewritten = text.split('\n').map(line => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) {
          // Rewrite URI= in EXT-X-KEY etc.
          if (trimmed.includes('URI="')) {
            return trimmed.replace(/URI="([^"]+)"/g, (_match, uri) => {
              const absoluteUri = uri.startsWith('http') ? uri : baseUrl + uri
              return `URI="${proxyBase}?url=${encodeURIComponent(absoluteUri)}${referer ? '&referer=' + encodeURIComponent(referer) : ''}"`
            })
          }
          return line
        }
        // Stream URL line
        const absoluteUrl = trimmed.startsWith('http') ? trimmed : baseUrl + trimmed
        return `${proxyBase}?url=${encodeURIComponent(absoluteUrl)}${referer ? '&referer=' + encodeURIComponent(referer) : ''}`
      }).join('\n')

      return new Response(rewritten, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
        },
      })
    }

    // For TS segments and other binary content, stream directly
    const body = await response.arrayBuffer()

    const responseHeaders: Record<string, string> = { ...corsHeaders }

    if (contentType) responseHeaders['Content-Type'] = contentType
    
    const contentLength = response.headers.get('content-length')
    if (contentLength) responseHeaders['Content-Length'] = contentLength

    responseHeaders['Accept-Ranges'] = 'bytes'
    const contentRange = response.headers.get('content-range')
    if (contentRange) responseHeaders['Content-Range'] = contentRange

    // Cache TS segments for performance
    if (targetUrl.includes('.ts') || contentType.includes('video/mp2t')) {
      responseHeaders['Cache-Control'] = 'public, max-age=300'
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
