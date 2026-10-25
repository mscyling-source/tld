/**
 * Credential probe — validate a gated source against its live API.
 *
 *   npx tsx scripts/probe-source.ts namecheap
 *   npx tsx scripts/probe-source.ts namecheap --raw ./tmp/namecheap
 *
 * Why this exists: the Namecheap adapter cannot be validated without an
 * account key and an allowlisted egress IP, and "it compiles" is not evidence
 * that the documented schema matches what the API actually returns. This runs
 * the real request, parses the real response through the same code the sync
 * uses, prints what came back, and exits non-zero when anything is off — so
 * validating (or refuting) the adapter is one command, not an investigation.
 *
 * It never writes to data/. `--raw` dumps the response bodies so the shape can
 * be inspected; the API key is not part of any response body.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  NAMECHEAP_ACTIONS,
  NAMECHEAP_ENV,
  fetchNamecheap,
  namecheapCredentialsFromEnv,
  namecheapUrl,
  parseNamecheapPricing,
  redactNamecheapUrl,
  resolveClientIp,
  type NamecheapAction,
} from './pricing/sources/namecheap.js';
import { POLITE_USER_AGENT } from './pricing/http.js';
import type { RawOffer } from '../src/lib/pricingTypes.js';

function usage(): never {
  console.error('usage: tsx scripts/probe-source.ts <source-id> [--raw <dir>]');
  console.error('  supported sources: namecheap');
  process.exit(2);
}

function printSample(offers: RawOffer[], count = 5): void {
  const sample = offers
    .filter(o => o.register_usd !== null)
    .sort((a, b) => (a.tld === 'com' ? -1 : b.tld === 'com' ? 1 : a.tld.localeCompare(b.tld)))
    .slice(0, count);
  for (const o of sample) {
    const money = (v: number | null) => (v === null ? '—' : `$${v.toFixed(2)}`);
    console.log(
      `  ${o.tld.padEnd(8)} register ${money(o.register_usd).padEnd(9)} ` +
        `renew ${money(o.renewal_usd).padEnd(9)} transfer ${money(o.transfer_usd)}`,
    );
  }
}

async function probeNamecheap(rawDir: string | null): Promise<number> {
  console.log('namecheap: reading live API');
  try {
    const credentials = namecheapCredentialsFromEnv();
    const { ip, source } = await resolveClientIp();
    console.log(`namecheap: client IP ${ip} (${source})`);
    if (source === 'detected') {
      console.log('namecheap: this address must be on the account API allowlist');
    }

    if (rawDir) {
      await mkdir(rawDir, { recursive: true });
      const withIp = { ...credentials, clientIp: ip };
      for (const action of NAMECHEAP_ACTIONS) {
        const url = namecheapUrl(withIp, action);
        console.log(`namecheap: GET ${redactNamecheapUrl(url)}`);
        const res = await fetch(url, {
          headers: { 'user-agent': POLITE_USER_AGENT, accept: 'application/xml' },
          signal: AbortSignal.timeout(45_000),
        });
        const body = await res.text();
        const path = resolve(rawDir, `${action.toLowerCase()}.xml`);
        await writeFile(path, body, 'utf-8');
        console.log(`namecheap: ${action} HTTP ${res.status} → ${path} (${body.length} bytes)`);
        if (!res.ok) return 1;
        const parsed = parseNamecheapPricing(body, action as NamecheapAction);
        console.log(
          `namecheap: ${action} parsed ${parsed.prices.size} TLDs` +
            (Object.keys(parsed.skipped).length ? ` (skipped ${JSON.stringify(parsed.skipped)})` : ''),
        );
      }
      // Still exercise the production path end to end, now that the bodies are
      // on disk: a second round trip is cheap and proves the real entry point.
      console.log('namecheap: re-running the production fetch path');
    }

    const offers = await fetchNamecheap();
    const withRegister = offers.filter(o => o.register_usd !== null).length;
    const withRenewal = offers.filter(o => o.renewal_usd !== null).length;
    const withTransfer = offers.filter(o => o.transfer_usd !== null).length;

    console.log(
      `namecheap: ${offers.length} offers — register ${withRegister}, renew ${withRenewal}, transfer ${withTransfer}`,
    );
    printSample(offers);

    if (withRegister === 0) {
      console.error('VERDICT: failed — no registration prices were extracted');
      return 1;
    }
    console.log('VERDICT: validated — the live response parses into usable retail prices');
    return 0;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`VERDICT: failed — ${message}`);
    if (message.includes('1011150') || message.includes('1017105')) {
      console.error(
        `hint: Namecheap rejected the calling IP. Add the address printed above to the ` +
          `account allowlist, or set ${NAMECHEAP_ENV.clientIp} to the address that is allowlisted.`,
      );
    }
    return 1;
  }
}

async function main(): Promise<void> {
  const [sourceId, ...rest] = process.argv.slice(2);
  if (!sourceId) usage();

  let rawDir: string | null = null;
  const rawIndex = rest.indexOf('--raw');
  if (rawIndex !== -1) {
    rawDir = rest[rawIndex + 1];
    if (!rawDir) usage();
  }

  if (sourceId !== 'namecheap') {
    console.error(`no probe implemented for "${sourceId}"`);
    usage();
  }

  const code = await probeNamecheap(rawDir);
  process.exit(code);
}

await main();
