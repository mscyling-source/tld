/**
 * Workflow contract tests.
 *
 * These parse `.github/workflows/sync-prices.yml` and assert the properties
 * the automation depends on. Most of them are static checks on the workflow
 * file — they do NOT execute GitHub Actions, and they cannot prove that a run
 * succeeds on GitHub's infrastructure. The behavioural section at the bottom
 * goes further by extracting the workflow's inline programs and running them
 * against throwaway fixtures, but it still runs them on a laptop rather than
 * on GitHub's runners.
 *
 * The properties asserted here are the ones that silently break the daily
 * publish loop if someone edits the YAML:
 *   - the workflow must not trigger itself (no `push` trigger)
 *   - runs must be serialised (concurrency without cancel-in-progress)
 *   - the deploy job must depend on the sync job
 *   - the build must use the preview origin and precede the deploy
 *   - the deploy must target the existing project/branch via wrangler
 *   - credentials must come from secrets and must never be printed
 *   - a report-only change must still be committed
 *   - the published report must agree with the published dataset
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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

  it('rejects provenance that a download timestamp could have faked', () => {
    const runs = stepsOf(syncJob)
      .map(s => s.run ?? '')
      .join('\n');
    // schema v2 is required, and the two provenance invariants are enforced:
    expect(runs).toContain('schema_version !== 2');
    expect(runs).toContain("o.verification_status === 'verified' && !o.price_verified_at");
    expect(runs).toContain("o.verification_status !== 'verified' && o.price_verified_at");
    expect(runs).toContain('o.last_checked !== evidence');
  });

  it('publishes the sync report to the run summary and as an artefact', () => {
    const runs = stepsOf(syncJob)
      .map(s => s.run ?? '')
      .join('\n');
    expect(runs).toContain('data/price-sync-report.md');
    expect(runs).toContain('GITHUB_STEP_SUMMARY');

    const upload = findStep(syncJob, s => s.uses?.startsWith('actions/upload-artifact'));
    expect(upload).toBeDefined();
    const paths = String(upload.with.path);
    expect(paths).toContain('data/price-sync-report.json');
    expect(paths).toContain('data/price-sync-report.md');
  });

  it('uploads the log and report even when the sync or validation failed', () => {
    const upload = findStep(syncJob, s => s.uses?.startsWith('actions/upload-artifact'));
    // `always()` keeps the diagnostics for exactly the runs that need them.
    expect(upload.if).toBe('always()');
    // A missing file must not turn into a second, confusing failure.
    expect(upload.with['if-no-files-found']).toBe('warn');
  });

  it('refuses to publish a report that disagrees with the dataset', () => {
    const verify = findStep(syncJob, s => (s.run ?? '').includes('Report matches dataset'));
    expect(verify).toBeDefined();
    const run: string = verify.run;
    expect(run).toContain('price-sync-report.json');
    expect(run).toContain('r.dataset_generated_at !== d.generated_at');
    expect(run).toContain("r.totals.offers !== d.offers.length");
    // Every tier and every freshness band is recounted from prices.json.
    expect(run).toContain("['verified', 'source_snapshot', 'model_derived', 'unverified']");
    expect(run).toContain("['recent', 'aging', 'stale', 'unknown']");
  });

  it('commits the price data and the report that describes it', () => {
    const run = stepsOf(syncJob)
      .map(s => s.run ?? '')
      .join('\n');
    expect(run).toContain('git add data/prices.json data/prices-meta.json');
    expect(run).toContain('data/price-sync-report.json');
    expect(run).toContain('data/price-sync-report.md');
    expect(run).toMatch(/git push origin HEAD:main/);
  });

  it('detects report-only changes, not just price-row changes', () => {
    const check = findStep(syncJob, s => s.id === 'changes');
    expect(check).toBeDefined();
    const run: string = check.run;
    // porcelain catches a modified report and an untracked one, unlike `diff`.
    expect(run).toContain('git status --porcelain --');
    for (const path of [
      'data/prices.json',
      'data/prices-meta.json',
      'data/price-sync-report.json',
      'data/price-sync-report.md',
    ]) {
      expect(run).toContain(path);
    }
    expect(run).toContain('changed=true');
    expect(run).toContain('changed=false');
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

  it('keeps an evidence date on every offer so freshness never depends on the build', () => {
    for (const offer of dataset.offers) {
      if (dataset.schema_version === 2) {
        // v2: last_checked is the evidence alias and must agree with provenance.
        const evidence = offer.price_verified_at || offer.price_observed_at || '';
        expect(offer.last_checked).toBe(evidence);
        if (offer.verification_status !== 'unverified') {
          expect(Number.isNaN(Date.parse(evidence))).toBe(false);
        }
      } else {
        expect(offer.last_checked).toBeTruthy();
        expect(Number.isNaN(Date.parse(offer.last_checked))).toBe(false);
      }
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

/* ========================================================================== *
 * Behavioural contract tests
 *
 * Everything above asserts that the YAML *mentions* the right things, which a
 * script can satisfy while still being wrong. The tests below lift the inline
 * programs out of the workflow file and execute them:
 *
 *   - the change-detection shell program runs in a throwaway git repo, so
 *     "a report-only change is detected" is proven by actually dirtying a
 *     report file and reading the `changed=` output;
 *   - the two `node -e` validators run against temporary fixture datasets, so
 *     "a wrong tier count is rejected" is proven by a non-zero exit status and
 *     the specific error line, not by grepping for the word `verified`.
 *
 * No test reads or writes the real `data/` directory, and none needs GitHub
 * or Cloudflare credentials — every fixture lives in a fresh mkdtemp directory
 * that is removed afterwards.
 * ========================================================================== */

