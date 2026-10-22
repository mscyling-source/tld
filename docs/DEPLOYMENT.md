# Deployment Guide

This project deploys as a static site. The Cloudflare Pages project is a **direct upload**
project: GitHub Actions builds the site and uploads `dist/` with Wrangler. Cloudflare does
*not* run the build for us, and the repository is **not** connected to Cloudflare Git
integration.

```
.github/workflows/sync-prices.yml   (daily, 04:45 UTC)
   └─ fetch price sources → validate → npm test
        → commit data/prices*.json → push to main
        → build (PUBLIC_SITE_URL=https://tld-directory.pages.dev)
        → wrangler pages deploy dist --project-name tld-directory --branch main
        → verify the live site serves the new dataset
```

- **Project:** `tld-directory` (existing — never create a second one)
- **Live URL:** https://tld-directory.pages.dev/
- **Production branch:** `main`
- **One deploy per run** — the workflow is the only publisher, so there are no duplicate
  builds and no build race.

---

## Quick reference: what is automatic vs. what you configure

| Done automatically by the repo | Done manually by you |
|---|---|
| Daily price sync from 3 authorised sources (GitHub Actions) | Add the two deployment secrets (once) |
| Dataset validation, staleness marking, source-attribution checks | Keep the Cloudflare Pages project `tld-directory` |
| `npm test` + `npm run build` before every publish | Decide the production domain (later) |
| Commit + push of `data/prices*.json` to `main` | Optionally attach a custom domain |
| Build + publish to Cloudflare Pages on every publish-worthy run | Submit the sitemap to Google Search Console |
| Skips the upload when the live site already serves the current commit | — |

---

## 1. Push the repository

```bash
git add -A
git commit -m "feat: TLD directory site"
git branch -m main
git push -u origin main
```

The workflows (`.github/workflows/sync-tlds.yml`, `.github/workflows/sync-prices.yml`) are
committed with the repo. The price workflow runs daily and can be triggered manually from
the Actions tab.

## 2. The Cloudflare Pages project

The project already exists:

| Property | Value |
|---|---|
| Project name | `tld-directory` |
| Domain | `tld-directory.pages.dev` |
| Git provider | **No** (direct upload) |
| Production branch | `main` |

Because the project is a direct-upload project, **Cloudflare never runs `npm ci` or
`npm run build`**. The build happens in GitHub Actions (or on your machine) and only the
resulting `dist/` is uploaded. A commit to `main` therefore does *not* rebuild the site —
the price workflow publishes it (see section 3).

The build itself always uses the same settings, wherever it runs:

| Setting | Value |
|---|---|
| Framework preset | `Astro` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js version | `22` (`>=22.12.0` — Astro 7 aborts on Node 20) |

## 3. Automated price sync and publishing

### 3a. Required repository secrets

Two secrets must exist in the repository (**Settings → Secrets and variables → Actions →
Repository secrets**). They are only ever read into the job environment — the workflow
never prints them, and they are never committed.

| Secret name | What it is | Where to get it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | API token with **Cloudflare Pages: Edit** for this account | Cloudflare dashboard → **My Profile → API Tokens → Create Token**. Use the *Cloudflare Pages — Edit* template, scoped to the account that owns `tld-directory`. Copy the token value into the secret. |
| `CLOUDFLARE_ACCOUNT_ID` | The 32-character account id | Cloudflare dashboard → right-hand sidebar of any Workers & Pages page, or the API tokens page. It is an identifier, not a credential — but it is stored as a secret so nothing about the account is committed. |

The account id currently in use is `27c45857a15fe18008dd97913192c3e7`.

**If either secret is missing the workflow fails loudly** with a message naming the
missing secret(s) and where to create them. It never attempts a deploy without
credentials, and it never prints a partial value. Until the secrets exist:

- the price data still syncs and commits to `main` (the repository stays current), but
- the site keeps serving the last successful deployment, and
- you can publish manually (section 3e).

### 3b. What one run does

| Stage | Behaviour |
|---|---|
| **Fetch** | `npm run sync:prices` reads five registrars' own published price lists (Porkbun API, Dynadot, Gandi, Hover, IONOS) plus three CC BY 4.0 datasets (Best Domain Registrars, Pikkly, Open Domain Data). A source that fails, returns nothing usable, or shrinks by more than 50 % **keeps its previous rows** and keeps its original fetch timestamp. If every source fails, the script exits 1 and `data/prices.json` is left byte-for-byte unchanged. |
| **Validate** | Rows with unknown TLDs, invalid prices, missing USD currency, invalid URLs, unparsable dates, duplicates, or a `verified` claim with no verification date are rejected and counted. Every offer keeps its three provenance timestamps; every source keeps its licence and attribution string. |
| **Report** | `data/price-sync-report.json` + `.md` state how many offers are first-party reads, how many are snapshots, and the oldest evidence in the dataset. The Markdown is appended to the run summary and both files are uploaded as artefacts on every run. |
| **Test** | `npm test` must pass before anything is published. |
| **Commit** | Only `data/prices.json`, `data/prices-meta.json` and the two report files are committed, as `chore: sync registrar pricing (<date>)`. The push is rebased onto `main` first, so a human commit made during the run does not break the push. |
| **Build** | `PUBLIC_SITE_URL=https://tld-directory.pages.dev npm run build`, then a sanity check that the built homepage contains the price table and that the built price index comes from the freshly synced dataset. |
| **Publish** | `npx wrangler@<pinned> pages deploy dist --project-name tld-directory --branch main --commit-hash <sha>` — the same project, the same hostname, the same direct-upload architecture. |
| **Verify** | The live homepage and `/prices-index.json` are fetched; the run fails if the live dataset is not the one just built. |

