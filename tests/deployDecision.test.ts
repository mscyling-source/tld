/**
 * Deployment decision logic tests.
 *
 * These cover the rules that decide whether a build is published:
 * never publish over a newer live deployment, never publish twice, and
 * always publish when the state is unknown.
 */

import { describe, it, expect } from 'vitest';
import {
  decideDeployment,
  sameCommit,
  normaliseHash,
  type DeployDecision,
} from '../src/lib/deployDecision.js';

const HEAD = '9871465cf97341138e42f1b0fdf46f1f8035bf41';
const HEAD_SHORT = '9871465';

/** Fake ancestry: `ancestors` is a set of commits known to be older than HEAD. */
function makeIsAncestor(ancestors: string[] = []) {
  return (ancestor: string, descendant: string): boolean => {
    if (ancestor === descendant) return false;
    return ancestors.includes(ancestor) && descendant === HEAD;
  };
}

function decide(live: string | null | undefined, ancestors: string[] = []): DeployDecision {
  return decideDeployment({
    head: HEAD,
    live,
    isAncestor: makeIsAncestor(ancestors),
  });
}

describe('normaliseHash / sameCommit', () => {
  it('trims and lowercases', () => {
    expect(normaliseHash('  9871465CF  ')).toBe('9871465cf');
    expect(normaliseHash(null)).toBe('');
  });

  it('treats short and full hashes of the same commit as equal', () => {
    expect(sameCommit(HEAD, HEAD_SHORT)).toBe(true);
    expect(sameCommit(HEAD_SHORT, HEAD)).toBe(true);
    expect(sameCommit(HEAD, '40abef5')).toBe(false);
    expect(sameCommit('', HEAD)).toBe(false);
    expect(sameCommit('abc', '')).toBe(false);
  });

  it('does not treat unrelated short strings as the same commit', () => {
    expect(sameCommit('987146', '9871465')).toBe(false); // too short to be conclusive
  });
});

describe('decideDeployment', () => {
  it('publishes when no live deployment is recorded', () => {
    const d = decide(null);
    expect(d.action).toBe('deploy');
    expect(d.code).toBe('no-live-deployment');
  });

  it('skips when the live deployment already publishes this commit', () => {
    const d = decide(HEAD);
    expect(d.action).toBe('skip');
    expect(d.code).toBe('already-published');
  });

  it('skips when the live deployment recorded only the short hash', () => {
    const d = decide(HEAD_SHORT);
    expect(d.action).toBe('skip');
    expect(d.code).toBe('already-published');
  });

  it('publishes when the live deployment is older', () => {
    const d = decide('40abef5', ['40abef5']);
    expect(d.action).toBe('deploy');
    expect(d.code).toBe('live-is-older');
  });

  it('refuses to publish an older commit over a newer live deployment', () => {
    // live contains HEAD → HEAD is older → must not publish.
    const d = decideDeployment({
      head: HEAD,
      live: 'abc123def456',
      isAncestor: (ancestor, descendant) => ancestor === HEAD && descendant === 'abc123def456',
    });
    expect(d.action).toBe('skip');
    expect(d.code).toBe('live-is-newer');
    expect(d.reason).toMatch(/newer/i);
  });

  it('publishes when the live commit is unrelated (diverged)', () => {
    const d = decide('deadbeefdeadbeef');
    expect(d.action).toBe('deploy');
    expect(d.code).toBe('diverged');
  });

  it('publishes when the current commit cannot be determined', () => {
    const d = decideDeployment({ head: '', live: 'abc1234', isAncestor: () => false });
    expect(d.action).toBe('deploy');
    expect(d.code).toBe('no-live-deployment');
  });

  it('always reports the commits it compared', () => {
    const d = decide('40abef5', ['40abef5']);
    expect(d.head).toBe(HEAD);
    expect(d.live).toBe('40abef5');
    expect(d.reason.length).toBeGreaterThan(10);
  });
});
