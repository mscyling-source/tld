# Deployment Guide

This project deploys as a static site. Architecture: **GitHub Actions syncs IANA data,
Cloudflare Pages builds and deploys** (Architecture A).

The workflow file never publishes anything itself — it only commits `data/*.json` to `main`.
Cloudflare Pages watches `main` and runs the build. One commit = one deploy, no duplicates,
no Cloudflare API token needed.

---

## Quick reference: what is automatic vs. what you configure

| Done automatically by the repo | Done manually by you |
|---|---|
| Weekly IANA data sync (GitHub Actions) | Create/select a Cloudflare account |
| `npm run build` + `npm test` verification on every sync | Connect the repo in Cloudflare Pages |
| Commit + push of `data/*.json` changes | Set `PUBLIC_SITE_URL` (Production + Preview) |
| Sitemap, robots.txt, canonicals, OG tags | Optionally attach a custom domain |
| Build + publish on every push to `main` | Submit the sitemap to Google Search Console |

---

## 1. Push the repository

```bash
git add -A
git commit -m "feat: TLD directory site"
git branch -M main
git push -u origin main
```

The Actions workflow (`.github/workflows/sync-tlds.yml`) is already committed; it will run on
its Monday schedule and can be triggered manually from the Actions tab.

## 2. Create or select a Cloudflare account and connect Cloudflare Pages

### 2a. Cloudflare account

1. Go to **https://dash.cloudflare.com/sign-up** (or **https://dash.cloudflare.com/sign-in** if you
   already have an account).
2. Sign up with email + password. The free plan is sufficient — Pages is included at no cost.
3. Confirm your email if prompted.

### 2b. Create the Pages project

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. Authorize GitHub, select this repository, branch `main`
3. Build settings (must match `package.json`):

| Setting | Value |
|---|---|
| Framework preset | `Astro` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | *(leave empty)* |
| Node.js version | `20` |

**Node.js version:** `package.json` declares `"engines": { "node": ">=20" }`. The GitHub Actions
workflow uses Node `20`, and the lockfile (`package-lock.json`, lockfileVersion 3) is pinned to
that. In the Cloudflare Pages build dashboard, select **Node 20** (or set a build-time env var
`NODE_VERSION=20` if you prefer). Do not use Node 18 — Astro 7 requires Node 20 or newer.

Cloudflare runs `npm ci` (which reads `package-lock.json`) then `npm run build`. Because the
lockfile is committed and in sync with `package.json`, installs are reproducible.

4. **Save and Deploy**

The workflow never calls the Cloudflare API — it only pushes to `main`. Cloudflare Pages sees
the push, builds, and publishes. One commit = one deploy, no duplicates, no secrets needed.

## 3. Set the production URL

Canonical tags, `sitemap-index.xml`, `robots.txt` and Open Graph URLs are all derived from
`Astro.site`. Set it once and everything follows:

Cloudflare Pages → your project → **Settings → Environment variables**:

| Variable | Production value | Preview value |
|---|---|---|
| `PUBLIC_SITE_URL` | `https://<your-domain>` | `https://<project>.pages.dev` |

A malformed value (missing scheme, hostname without a dot) aborts the build with
`PUBLIC_SITE_URL must be an absolute http(s) URL…`.

> Until you set a real domain, the build uses the placeholder `https://tlddirectory.com`.
> That placeholder is **not** a confirmed production domain — it is only a fallback so local
> builds and tests work. Do not submit it to Google Search Console.

### If you do not yet own a domain

Cloudflare assigns `<project>.pages.dev` for every Pages project. Use it for preview
deployments: set `PUBLIC_SITE_URL=https://<project>.pages.dev` under **Preview environment
variables** (a separate list from Production). Then every pull-request preview emits canonicals,
a sitemap and a robots.txt that all point at the preview host instead of the placeholder.

You can switch the Production `PUBLIC_SITE_URL` to your real domain at any time — no code
change is needed, just redeploy.

### Redirects

`public/_redirects` is copied to `dist/_redirects` at build time and Cloudflare Pages applies
it at the edge. It currently contains two permanent redirects for category pages that existed
before IANA's 2026 taxonomy change removed the "Sponsored" and "Generic Restricted" labels:

```
/category/sponsored/  →  /category/generic/   (301)
/category/restricted/  →  /category/generic/   (301)
```

Both destinations are current, generated pages. Edit this file only if you add new routes.



