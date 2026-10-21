/**
 * Workflow contract tests.
 *
 * These parse `.github/workflows/sync-prices.yml` and assert the properties
 * the automation depends on. They are static checks on the workflow file —
 * they do NOT execute GitHub Actions, and they cannot prove that a run
 * succeeds on GitHub's infrastructure.
 *
 * The properties asserted here are the ones that silently break the daily
 * publish loop if someone edits the YAML:
 *   - the workflow must not trigger itself (no `push` trigger)
 *   - runs must be serialised (concurrency without cancel-in-progress)
 *   - the deploy job must depend on the sync job
 *   - the build must use the preview origin and precede the deploy
 *   - the deploy must target the existing project/branch via wrangler
 *   - credentials must come from secrets and must never be printed
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

const WORKFLOW_PATH = path.resolve(process.cwd(), '.github/workflows/sync-prices.yml');
const raw = readFileSync(WORKFLOW_PATH, 'utf-8');
const wf = parse(raw) as Record<string, any>;

/**
 * GitHub's `on:` key can be parsed as the boolean `true` by YAML 1.1 parsers.
 * Object keys are strings in JS, so look the boolean form up as "true".
 */
const wfRecord = wf as Record<string, any>;
const triggers = (wfRecord.on ?? wfRecord[String(true)] ?? {}) as Record<string, any>;
const jobs = wf.jobs as Record<string, any>;
const syncJob = jobs.sync;
const deployJob = jobs.deploy;

function stepsOf(job: any): any[] {
  return (job?.steps ?? []) as any[];
}

function findStep(job: any, predicate: (s: any) => boolean): any | undefined {
  return stepsOf(job).find(predicate);
}

/**
 * The publishing step runs a *pinned* wrangler (`npx wrangler@x.y.z`).
 * Matching on the version pin avoids confusing it with other steps that
 * merely mention a manual wrangler command in their help text.
 */
function findDeployStep(job: any): any | undefined {
  return findStep(
    job,
    s => /wrangler@[\d.]+/.test(s.run ?? '') && (s.run ?? '').includes('pages deploy'),
  );
}

describe('sync-prices workflow — triggers and concurrency', () => {
  it('runs on a daily schedule and on manual dispatch', () => {
    expect(Array.isArray(triggers.schedule)).toBe(true);
    expect(triggers.schedule.length).toBeGreaterThan(0);
    expect(triggers.schedule[0].cron).toMatch(/^\d+ \d+ \* \* \*$/);
    expect(triggers.workflow_dispatch).toBeDefined();
  });

  it('has no push trigger — the workflow commits to main and must not retrigger itself', () => {
    expect(triggers.push).toBeUndefined();
    expect(triggers.pull_request).toBeUndefined();
  });

  it('serialises runs instead of cancelling them, so publishes cannot interleave', () => {
    expect(wf.concurrency).toBeDefined();
    expect(wf.concurrency.group).toBe('sync-prices');
    expect(wf.concurrency['cancel-in-progress']).toBe(false);
  });

  it('keeps write permission scoped to contents for the data commit', () => {
    expect(wf.permissions.contents).toBe('write');
  });
});

describe('sync-prices workflow — sync job', () => {
  it('runs the price sync and the test suite', () => {
    const runs = stepsOf(syncJob)
      .map(s => s.run ?? '')
      .join('\n');
    expect(runs).toContain('npm run sync:prices');
    expect(runs).toContain('npm test');
  });

  it('validates the dataset before anything is published', () => {
    const runs = stepsOf(syncJob)
      .map(s => s.run ?? '')
      .join('\n');
    expect(runs).toContain('data/prices.json');
    expect(runs).toMatch(/offers\.length < 500/);
    expect(runs).toContain('last_success_at');
  });

  it('commits only the price data files and pushes them to main', () => {
    const run = stepsOf(syncJob)
      .map(s => s.run ?? '')
      .join('\n');
    expect(run).toContain('git add data/prices.json data/prices-meta.json');
    expect(run).toMatch(/git push origin HEAD:main/);
  });

  it('exposes the change flag and the pushed commit to the deploy job', () => {
    expect(syncJob.outputs.changed).toBeDefined();
    expect(syncJob.outputs.pushed_commit).toBeDefined();
  });
});

