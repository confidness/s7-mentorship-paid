import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/* The project carries no Node types; declaring the one global this file reads keeps it that way. */
declare const process: { env: Record<string, string | undefined>; cwd(): string }

/** The slice of Node's request and response this middleware touches. */
interface NodeReq extends AsyncIterable<Uint8Array> {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
}
interface NodeRes {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: Uint8Array | string): void
}

/**
 * Serves api/*.ts during `npm run dev`, the way Vercel serves them in production.
 *
 * Without this, a local run is a static preview: every /api route 404s and the Studio and the
 * Bazaar can only show "the server functions are not running". `vercel dev` fixes that but
 * needs the Vercel CLI and a linked project. This loads the same files through Vite's own
 * SSR loader and calls the named method export with a Web Request — the exact contract the
 * routes are written against — so nothing in api/ knows the difference.
 *
 * Development only (`apply: 'serve'`); production never sees it. Route names are matched
 * against a strict pattern and `_lib` is refused, so a request cannot load an arbitrary file.
 */
function localApi(): Plugin {
  return {
    name: 'brandyzer-local-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (rawReq: unknown, rawRes: unknown, next: () => void) => {
        const req = rawReq as NodeReq
        const res = rawRes as NodeRes
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()

        const reply = (status: number, body: unknown) => {
          res.statusCode = status
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(body))
        }

        const route = url.pathname.slice('/api/'.length).replace(/\/$/, '')
        if (!/^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(route) || route.split('/').some((part) => part.startsWith('_'))) return reply(404, { error: 'not_found' })

        let mod: Record<string, unknown>
        try {
          mod = await server.ssrLoadModule(`/api/${route}.ts`)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          // A file that is not there is a 404, as on Vercel; one that fails to compile is worth reading.
          if (/does not exist|Failed to load url|ENOENT/i.test(message)) return reply(404, { error: 'not_found' })
          server.config.logger.error(`[api] ${route}: ${message}`)
          return reply(500, { error: 'server_error' })
        }

        const method = (req.method ?? 'GET').toUpperCase()
        const handler = (mod[method] ?? mod.default) as ((request: Request) => Promise<Response>) | undefined
        if (typeof handler !== 'function') return reply(405, { error: 'method_not_allowed' })

        const chunks: Uint8Array[] = []
        for await (const chunk of req) chunks.push(chunk)
        const size = chunks.reduce((n, c) => n + c.length, 0)
        const body = new Uint8Array(size)
        let offset = 0
        for (const c of chunks) {
          body.set(c, offset)
          offset += c.length
        }

        const headers = new Headers()
        for (const [name, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') headers.set(name, value)
          else if (Array.isArray(value)) headers.set(name, value.join(', '))
        }

        try {
          const response = await handler(new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`), { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : body }))
          res.statusCode = response.status
          response.headers.forEach((value, name) => res.setHeader(name, value))
          res.end(new Uint8Array(await response.arrayBuffer()))
        } catch (error) {
          server.config.logger.error(`[api] ${route} threw: ${error instanceof Error ? error.stack : String(error)}`)
          reply(500, { error: 'server_error' })
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // The routes read their keys from process.env, as on Vercel. Vite only exposes VITE_* to the
  // browser bundle; this hands every variable in .env* to the server side, and never overrides
  // one already set in the shell.
  for (const [name, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    if (process.env[name] === undefined) process.env[name] = value
  }
  return {
    plugins: [react(), tailwindcss(), localApi()],
    /**
     * BRANDYZER_LEAN_DEV=1 is for a machine short of memory. Vite pre-bundles every dependency
     * it can find at startup, including three.js and react-three behind the lazily loaded 3D
     * scene, and that one esbuild pass can need more memory than a busy laptop has free. This
     * pre-bundles only React, which ships as CommonJS and cannot be served to a browser as-is;
     * every other dependency here is published as ES modules and is served file by file —
     * a slower first load, a fraction of the memory. The 3D skins fail to load in this mode
     * and their error boundaries leave the stylesheet's own background in place.
     */
    optimizeDeps:
      process.env.BRANDYZER_LEAN_DEV === '1'
        ? { noDiscovery: true, include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'] }
        : undefined,
  }
})
