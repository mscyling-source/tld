/**
 * scripts/deploy-decision.ts — decide whether the current build must be
 * published to Cloudflare Pages.
 *
 * Used by `.github/workflows/sync-prices.yml` before it uploads anything, so
 * a daily run that has nothing new to publish does not burn a deployment.
 *
 * Inputs (environment):
 *   CLOUDFLARE_API_TOKEN     required — bearer token with Pages:Edit
 *   CLOUDFLARE_ACCOUNT_ID    required — Cloudflare account id
 *   CLOUDFLARE_PAGES_PROJECT optional — defaults to "tld-directory"
 *   GITHUB_OUTPUT            optional — decision is appended when present
 *
 * Outputs (GITHUB_OUTPUT):
 *   deploy=true|false   whether to publish
 *   reason=<text>       human-readable explanation
 *   code=<reason code>  machine-readable code
 *   head=<sha>          commit that would be published
 *   live=<sha>          commit recorded on the live deployment
 *
 * The token is only ever sent in an Authorization header — it is never
 * printed, logged, or written to disk.
 */

import { execFileSync } from 'node:child_process';
import { decideDeployment, normaliseHash } from '../src/lib/deployDecision.js';

const DEFAULT_PROJECT = 'tld-directory';

function fail(message: string): never {
  console.error(`[deploy-decision] ${message}`);
  process.exit(1);
}

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** True when `ancestor` is an ancestor of `descendant` (older than). */
function isAncestor(ancestor: string, descendant: string): boolean {
  if (!ancestor || !descendant) return false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

interface PagesDeployment {
  id?: string;
  environment?: string;
  url?: string;
  created_on?: string;
  latest_stage?: { status?: string; ended_on?: string };
  deployment_trigger?: {
    type?: string;
    metadata?: { commit_hash?: string; branch?: string; commit_message?: string };
  };
}

async function fetchLiveDeployment(
  accountId: string,
  token: string,
  project: string,
): Promise<{ hash: string | null; url: string | null; id: string | null }> {
  const url =
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}` +
    `/pages/projects/${encodeURIComponent(project)}/deployments?env=production`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Cloudflare API responded ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { success?: boolean; result?: PagesDeployment[] };
  if (!body.success || !Array.isArray(body.result)) {
    throw new Error('Cloudflare API returned an unexpected payload');
  }
  const successful = body.result
    .filter(d => (d.latest_stage?.status ?? '').toLowerCase() === 'success')
    .sort((a, b) => Date.parse(b.latest_stage?.ended_on ?? b.created_on ?? '') - Date.parse(a.latest_stage?.ended_on ?? a.created_on ?? ''));
  const newest = successful[0];
  if (!newest) return { hash: null, url: null, id: null };
  return {
    hash: newest.deployment_trigger?.metadata?.commit_hash ?? null,
    url: newest.url ?? null,
    id: newest.id ?? null,
  };
}

async function main(): Promise<void> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const project = process.env.CLOUDFLARE_PAGES_PROJECT || DEFAULT_PROJECT;

  const missing: string[] = [];
  if (!token) missing.push('CLOUDFLARE_API_TOKEN');
  if (!accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
  if (missing.length > 0) {
    fail(
      'Missing required deployment credential(s): ' +
        missing.join(', ') +
        '. Add them as GitHub Actions repository secrets (Settings → Secrets and variables → ' +
        'Actions → Repository secrets) before the automatic deployment can run. ' +
        'CLOUDFLARE_API_TOKEN: create a token in the Cloudflare dashboard (My Profile → API Tokens) ' +
        'with the "Cloudflare Pages: Edit" permission for this account. ' +
        'CLOUDFLARE_ACCOUNT_ID: the 32-character account id shown in the Cloudflare dashboard sidebar. ' +
        'See docs/DEPLOYMENT.md for the full setup.',
    );
  }

  const head = git(['rev-parse', 'HEAD']);
  if (!head) {
    fail('Could not resolve HEAD — is this a git checkout with full history?');
  }

  let live: { hash: string | null; url: string | null; id: string | null };
  try {
    live = await fetchLiveDeployment(accountId as string, token as string, project);
  } catch (e) {
    fail(
      `Could not read the current deployment state for project "${project}": ` +
        (e instanceof Error ? e.message : String(e)) +
        '. Refusing to guess — the workflow will not publish without knowing what is live.',
    );
  }

  const decision = decideDeployment({
    head,
    live: live.hash,
    isAncestor,
  });

  console.log(`[deploy-decision] project: ${project}`);
  console.log(`[deploy-decision] head commit: ${head}`);
  console.log(
    `[deploy-decision] live deployment: ${live.id ?? 'none'} ` +
      `(${live.url ?? 'no url'}) commit=${normaliseHash(live.hash) || 'unknown'}`,
  );
  console.log(`[deploy-decision] decision: ${decision.action.toUpperCase()} (${decision.code})`);
  console.log(`[deploy-decision] ${decision.reason}`);

  const output = [
    `deploy=${decision.action === 'deploy'}`,
    `reason=${decision.reason.replace(/\n/g, ' ')}`,
    `code=${decision.code}`,
    `head=${head}`,
    `live=${normaliseHash(live.hash)}`,
  ].join('\n');

  if (process.env.GITHUB_OUTPUT) {
    const fs = await import('node:fs/promises');
    await fs.appendFile(process.env.GITHUB_OUTPUT, output + '\n', 'utf-8');
  } else {
    console.log(output);
  }
}

main().catch(e => {
  console.error('[deploy-decision] unexpected error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