### 3c. When it skips a deployment

The publish step is skipped when the live site already serves what is on `main`:

- the live deployment's commit equals the current commit → **skip** ("already published");
- the live deployment's commit is *newer* than the current commit → **skip** and warn,
  so an older dataset can never overwrite a newer one;
- no live deployment is recorded, or the commits are unrelated → **publish**.

A price-data change always leads to a publish, because the data commit is what `main`
points at afterwards. A code change on `main` (e.g. a UI fix) is published by the next
run as well — the workflow always builds the current `main`, never a stale checkout.

### 3d. Overlapping runs

`concurrency: { group: sync-prices, cancel-in-progress: false }` means:

- only one run of this workflow is in flight at a time;
- if a run is queued while another is running, GitHub keeps the **newest** pending run
  and drops the older one, so a backlog can never publish stale data;
- a newer run can therefore never publish before an older one has finished, and the
  "live is newer" check in 3c is the second line of defence.

The workflow has **no `push` trigger** on purpose. It commits generated data to `main`;
with a `push` trigger it would retrigger itself in a loop (commit → push → run → commit).
The contract is asserted by `tests/workflow.test.ts`.

### 3e. Manual publishing and recovery

```bash
# 1. Refresh the price data (optional — the daily workflow does this)
npm run sync:prices

# 2. Build with the preview origin
PUBLIC_SITE_URL=https://tld-directory.pages.dev npm run build

# 3. Publish to the existing project
npx wrangler@4.151.3 pages deploy dist \
  --project-name tld-directory \
  --branch main \
  --commit-hash "$(git rev-parse HEAD)" \
  --commit-message "chore: manual publish"
```

Recovery recipes:

| Situation | What to do |
|---|---|
| Workflow failed on the sync step | The dataset on `main` is untouched; the site keeps serving the last good deploy. Check the `sync-prices-log` artifact, fix the cause, then **Actions → Sync Registrar Pricing → Run workflow**. |
| Workflow failed because the secrets are missing | Add the two secrets (3a) and re-run the workflow manually. |
| The site is stale but the data is current | Run the workflow manually — it skips the upload only when the live commit already matches `main`; otherwise it publishes. |
| You need to roll back to an earlier build | `git checkout <old-sha> && npm ci && PUBLIC_SITE_URL=https://tld-directory.pages.dev npm run build && npx wrangler@4.151.3 pages deploy dist --project-name tld-directory --branch main` — the new deployment's commit hash records the rollback. |
| A run is stuck | GitHub cancels a run from the Actions UI; a cancelled run never leaves a partial deployment (Cloudflare activates an upload atomically). |

### 3f. Verifying what is deployed

```bash
# What the site is currently serving
curl -s https://tld-directory.pages.dev/prices-index.json | head -c 120

# Compare the live dataset with the repository
curl -s https://tld-directory.pages.dev/prices-index.json \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('live:',JSON.parse(d).generated_at))"
node -e "console.log('repo:', require('./data/prices.json').generated_at)"

# Deployment history (newest first, with the commit that was published)
npx wrangler pages deployment list --project-name tld-directory --json
```

The `generated_at` values must match, and the newest deployment's `Source` column must
show the commit you expect. The same check runs automatically at the end of every
workflow run.

## 4. Set the production URL

Canonical tags, `sitemap-index.xml`, `robots.txt` and Open Graph URLs are all derived from
`Astro.site`, which reads `PUBLIC_SITE_URL` (or `SITE_URL`). The daily workflow builds with
`PUBLIC_SITE_URL=https://tld-directory.pages.dev`, so the preview's canonicals, sitemap and
robots.txt all point at the preview host — never at the placeholder.

| Environment | Value |
|---|---|
| Automated price workflow | `https://tld-directory.pages.dev` |
| Local production build | `https://tld-directory.pages.dev` |
| Local dev / tests | *(unset → placeholder `https://tlddirectory.com`)* |

A malformed value (missing scheme, hostname without a dot) aborts the build with
`PUBLIC_SITE_URL must be an absolute http(s) URL…`.

> The placeholder `https://tlddirectory.com` is **not** a confirmed production domain — it
> is only a fallback so local builds and tests work. Do not submit it to Google Search
> Console.