describe('sync-prices workflow — deploy job', () => {
  it('only runs after the sync job succeeded', () => {
    expect(deployJob).toBeDefined();
    const needs = Array.isArray(deployJob.needs) ? deployJob.needs : [deployJob.needs];
    expect(needs).toContain('sync');
  });

  it('does not re-run the sync (single source of price data)', () => {
    const runs = stepsOf(deployJob)
      .map(s => s.run ?? '')
      .join('\n');
    expect(runs).not.toContain('npm run sync:prices');
  });

  it('builds with the preview origin and before the deploy step', () => {
    const steps = stepsOf(deployJob);
    const build = findStep(deployJob, s => (s.run ?? '').includes('npm run build'));
    const deploy = findDeployStep(deployJob);
    expect(build).toBeDefined();
    expect(deploy).toBeDefined();
    expect(steps.indexOf(build)).toBeLessThan(steps.indexOf(deploy));
    expect(build.env.PUBLIC_SITE_URL).toBe('https://tld-directory.pages.dev');
  });

  it('publishes with wrangler to the existing project and production branch', () => {
    const deploy = findDeployStep(deployJob);
    const run: string = deploy.run;
    expect(run).toMatch(/wrangler@[\d.]+/);
    expect(run).toContain('pages deploy dist');
    expect(run).toContain('--project-name tld-directory');
    expect(run).toContain('--branch main');
    expect(run).toContain('--commit-hash');
  });

  it('gates the deploy on the decision step', () => {
    const deploy = findDeployStep(deployJob);
    expect(deploy.if).toContain("steps.decide.outputs.deploy == 'true'");
  });

  it('reads credentials from secrets and never prints them', () => {
    const envs = stepsOf(deployJob)
      .map(s => s.env ?? {})
      .filter(e => e && Object.keys(e).length);
    const allEnv = JSON.stringify(envs);
    expect(allEnv).toContain('secrets.CLOUDFLARE_API_TOKEN');
    expect(allEnv).toContain('secrets.CLOUDFLARE_ACCOUNT_ID');

    // No step may echo a credential value.
    for (const step of stepsOf(deployJob)) {
      const run: string = step.run ?? '';
      expect(run).not.toMatch(/echo[^\n]*\$\{?CLOUDFLARE_API_TOKEN/);
      expect(run).not.toMatch(/echo[^\n]*\$\{?CLOUDFLARE_ACCOUNT_ID/);
    }
    expect(raw).not.toMatch(/CLOUDFLARE_API_TOKEN\s*[:=]\s*["'][A-Za-z0-9_-]{10,}/);
  });

  it('fails with an actionable message when credentials are missing', () => {
    const creds = findStep(deployJob, s => (s.run ?? '').includes('CLOUDFLARE_API_TOKEN'));
    expect(creds).toBeDefined();
    expect(creds.run).toContain('::error::');
    expect(creds.run).toContain('CLOUDFLARE_API_TOKEN');
    expect(creds.run).toContain('CLOUDFLARE_ACCOUNT_ID');
    expect(creds.run).toMatch(/Repository secrets|Secrets and variables/);
  });

  it('verifies the live site after publishing', () => {
    const verify = findStep(deployJob, s => (s.run ?? '').includes('tld-directory.pages.dev'));
    expect(verify).toBeDefined();
    expect(verify.run).toContain('prices-index.json');
  });
});

describe('price dataset satisfies the workflow contract', () => {
  const dataset = JSON.parse(readFileSync(path.resolve(process.cwd(), 'data/prices.json'), 'utf-8'));
  const meta = JSON.parse(
    readFileSync(path.resolve(process.cwd(), 'data/prices-meta.json'), 'utf-8'),
  );

  it('is large enough to satisfy the workflow threshold', () => {
    expect(dataset.offers.length).toBeGreaterThanOrEqual(500);
    expect(meta.last_success_at).toBeTruthy();
  });

  it('keeps licence attribution for every source that requires it', () => {
    for (const source of dataset.sources) {
      if (/CC[ -]?BY/i.test(source.license)) {
        expect(source.attribution).toBeTruthy();
      }
    }
  });

  it('keeps a check date on every offer so freshness never depends on the build', () => {
    for (const offer of dataset.offers) {
      expect(offer.last_checked).toBeTruthy();
      expect(Number.isNaN(Date.parse(offer.last_checked))).toBe(false);
    }
  });

  it('never stores a missing price as zero', () => {
    for (const offer of dataset.offers) {
      for (const field of ['register_usd', 'renewal_usd', 'transfer_usd'] as const) {
        const value = offer[field];
        if (value !== null) expect(value).toBeGreaterThan(0);
      }
    }
  });
});