## 4. Verify the deploy

```bash
# Replace with your real host
HOST="https://<your-domain>"

curl -sSI "$HOST/"                       # 200
curl -s  "$HOST/robots.txt" | tail -3    # Sitemap + Host must use your domain
curl -s  "$HOST/sitemap-index.xml" | head -3
curl -sI "$HOST/tld/nonexistent-tld/"    # must be 404
curl -s  "$HOST/tld/com/" | grep -o '<link rel="canonical"[^>]*>'
```

Expected:
- `/` → `200`
- `/tld/nonexistent-tld/` → `404` (no page is generated for undelegated TLDs)
- `robots.txt` → `Sitemap: <your-domain>/sitemap-index.xml` and `Host: <your-domain>`
- canonical on `/tld/com/` → `<your-domain>/tld/com/`

## 5. HTTPS / custom domain

- Cloudflare Pages provisions TLS automatically for `<project>.pages.dev` and for any custom
  domain you attach under **Custom domains**.
- DNS changes are made in the Cloudflare dashboard for the domain. Do not hand-edit DNS for
  a domain you do not control, and do not purchase a domain from this project's tooling.

## 6. Google Search Console

1. Add the property for the production URL (URL-prefix method is simplest).
2. Verify via the DNS TXT record Cloudflare shows, or the HTML tag method.
3. Submit `https://<your-domain>/sitemap-index.xml`.
4. Use **URL Inspection** on `/tld/com/` and `/tlds/` to request indexing.
5. Watch **Pages** for "Discovered – currently not indexed" before assuming a problem: not
   every one of ~1,490 URLs is expected to be indexed, and the site deliberately does not
   attempt to force that.

> **Only submit the production URL to Search Console.** Never add the `*.pages.dev` preview
> host or the placeholder `https://tlddirectory.com` (the fallback origin that ships in the
> repo). Both will emit their own canonicals once `PUBLIC_SITE_URL` is set, so mixing origins
> creates duplicate-content signals. If you test on the preview host, do it with `curl`, not
> with Search Console.


## 7. Weekly data sync

Runs automatically (`cron: '30 6 * * 1'`, Mondays 06:30 UTC):

```
fetch IANA → validate → npm run build (verify) → npm test
   → commit data/tlds.json + data/meta.json → push to main → Cloudflare rebuilds
```

- **Manual run:** Actions → *Sync TLD Data* → **Run workflow**
- **Failure:** the job exits non-zero, logs are attached as an artifact
  (`sync-log`, 30-day retention), and the existing dataset on `main` is left untouched so the
  live site keeps serving the last good build.
- **Idempotent:** re-running against unchanged IANA data produces identical records.

## 8. Troubleshooting

### Diagnosing a failed build in Cloudflare Pages

1. Cloudflare dashboard → **Workers & Pages** → your project
2. Click the failed deployment → **Builds** tab (or the deployment's **View build logs**)
3. The log shows `npm ci` and `npm run build` output. Common failures:
   - `npm ci` fails with "lock file out of sync" — the committed `package-lock.json`
     does not match `package.json`. Run `npm install` locally and commit the updated lockfile.
   - Build fails with `PUBLIC_SITE_URL must be…` — the env var value is malformed
     (no scheme, no dot in hostname). Fix in Settings → Environment variables, then
     redeploy.
   - Build fails with an Astro error — reproduce locally with `npm ci && npm run build`.
4. A failed deployment does not overwrite the previous good one; the site keeps serving
   the last successful build until a new deploy succeeds.

| Symptom | Likely cause | Fix |
|---|---|---|
| Canonicals point at `tlddirectory.com` | `PUBLIC_SITE_URL` not set | Set it for Production *and* Preview, then redeploy |
| `robots.txt` 404s | Old static file removed; endpoint builds it | Redeploy — `dist/robots.txt` is generated |
| Deploy succeeds but pages are empty | `dist/` not the output dir | Set **Build output directory** = `dist` |
| Build fails with `PUBLIC_SITE_URL must be…` | Malformed value | Use `https://host.tld`, no trailing slash, no path |
| Sync workflow fails | IANA unreachable or layout changed | Check the `sync-log` artifact; existing data is safe |

## 9. Not done here

- No domain was purchased and no DNS was modified by this project.
- No Cloudflare secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) are required — the
  Git integration replaces them.
- Nothing has been deployed from this repository; the steps above are what you run.
