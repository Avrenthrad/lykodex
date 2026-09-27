import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createClient } from '@supabase/supabase-js'
import { dispatchAssistant, supabaseAssistantDb } from './src/lib/assistantApi.js'

// Dev-only stand-in for api/pricing.js?service=assistant. `npm run dev`
// has no Vercel CLI here, so the browser's same-origin /api call would
// 404. This middleware uses the same dispatchAssistant() core — keys
// still go to Supabase via the service-role client, never localStorage.
// `apply: 'serve'` keeps it out of production builds. Localhost http
// providers are allowed only on this path; the Vercel handler sets
// allowLocalhost from !process.env.VERCEL.
function assistantDevApi() {
  return {
    name: 'assistant-dev-api',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      server.middlewares.use('/api/pricing', (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost')
        if (url.searchParams.get('service') !== 'assistant') return next()

        const send = (status, body) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }

        if (req.method !== 'POST') {
          send(405, { error: 'POST only' })
          return
        }

        const chunks = []
        let size = 0
        req.on('data', (chunk) => {
          size += chunk.length
          if (size > 64_000) {
            send(413, { error: 'Request body is too large.' })
            req.destroy()
          } else {
            chunks.push(chunk)
          }
        })
        req.on('end', async () => {
          if (res.writableEnded) return
          let payload = {}
          try {
            const raw = Buffer.concat(chunks).toString('utf8')
            payload = raw ? JSON.parse(raw) : {}
          } catch {
            send(400, { error: 'Request body is not valid JSON.' })
            return
          }

          try {
            const { userId, db } = await callerFromRequest(req, env)
            const result = await dispatchAssistant({
              db,
              userId,
              mode: url.searchParams.get('mode'),
              body: payload,
              allowLocalhost: true,
            })
            send(result.status, result.body)
          } catch (err) {
            send(err.status || 500, { error: err.message || 'Assistant request failed.' })
          }
        })
      })
    },
  }
}

async function callerFromRequest(req, env) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw Object.assign(new Error('Missing Authorization bearer token'), { status: 401 })

  const supabaseUrl = env.VITE_SUPABASE_URL
  const anonKey = env.VITE_SUPABASE_ANON_KEY
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw Object.assign(new Error('Server not configured for this'), { status: 500 })
  }

  const anonClient = createClient(supabaseUrl, anonKey)
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await anonClient.auth.getUser(token)
  if (error || !data?.user) throw Object.assign(new Error('Invalid session'), { status: 401 })
  return { userId: data.user.id, db: supabaseAssistantDb(adminClient) }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), assistantDevApi()],
})
