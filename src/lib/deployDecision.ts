/**
 * Deployment decision logic for the automated price-sync pipeline.
 *
 * Pure functions only: no network, no filesystem, no clock. The GitHub
 * Actions workflow supplies the facts (current commit, live deployment's
 * commit) and this module decides whether publishing is necessary.
 *
 * Rules (in order):
 *   1. No live deployment recorded          → publish.
 *   2. Live deployment is the same commit   → skip (already published).
 *   3. Live deployment is a NEWER commit     → skip and warn, so an older
 *      dataset can never overwrite a newer one.
 *   4. Otherwise (live is older or diverged) → publish.
 *
 * Rule 3 is the guard against out-of-order publishing: workflow runs are
 * serialised, and even if that were bypassed, a run holding an older commit
 * refuses to overwrite a newer live deployment.
 */

/** What the workflow should do with the freshly built `dist/`. */
export type DeployAction = 'deploy' | 'skip';

export interface DeployDecisionInput {
  /** Full SHA of the commit that would be published. */
  head: string;
  /**
   * Commit hash recorded on the live production deployment. May be a short
   * hash, a full hash, or empty when the deployment was made without one.
   */
  live: string | null | undefined;
  /**
   * True when `ancestor` is an ancestor of `descendant` (i.e. `ancestor` is
   * older). Implementations must return false for unknown commits.
   */
  isAncestor: (ancestor: string, descendant: string) => boolean;
}

export interface DeployDecision {
  action: DeployAction;
  /** Human-readable explanation, surfaced in the workflow log. */
  reason: string;
  /** Machine-readable reason code. */
  code:
    | 'no-live-deployment'
    | 'already-published'
    | 'live-is-newer'
    | 'live-is-older'
    | 'diverged';
  head: string;
  live: string | null;
}

/** Normalise a commit hash for comparison (trim, lowercase, allow short form). */
export function normaliseHash(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** True when two hashes refer to the same commit (full vs. short form). */
export function sameCommit(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return longer.startsWith(shorter) && shorter.length >= 7;
}

/**
 * Decide whether the current build should be published.
 *
 * Never throws: an unknown live hash falls back to "publish", which is the
 * safe direction (a redundant deploy is harmless; a skipped deploy leaves
 * the site stale).
 */
export function decideDeployment(input: DeployDecisionInput): DeployDecision {
  const head = normaliseHash(input.head);
  const live = normaliseHash(input.live) || null;

  if (!head) {
    return {
      action: 'deploy',
      code: 'no-live-deployment',
      reason: 'Could not determine the current commit — publishing to be safe.',
      head,
      live,
    };
  }

  if (!live) {
    return {
      action: 'deploy',
      code: 'no-live-deployment',
      reason:
        'No commit recorded on the live production deployment — publishing the current build.',
      head,
      live,
    };
  }

  if (sameCommit(head, live)) {
    return {
      action: 'skip',
      code: 'already-published',
      reason: `The live deployment already publishes this commit (${live}) — skipping.`,
      head,
      live,
    };
  }

  // Live is newer than what we hold → publishing would regress the site.
  if (input.isAncestor(head, live)) {
    return {
      action: 'skip',
      code: 'live-is-newer',
      reason:
        `The live deployment (${live}) already contains this commit (${head}) — ` +
        'skipping to avoid publishing an older dataset over a newer one.',
      head,
      live,
    };
  }

  if (input.isAncestor(live, head)) {
    return {
      action: 'deploy',
      code: 'live-is-older',
      reason: `The live deployment (${live}) is older than the current commit (${head}) — publishing.`,
      head,
      live,
    };
  }

  return {
    action: 'deploy',
    code: 'diverged',
    reason:
      `The live deployment (${live}) is not related to the current commit (${head}) — ` +
      'publishing the current main branch.',
    head,
    live,
  };
}
