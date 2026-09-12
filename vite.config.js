import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { assistantChat } from './src/lib/assistantProxy.js'

// Dev-only: serve the bring-your-own-LLM assistant proxy locally so
// `npm run dev` can exercise the full browser → /api → provider flow
// without the Vercel CLI (not installed here). In production this exact
// endpoint is served by api/pricing.js (?service=assistant); this is a
// thin dev stand-in over the same shared assistantChat() core and is
// applied only for `vite serve`, never in a production build.
function assistantDevApi() {
  return {
    name: 'assistant-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/pricing', (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        if (url.searchParams.get('service') !== 'assistant') return next()
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'POST only' }))
          return
        }
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', async () => {
          let payload = {}
          try {
            payload = body ? JSON.parse(body) : {}
          } catch {
            payload = {}
          }
          const result = await assistantChat(payload)
          res.statusCode = result.ok ? 200 : result.status || 502
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify(
              result.ok
                ? { message: result.message, model: result.model, usage: result.usage }
                : { error: result.error }
            )
          )
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), assistantDevApi()],
})
