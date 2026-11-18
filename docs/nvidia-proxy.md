# Using NVIDIA (or any CORS-blocked) models from the hosted site

Studious calls the model **directly from your browser**. If the provider doesn't send CORS headers, the browser blocks the call and Settings shows an error naming the host. The fix is a tiny proxy you control. It passes your key through per request and stores nothing.

## Cloudflare Worker (free tier)

```js
// Worker: forwards /chat/completions to NVIDIA, allowing only your site's origin.
const UPSTREAM = 'https://integrate.api.nvidia.com/v1/chat/completions'

export default {
  async fetch(req, env) {
    const allowed = env.ALLOWED_ORIGIN || 'https://nothikemu.github.io'
    const cors = {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Headers': 'authorization,content-type',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      Vary: 'Origin',
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (req.headers.get('Origin') !== allowed) return new Response('forbidden', { status: 403 })
    if (req.method !== 'POST' || !new URL(req.url).pathname.endsWith('/chat/completions')) return new Response('not found', { status: 404 })
    const up = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: req.headers.get('authorization') || '' },
      body: req.body,
    })
    return new Response(up.body, { status: up.status, headers: { ...cors, 'content-type': up.headers.get('content-type') || 'application/json' } })
  },
}
```

Then in Studious → Settings → **NVIDIA NIM**: paste your key, set **Model ID** (copy it exactly from build.nvidia.com), and set **Base URL** to `https://<your-worker>.workers.dev/v1`.

The key you type is kept in this browser's localStorage and sent only to your proxy/NVIDIA. Don't enter it on a browser you don't trust.
