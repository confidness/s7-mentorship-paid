import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import vercel from './vercel.json'

/**
 * Libraries that change on a different clock from the app, each in a file of its own.
 *
 * A deploy that touches one screen should not make every returning visitor download React and
 * the Supabase client again; split out, those files keep their hash until the dependency
 * itself is upgraded. Only libraries the first screen needs anyway belong here. three.js and
 * the react-three packages are left out on purpose: named here they would become a chunk the
 * entry imports, and the atelier scene — lazy so that nine skins never fetch it — would be
 * downloaded by everyone. `scheduler` goes with react-dom because react-dom imports it; left
 * behind in the entry it would make the two files import each other.
 */
const VENDOR: [RegExp, string][] = [
  [/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/[^/]+)\//, 'react'],
  [/\/node_modules\/@supabase\//, 'supabase'],
  [/\/node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//, 'motion'],
  // Not for caching but for count. Left alone, every icon two screens share becomes a file of
  // its own — about forty requests of half a kilobyte, where the headers weigh as much as
  // the icon. Together they are one small file, and only the icons actually used.
  [/\/node_modules\/lucide-react\//, 'icons'],
]

/**
 * Fails the build when an inline script has no hash in the Content-Security-Policy.
 *
 * vercel.json allows the theme script in index.html by the sha256 of its exact text, so
 * editing even a comment inside it changes the hash. Report-only, that costs a report on
 * every page view; enforced, the theme would stop applying before first paint and the site
 * would flash the wrong palette. Checked against the HTML as built, which is what is served.
 */
function inlineScriptsInPolicy(): Plugin {
  const policy = vercel.headers
    .flatMap((rule) => rule.headers)
    .filter((h) => h.key.startsWith('Content-Security-Policy'))
    .map((h) => h.value)
    .join(' ')

  return {
    name: 's7:inline-scripts-in-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      async handler(html) {
        for (const [, body] of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
          if (!body.trim()) continue
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))
          const hash = `'sha256-${btoa(String.fromCharCode(...digest))}'`
          if (!policy.includes(hash)) {
            throw new Error(`An inline script in index.html is not in the CSP in vercel.json. Add ${hash} to script-src.`)
          }
        }
      },
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), inlineScriptsInPolicy()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          return VENDOR.find(([pattern]) => pattern.test(id))?.[1]
        },
      },
    },
  },
})