### Redirects

`public/_redirects` is copied to `dist/_redirects` at build time and Cloudflare Pages
applies it at the edge. It currently contains two permanent redirects for category pages
that existed before IANA's 2026 taxonomy change removed the "Sponsored" and "Generic
Restricted" labels:

```
/category/sponsored/  →  /category/generic/   (301)
/category/restricted/  →  /category/generic/   (301)
```

Both destinations are current, generated pages. Edit this file only if you add new routes.

## 5. Verify a deploy

```bash
HOST="https://tld-directory.pages.dev"

curl -sSI "$HOST/"                       # 200
curl -s  "$HOST/robots.txt" | tail -3    # Sitemap + Host must use your domain
curl -s  "$HOST/sitemap-index.xml" | head -3
curl -sI "$HOST/tld/nonexistent-tld/"    # must be 404
curl -s  "$HOST/tld/com/" | grep -o '<link rel="canonical"[^>]*>'
curl -s  "$HOST/prices-index.json" | head -c 120
```

Expected:
- `/` → `200` and contains the price comparison table
- `/tld/com/` → `200` with registrar offers and a canonical of `<host>/tld/com/`
- `/tld/nonexistent-tld/` → `404` (no page is generated for undelegated TLDs)
- `robots.txt` → `Sitemap: <host>/sitemap-index.xml`
- `/prices-index.json` → `generated_at` matching `data/prices.json`

## 6. HTTPS / custom domain

- Cloudflare Pages provisions TLS automatically for `<project>.pages.dev` and for any custom
  domain you attach under **Custom domains**.
- DNS changes are made in the Cloudflare dashboard for the domain. Do not hand-edit DNS for
  a domain you do not control, and do not purchase a domain from this project's tooling.

## 7. Google Search Console

1. Add the property for the production URL (URL-prefix method is simplest).
2. Verify via the DNS TXT record Cloudflare shows, or the HTML tag method.
3. Submit `https://<your-domain>/sitemap-index.xml`.
4. Use **URL Inspection** on `/tld/com/` and `/tlds/` to request indexing.
5. Watch "Pages" for "Discovered – not currently indexed" before assuming a problem: not
   every one of ~1,490 URLs is expected to be indexed, and the site deliberately does not
   attempt to force that.

> **Only submit the production URL to Search Console.** Never add the `*.pages.dev` preview
> host or the placeholder `https://tlddirectory.com`. Mixing origins creates
> duplicate-content signals. Test the preview host with `curl`, not with Search Console.

## 8. Weekly IANA data sync

Runs automatically (`cron: '30 6 * * 1'`, Mondays 06:30 UTC):

```
fetch IANA → validate → npm run build (verify) → npm test
   → commit data/tlds.json + data/meta.json → push to main
```

- **Manual run:** Actions → *Sync TLD Data* → **Run workflow**
- **Failure:** the job exits non-zero, logs are attached as an artifact (`sync-log`,
  30-day retention), and the existing dataset on `main` is left untouched.
- **Idempotent:** re-running against unchanged IANA data produces identical records.
- **Publishing:** this workflow does not deploy. The next daily price run publishes the
  current `main` (including the new IANA data), so an IANA change reaches the live site
  within ~24 hours. Publishing immediately would mean adding a second deploy job — the
  daily workflow is the single publisher by design.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Canonicals point at `tlddirectory.com` | `PUBLIC_SITE_URL` not set in the build | Build with `PUBLIC_SITE_URL=https://tld-directory.pages.dev` (the workflow already does) |
| Workflow fails with "Missing repository secret(s)" | Deployment secrets not configured | Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (3a) |
| Workflow fails with "refusing to publish older data" | The price commit never appeared on `main` | Re-run the workflow; if it persists, check that `main` is not protected against the `github-actions[bot]` push |
| Live site shows older prices | Publish was skipped or the run failed | Compare `generated_at` in the live `/prices-index.json` with `data/prices.json` (3f), then re-run the workflow |
| Deploy succeeds but the site shows the old build | Cloudflare propagation delay | Wait a few seconds and re-check; the workflow's verify step retries for ~100 s |
| `robots.txt` 404s | Old static file removed; endpoint builds it | Redeploy — `dist/robots.txt` is generated |
| Build fails with `PUBLIC_SITE_URL must be…` | Malformed value | Use `https://host.tld`, no trailing slash, no path |
| Sync workflow fails | Source unreachable or layout changed | Check the `sync-prices-log` artifact; the previous dataset stays in place |

## 10. Not done here

- No domain was purchased and no DNS was modified by this project.
- No Cloudflare project was created beyond the existing `tld-directory`; no Git
  integration was enabled, and the deployment style stays direct upload.
- No API tokens were created by this project — the owner creates the token and stores it
  as a repository secret.
- Nothing in the price pipeline invents prices; sources that fail keep their previous
  values and are reported as stale.
