import type { APIRoute } from 'astro';

/**
 * robots.txt generated at build time from `Astro.site`.
 *
 * Replaces the previous static `public/robots.txt`, which hard-coded one
 * hostname. Deriving it from `site` means the Sitemap and Host directives
 * always match the domain actually deployed — including Cloudflare Pages
 * preview URLs (`*.pages.dev`).
 *
 * Note: `@astrojs/sitemap` writes `sitemap-index.xml` (not
 * `sitemap.xml`), so we reference the index.
 */
export const GET: APIRoute = ({ site }) => {
  const origin = site ? new URL(site).origin : '';
  const sitemapUrl = origin ? `${origin}/sitemap-index.xml` : '/sitemap-index.xml';
  const host = origin ? new URL(site ?? '').host : '';

  const body = [
    '# robots.txt for TLD Directory',
    '# Generated at build time from Astro `site` — do not edit by hand.',
    '',
    'User-agent: *',
    'Allow: /',
    '',
    '# Block non-canonical and utility paths',
    'Disallow: /preview/',
    'Disallow: /404',
    'Disallow: /404.html',
    '',
    `Sitemap: ${sitemapUrl}`,
    ...(host ? [host && `Host: ${host}`] : []),
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};