import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Vite proxies /api, so the browser sees one origin, as with CloudFront in production (DECISIONS.md #5, #19).
const proxy = { '/api': process.env.API_URL ?? 'http://localhost:3030' }

// The production CSP (#14), applied to the built app in `vite preview`, so the end-to-end tests run under it.
// The dev server can't use it, because Vite injects inline scripts for hot reloading.
const securityHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 4173, strictPort: true, proxy, headers: securityHeaders },
})
