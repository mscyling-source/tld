// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

/**
 * Resolve the production origin.
 *
 * Priority:
 *   1. `PUBLIC_SITE_URL` / `SITE_URL` environment variable (used by
 *      Cloudflare Pages env vars, local `.env`, and CI).
 *   2. `DEFAULT_SITE_URL` — the placeholder shipped in the repo.
 *
 * Keeping this in one place means switching to the real domain later is a
 * single env-var change, not an edit across many files.
 */
function resolveSiteUrl() {
  const env = process.env.PUBLIC_SITE_URL || process.env.SITE_URL || '';
  if (env.trim()) {
    const clean = env.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(clean)) {
      throw new Error(
        `PUBLIC_SITE_URL must be an absolute http(s) URL (e.g. https://example.com). Received: "${env}"`,
      );
    }
    try {
      // Validate that it parses and has a hostname
      const parsed = new URL(clean);
      if (!parsed.hostname.includes('.')) {
        throw new Error(`PUBLIC_SITE_URL hostname looks invalid: "${parsed.hostname}"`);
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(`PUBLIC_SITE_URL is not a valid URL: "${env}" (${detail})`);
    }
    return clean;
  }
  return DEFAULT_SITE_URL;
}

/**
 * Placeholder origin shipped so a fresh clone builds and tests locally.
 * Replace with the real domain in Cloudflare Pages env vars before launch.
 */
export const DEFAULT_SITE_URL = 'https://tlddirectory.com';

export default defineConfig({
  site: resolveSiteUrl(),
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  integrations: [
    sitemap({
      filter: (page) => {
        try {
          const url = new URL(page);
          const path = url.pathname;
          // Only canonical, indexable URLs belong in the sitemap.
          if (path === '/404.html' || path === '/404/' || path.endsWith('/404.html')) return false;
          if (path.includes('/preview/')) return false;
          return true;
        } catch {
          return false;
        }
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
