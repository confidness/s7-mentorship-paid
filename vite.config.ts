import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