const TIERS = ['verified', 'source_snapshot', 'model_derived', 'unverified'] as const;
const BANDS = ['recent', 'aging', 'stale', 'unknown'] as const;

/** The four files the workflow must notice, commit and validate together. */
const TRACKED_PATHS = [
  'data/prices.json',
  'data/prices-meta.json',
  'data/price-sync-report.json',
  'data/price-sync-report.md',
] as const;

const FIXTURE_GENERATED_AT = '2026-10-22T10:29:22.133Z';

function syncStep(label: string): any {
  const step = findStep(syncJob, s => s.name === label);
  if (!step) {
    throw new Error(
      `workflow step "${label}" is missing — the contract tests below depend on it by name`,
    );
  }
  return step;
}

/**
 * Pull the program out of a step that runs `node -e "` … `"`.
 *
 * Throwing on a miss is deliberate: if a future refactor changes the quoting,
 * every behavioural test would silently become vacuous. Failing loudly here is
 * the whole point of a contract test.
 */
function inlineNodeScript(step: any, label: string): string {
  const lines = String(step?.run ?? '').split('\n');
  const start = lines.findIndex(line => /node\s+-e\s+"\s*$/.test(line.trimEnd()));
  if (start === -1) throw new Error(`no inline node program found in step: ${label}`);
  const end = lines.findIndex((line, index) => index > start && line.trim() === '"');
  if (end === -1) throw new Error(`unterminated inline node program in step: ${label}`);
  return lines.slice(start + 1, end).join('\n');
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.status}): ${result.stderr}`);
  }
  return String(result.stdout ?? '');
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a temp directory that will not delete must not fail the suite */
  }
}

function fixtureOffer(
  index: number,
  verification: string,
  freshness: string,
  verifiedAt: string | null,
  observedAt: string | null,
) {
  return {
    registrar_id: 'porkbun',
    tld: `t${index}.test`,
    currency: 'USD',
    register_usd: 10,
    renewal_usd: 12,
    transfer_usd: 11,
    verification_status: verification,
    freshness,
    price_verified_at: verifiedAt,
    price_observed_at: observedAt,
    // The compatibility alias must always be the evidence date, never a fetch
    // date — the workflow's dataset check enforces exactly this.
    last_checked: verifiedAt ?? observedAt ?? '',
    source_status_stale: freshness === 'stale',
  };
}

/**
 * 520 offers, evenly spread across all four tiers and all four bands, and
 * consistent with every invariant the dataset check enforces (verified rows
 * carry a verification date, snapshots never do, undated rows are unverified).
 */
function fixtureOffers(count = 520): any[] {
  const offers: any[] = [];
  for (let index = 0; index < count; index += 1) {
    switch (index % 4) {
      case 0:
        offers.push(fixtureOffer(index, 'verified', 'recent', FIXTURE_GENERATED_AT, null));
        break;
      case 1:
        offers.push(fixtureOffer(index, 'source_snapshot', 'stale', null, '2026-05-12T00:00:00.000Z'));
        break;
      case 2:
        offers.push(fixtureOffer(index, 'model_derived', 'aging', null, '2026-10-15T00:00:00.000Z'));
        break;
      default:
        offers.push(fixtureOffer(index, 'unverified', 'unknown', null, null));
        break;
    }
  }
  return offers;
}

function fixtureDataset(offers: any[] = fixtureOffers()) {
  return {
    schema_version: 2,
    generated_at: FIXTURE_GENERATED_AT,
    currency: 'USD',
    offers,
    sources: [
      { id: 'porkbun', name: 'Porkbun', license: 'first-party', attribution: null },
      {
        id: 'bdr',
        name: 'Best Domain Registrars',
        license: 'CC BY 4.0',
        attribution: 'Best Domain Registrars (CC BY 4.0)',
      },
    ],
  };
}

/** A report that agrees with the dataset it is derived from. */
function fixtureReport(dataset: any) {
  const count = (key: string, value: string) =>
    dataset.offers.filter((offer: any) => offer[key] === value).length;
  return {
    run_at: dataset.generated_at,
    dataset_generated_at: dataset.generated_at,
    schema_version: dataset.schema_version,
    totals: {
      offers: dataset.offers.length,
      by_verification: Object.fromEntries(TIERS.map(tier => [tier, count('verification_status', tier)])),
      by_freshness: Object.fromEntries(BANDS.map(band => [band, count('freshness', band)])),
    },
    sources: [],
    significant_changes: [],
    degraded_sources: [],
    summary: 'fixture',
  };
}

function fixtureMeta(dataset: any) {
  const count = (key: string, value: string) =>
    dataset.offers.filter((offer: any) => offer[key] === value).length;
  return {
    generated_at: dataset.generated_at,
    last_success_at: dataset.generated_at,
    status: 'ok',
    counts: {
      offers: dataset.offers.length,
      tlids: dataset.offers.length,
      registrars: 1,
      // One counter per band, matching what the sync writes. The workflow
      // checks these against the dataset, so a fixture that omitted them (or
      // folded `unknown` into `stale`) would make the check vacuous.
      verified_offers: count('verification_status', 'verified'),
      recent_offers: count('freshness', 'recent'),
      aging_offers: count('freshness', 'aging'),
      stale_offers: count('freshness', 'stale'),
      unknown_offers: count('freshness', 'unknown'),
      by_source: {},
      by_verification: Object.fromEntries(
        TIERS.map(tier => [tier, count('verification_status', tier)]),
      ),
    },
  };
}

interface FixtureFiles {
  dataset?: any;
  report?: any;
  meta?: any;
  markdown?: string | null;
}

function writeFixture(dir: string, files: FixtureFiles = {}) {
  const dataset = files.dataset ?? fixtureDataset();
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  writeFileSync(path.join(dir, 'data/prices.json'), JSON.stringify(dataset, null, 2));
  writeFileSync(
    path.join(dir, 'data/prices-meta.json'),
    JSON.stringify(files.meta ?? fixtureMeta(dataset), null, 2),
  );
  writeFileSync(
    path.join(dir, 'data/price-sync-report.json'),
    JSON.stringify(files.report ?? fixtureReport(dataset), null, 2),
  );
  const markdown = files.markdown === undefined ? '# Price sync report\n' : files.markdown;
  if (markdown !== null) {
    writeFileSync(path.join(dir, 'data/price-sync-report.md'), markdown);
  }
  return dataset;
}

/** Read the fixture back out, let a test break one thing, write it back. */
function mutateFixture(
  dir: string,
  mutate: (fixture: { dataset: any; report: any; meta: any }) => void,
): void {
  const read = (name: string) => JSON.parse(readFileSync(path.join(dir, 'data', name), 'utf8'));
  const fixture = {
    dataset: read('prices.json'),
    report: read('price-sync-report.json'),
    meta: read('prices-meta.json'),
  };
  mutate(fixture);
  writeFileSync(path.join(dir, 'data/prices.json'), JSON.stringify(fixture.dataset, null, 2));
  writeFileSync(
    path.join(dir, 'data/price-sync-report.json'),
    JSON.stringify(fixture.report, null, 2),
  );
  writeFileSync(path.join(dir, 'data/prices-meta.json'), JSON.stringify(fixture.meta, null, 2));
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Execute a step's inline `node -e` program in a temporary fixture directory. */
function runInlineStep(
  step: any,
  label: string,
  prepare?: (dir: string) => void,
): RunResult {
  const script = inlineNodeScript(step, label);
  const dir = mkdtempSync(path.join(tmpdir(), 'tld-wf-'));
  try {
    writeFixture(dir);
    prepare?.(dir);
    const result = spawnSync(process.execPath, ['-e', script], { cwd: dir, encoding: 'utf8' });
    return {
      status: result.status ?? -1,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    };
  } finally {
    cleanup(dir);
  }
}

describe('change detection — the real shell program, run in a throwaway repo', () => {
  function repoWith(extra: Record<string, string> = {}): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'tld-changes-'));
    const files: Record<string, string> = {
      'data/prices.json': '{"offers":[]}\n',
      'data/prices-meta.json': '{}\n',
      'data/price-sync-report.json': '{}\n',
      'data/price-sync-report.md': '# report\n',
      'README.md': 'fixture\n',
      ...extra,
    };
    for (const [relative, content] of Object.entries(files)) {
      const absolute = path.join(dir, relative);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, content);
    }
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'workflow-test@example.com']);
    git(dir, ['config', 'user.name', 'Workflow Test']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'fixture']);
    return dir;
  }

  /** Run the step's `run:` block verbatim and read back `$GITHUB_OUTPUT`. */
  function runChangeCheck(dir: string): string {
    const outputFile = `${dir}.github-output`;
    writeFileSync(outputFile, '');
    const result = spawnSync('bash', ['-c', String(syncStep('Check for changes').run)], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: outputFile },
    });
    expect(result.status, String(result.stderr)).toBe(0);
    const written = readFileSync(outputFile, 'utf8');
    const match = /changed=(true|false)/.exec(written);
    expect(match, `no changed= written to $GITHUB_OUTPUT; got: ${written}`).toBeTruthy();
    return match![1];
  }

  it('reports no change when nothing in the four tracked paths moved', () => {
    const dir = repoWith();
    try {
      expect(runChangeCheck(dir)).toBe('false');
    } finally {
      cleanup(dir);
    }
  });

  for (const tracked of TRACKED_PATHS) {
    it(`detects a change to ${tracked}`, () => {
      const dir = repoWith();
      try {
        writeFileSync(path.join(dir, tracked), '{"mutated":true}\n');
        expect(runChangeCheck(dir)).toBe('true');
      } finally {
        cleanup(dir);
      }
    });
  }

  it('treats a report-only change as commit-worthy, where `git diff` saw nothing', () => {
    // The regression this guards: prices.json and prices-meta.json are
    // untouched, so the old check concluded "nothing to do" and the report
    // rotted in the repository.
    const dir = repoWith();
    try {
      writeFileSync(path.join(dir, 'data/price-sync-report.md'), '# rewritten report\n');

      const oldCheck = spawnSync(
        'git',
        ['diff', '--quiet', '--', 'data/prices.json', 'data/prices-meta.json'],
        { cwd: dir, encoding: 'utf8' },
      );
      expect(oldCheck.status, 'the old check must be blind to a report-only change').toBe(0);

      expect(runChangeCheck(dir)).toBe('true');
    } finally {
      cleanup(dir);
    }
  });

  it('catches a report that is not tracked yet, which `git diff` cannot see', () => {
    const dir = repoWith();
    try {
      // Simulate the first run after the report file was introduced.
      git(dir, ['rm', '--cached', '-q', 'data/price-sync-report.md']);
      git(dir, ['commit', '-q', '-m', 'drop report from the index']);
      writeFileSync(path.join(dir, 'data/price-sync-report.md'), '# regenerated\n');
      expect(runChangeCheck(dir)).toBe('true');
    } finally {
      cleanup(dir);
    }
  });

  it('ignores edits outside the four tracked paths', () => {
    const dir = repoWith();
    try {
      writeFileSync(path.join(dir, 'README.md'), 'an unrelated edit\n');
      expect(runChangeCheck(dir)).toBe('false');
    } finally {
      cleanup(dir);
    }
  });
});

describe('commit gating — no commit unless something actually changed', () => {
  it('commits only when the change check reported a change and the sync succeeded', () => {
    const commit = syncStep('Commit and push changes');
    expect(String(commit.if)).toContain("steps.changes.outputs.changed == 'true'");
    expect(String(commit.if)).toContain("steps.sync.outputs.exit_code == '0'");
  });

  it('stages all four tracked files so a detected change is never left behind', () => {
    // The `git add` in the workflow is wrapped across lines with `\`, so join
    // the continuations before looking for a single command.
    const run = String(syncStep('Commit and push changes').run).replace(/\\\s*\n\s*/g, ' ');
    const addLine = run.split('\n').find(line => line.includes('git add')) ?? '';
    for (const tracked of TRACKED_PATHS) {
      expect(addLine, `${tracked} must be staged by the commit step`).toContain(tracked);
    }
    expect(run).toContain('git push origin HEAD:main');
  });
});

describe('report/dataset validation — the real node program, run against fixtures', () => {
  function check(prepare?: (dir: string) => void): RunResult {
    return runInlineStep(syncStep('Verify report matches dataset'), 'Verify report matches dataset', prepare);
  }

  it('accepts a report that agrees with the dataset', () => {
    const result = check();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Report matches dataset');
  });

  it('rejects a report whose offer count differs from the dataset', () => {
    const result = check(dir =>
      mutateFixture(dir, fixture => {
        fixture.report.totals.offers += 1;
      }),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Report offers');
  });

  for (const tier of TIERS) {
    it(`rejects a wrong ${tier} verification count`, () => {
      const result = check(dir =>
        mutateFixture(dir, fixture => {
          fixture.report.totals.by_verification[tier] += 1;
        }),
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`Report ${tier} count`);
    });
  }

  for (const band of BANDS) {
    it(`rejects a wrong ${band} freshness count`, () => {
      const result = check(dir =>
        mutateFixture(dir, fixture => {
          fixture.report.totals.by_freshness[band] += 1;
        }),
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`Report ${band} count`);
    });
  }

  it('rejects a mismatched schema_version', () => {
    const result = check(dir =>
      mutateFixture(dir, fixture => {
        fixture.report.schema_version = 1;
      }),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Report schema_version');
  });

  it('rejects a report describing a different dataset generation', () => {
    const result = check(dir =>
      mutateFixture(dir, fixture => {
        fixture.report.dataset_generated_at = '2026-10-21T00:00:00.000Z';
      }),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Report describes dataset');
  });

  it('rejects a missing markdown report', () => {
    const result = check(dir => {
      rmSync(path.join(dir, 'data/price-sync-report.md'), { force: true });
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('price-sync-report.md was not written');
  });
});

describe('dataset validation — the real node program, run against fixtures', () => {
  function check(prepare?: (dir: string) => void): RunResult {
    return runInlineStep(syncStep('Verify dataset'), 'Verify dataset', prepare);
  }

  it('accepts a plausible schema-v2 dataset', () => {
    const result = check();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Price dataset OK');
  });

  it('rejects an implausibly small dataset', () => {
    const result = check(dir =>
      mutateFixture(dir, fixture => {
        fixture.dataset.offers = fixture.dataset.offers.slice(0, 10);
      }),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('implausibly small');
  });

  it('rejects a verified offer with no verification date', () => {
    const result = check(dir =>
      mutateFixture(dir, fixture => {
        const offer = fixture.dataset.offers.find(
          (candidate: any) => candidate.verification_status === 'verified',
        );
        offer.price_verified_at = null;
        offer.last_checked = offer.price_observed_at ?? '';
      }),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('without a verification date');
  });

  it('rejects a snapshot that claims a verification date', () => {
    const result = check(dir =>
      mutateFixture(dir, fixture => {
        const offer = fixture.dataset.offers.find(
          (candidate: any) => candidate.verification_status === 'source_snapshot',
        );
        offer.price_verified_at = '2026-10-22T00:00:00.000Z';
        offer.last_checked = offer.price_verified_at;
      }),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('claims a verification date');
  });

  it('rejects a last_checked that is not the evidence date', () => {
    const result = check(dir =>
      mutateFixture(dir, fixture => {
        // A fetch timestamp masquerading as the check date.
        fixture.dataset.offers[0].last_checked = '2026-10-22T23:59:59.000Z';
      }),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('does not match the offer provenance');
  });

  it('rejects prices-meta counts that fold unknown offers into stale', () => {
    const result = check(dir =>
      mutateFixture(dir, fixture => {
        // The exact bug this check exists to catch: `stale + unknown` published
        // under the `stale_offers` key made prices-meta.json disagree with both
        // the dataset and the sync report.
        fixture.meta.counts.stale_offers += fixture.meta.counts.unknown_offers;
      }),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('stale_offers');
  });

  it('rejects a verified_offers count that disagrees with the dataset', () => {
    const result = check(dir =>
      mutateFixture(dir, fixture => {
        fixture.meta.counts.verified_offers += 1;
      }),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('verified_offers');
  });

  it('rejects a meta offer count that disagrees with the dataset', () => {
    const result = check(dir =>
      mutateFixture(dir, fixture => {
        fixture.meta.counts.offers -= 1;
      }),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('offers, dataset has');
  });
});

describe('artefact upload — diagnostics survive a failed run', () => {
  const upload = findStep(syncJob, s => String(s.uses ?? '').startsWith('actions/upload-artifact'));

  it('uploads the sync log and both report formats', () => {
    expect(upload).toBeDefined();
    const paths = String(upload.with.path);
    expect(paths).toContain('sync-prices-output.log');
    expect(paths).toContain('data/price-sync-report.json');
    expect(paths).toContain('data/price-sync-report.md');
  });

  it('is not gated on the sync or validation succeeding', () => {
    expect(upload.if).toBe('always()');
    // The failure mode this guards against: gating the upload on success, so
    // the run that needs the log is exactly the run that loses it.
    expect(String(upload.if)).not.toContain('exit_code');
    expect(String(upload.if)).not.toContain('success()');
  });

  it('runs before the validation steps that can fail', () => {
    const steps = stepsOf(syncJob);
    const syncIndex = steps.indexOf(syncStep('Run price sync'));
    const uploadIndex = steps.indexOf(upload);
    const datasetIndex = steps.indexOf(syncStep('Verify dataset'));
    const reportIndex = steps.indexOf(syncStep('Verify report matches dataset'));
    expect(syncIndex).toBeGreaterThanOrEqual(0);
    expect(uploadIndex).toBeGreaterThan(syncIndex);
    expect(uploadIndex).toBeLessThan(datasetIndex);
    expect(uploadIndex).toBeLessThan(reportIndex);
  });

  it('warns instead of failing the step when the artefacts are missing', () => {
    expect(upload.with['if-no-files-found']).toBe('warn');
    expect(upload.with['if-no-files-found']).not.toBe('error');
    expect(upload['continue-on-error']).toBeUndefined();
  });
});

describe('deployment gating — nothing publishes after a failed sync or report check', () => {
  it('declares the deploy job as dependent on the sync job', () => {
    const needs = Array.isArray(deployJob.needs) ? deployJob.needs : [deployJob.needs];
    expect(needs).toContain('sync');
  });

  it('does not make the deploy job run unconditionally', () => {
    // A job-level `always()`/`failure()` would let a failed sync still publish.
    const condition = String(deployJob.if ?? '');
    expect(condition).not.toContain('always()');
    expect(condition).not.toContain('failure()');
    expect(condition).not.toContain('cancelled()');
  });

  it('gates the deploy step itself on the deployment decision', () => {
    expect(String(findDeployStep(deployJob).if)).toContain("steps.decide.outputs.deploy == 'true'");
  });

  it('lets no validation step continue on error', () => {
    for (const label of [
      'Verify dataset',
      'Verify report matches dataset',
      'Run unit tests',
      'Check for changes',
    ]) {
      const step = syncStep(label);
      expect(step['continue-on-error'], `${label} must not tolerate its own failure`).toBeUndefined();
      // Each is skipped rather than tolerated when the sync itself failed.
      expect(String(step.if)).toContain("steps.sync.outputs.exit_code == '0'");
    }
  });

  it('fails the sync job when the sync failed, so the deploy job never starts', () => {
    const fail = syncStep('Fail job on sync error');
    expect(String(fail.if)).toContain("steps.sync.outputs.exit_code != '0'");
    expect(String(fail.run)).toContain('exit 1');
  });
});

describe('publishing safeguards are retained', () => {
  it('triggers only on a schedule and on manual dispatch', () => {
    expect(Object.keys(triggers).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(triggers.schedule[0].cron).toMatch(/^\d+ \d+ \* \* \*$/);
  });

  it('cannot retrigger itself from the commit it pushes', () => {
    // The workflow pushes a data commit to main. Without a `push` trigger that
    // push cannot start another run, so there is no commit loop.
    expect(String(syncStep('Commit and push changes').run)).toContain('git push origin HEAD:main');
    expect(triggers.push).toBeUndefined();
    expect(triggers.pull_request).toBeUndefined();
  });

  it('still serialises runs so two publishes cannot interleave', () => {
    expect(wf.concurrency.group).toBe('sync-prices');
    expect(wf.concurrency['cancel-in-progress']).toBe(false);
  });
});
