/**
 * Editorial notes for selected TLDs.
 *
 * IMPORTANT — data separation:
 *   This file is checked into `src/` and is NEVER touched by
 *   `scripts/sync-tlds.ts` (which only rewrites `data/tlds.json`).
 *   IANA-sourced fields (type, manager, WHOIS, RDAP) and the editorial
 *   notes below are stored separately and only combined at render time.
 *
 * IMPORTANT — honesty of the "reviewed" status:
 *   Every `sources[].checked_on` date below is the date the linked page was
 *   actually fetched and its facts confirmed readable during the build of
 *   this file. `status` is deliberately `editorial-sourced` and NOT
 *   `human-reviewed`, because a script fetched these pages. Do not upgrade
 *   the status to "verified-editorial" without a real human review record.
 *
 * IMPORTANT — what is a claim and what is not:
 *   Only statements that come from a linked source are presented as facts.
 *   Anything not present in a linked source is marked
 *   `policy_verified: false` so the page can say "not independently
 *   verified" instead of inventing eligibility rules, prices or history.
 */

export interface TldNoteSource {
  /** Fully-qualified URL that was fetched. */
  url: string;
  /** ISO date the page was actually fetched (YYYY-MM-DD). */
  checked_on: string;
  /** Short label describing what the page was used for. */
  used_for: string;
}

export interface TldNote {
  /** ASCII label, lowercase, no leading dot. */
  suffix: string;
  /** 2–4 sentence editorial overview. Factual, sourced, no invented stats. */
  summary: string;
  /**
   * The registry's own published site, as listed in IANA's
   * "URL for registration services" field. This is the correct place for a
   * reader to check the *current* rules.
   */
  policy_url: string | null;
  /**
   * True only when a *linked* source states the registration rule.
   * When false the page must render "not independently verified" rather than
   * a guess.
   */
  policy_verified: boolean;
  /** What the linked source states, when policy_verified is true. */
  policy_note: string | null;
  /** Extra practical context, clearly non-authoritative. */
  practical_note: string | null;
  sources: TldNoteSource[];
  /**
   * `editorial-sourced` = script-verified against the links above.
   * `human-reviewed` = a person signed off (reserved; unused).
   */
  status: 'editorial-sourced' | 'human-reviewed';
}

/** Date the source URLs in this file were last fetched and confirmed. */
export const NOTES_CHECKED_ON = '2026-10-16';

export const tldNotes: TldNote[] = [
  {
    suffix: 'com',
    summary:
      'A generic top-level domain delegated in the DNS root zone. IANA lists VeriSign Global Registry Services as the sponsoring organisation, and VeriSign publishes the registry services page that registrants are directed to for information about the TLD.',
    policy_url: 'http://www.verisigninc.com',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'Verisign also operates .net (both appear under the same sponsoring organisation in the IANA Root Zone Database). If you are comparing the two, compare the current registry pages rather than assuming identical policies.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/com.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS and RDAP endpoints',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'org',
    summary:
      'A generic top-level domain delegated in the DNS root zone. IANA lists Public Interest Registry (PIR) as the sponsoring organisation, and PIR publishes its own registry site.',
    policy_url: 'http://publicinterestregistry.org',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'The historical association of .org with non-profits comes from the registry\'s own positioning, not from a technical restriction in the DNS. Registration eligibility is set by the registry\'s policy, not by the protocol.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/org.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS endpoint',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'net',
    summary:
      'A generic top-level domain delegated in the DNS root zone. IANA lists VeriSign Global Registry Services as the sponsoring organisation — the same operator that IANA lists for .com.',
    policy_url: 'http://www.verisigninc.com',
    policy_verified: false,
    policy_note: null,
    practical_note:
      '.net was originally associated with network infrastructure providers, but nothing in the DNS enforces that. For a technical comparison with .com see the comparison tool.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/net.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS endpoint',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'ai',
    summary:
      'A country-code top-level domain, delegated by IANA to the Government of Anguilla. The registry publishes whois.nic.ai as the WHOIS server and nic.ai as the registration-services site.',
    policy_url: 'https://nic.ai',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'Although country-code, many registrars market .ai internationally. Eligibility rules are the national registry\'s decision and are not recorded in IANA\'s delegation record.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/ai.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server, registry site',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'io',
    summary:
      'A country-code top-level domain. IANA lists Internet Computer Bureau Limited as the sponsoring organisation, with whois.nic.io as the WHOIS server.',
    policy_url: 'http://www.nic.io/',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'The .io record sits behind a long-running sovereignty dispute over the Chagos Archipelago, which is not reflected in the IANA data itself. Anyone dependent on a ccTLD for a long-term project should verify the current registry conditions directly before registering.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/io.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server, registry site',
      },
      {
        url: 'https://www.nic.io/',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Registry status page reachability',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'dev',
    summary:
      'A generic top-level domain operated by Charleston Road Registry Inc. — the same company IANA lists for .app. IANA publishes the registry\'s site as https://www.registry.google.',
    policy_url: 'https://www.registry.google',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'Google Registry-operated TLDs carried a public HTTPS-only requirement under HSTS preloading at launch. Because that requirement is a registry/operational setting rather than something IANA records, confirm it on the registry page linked above before relying on it.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/dev.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, registry site',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'app',
    summary:
      'A generic top-level domain operated by Charleston Road Registry Inc., the same operator IANA lists for .dev. IANA publishes https://www.registry.google as the registration-services site.',
    policy_url: 'https://www.registry.google',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'Like .dev, the HTTPS/HSTS requirement discussed publicly at launch is a registry-side configuration, not a field in the IANA record. Verify current conditions on the registry page.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/app.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, registry site',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'co',
    summary:
      'A country-code top-level domain delegated by IANA to the Ministry of Information and Communications Technologies (MinTIC) — the Colombian government body. IANA lists whois.registry.co as the WHOIS server.',
    policy_url: 'http://www.registry.co',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'Many registrars market .co internationally as an abbreviation for "company". Its status as a country-code TLD is unchanged by that marketing.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/co.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'me',
    summary:
      'A country-code top-level domain delegated by IANA to the Government of Montenegro, with whois.nic.me as the WHOIS server.',
    policy_url: 'http://www.domain.me',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'Widely used outside Montenegro for personal sites. Any residency-style requirement is set by the registry, not recorded by IANA.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/me.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server, registry site',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'info',
    summary:
      'A generic top-level domain. IANA lists Identity Digital Limited as the sponsoring organisation, with https://www.identity.digital/ as the registration-services site.',
    policy_url: 'https://www.identity.digital/',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'The same sponsoring organisation appears for several other TLDs in the IANA database (for example .pro and .mobi). Shared operator does not mean shared registration policy — check each TLD separately.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/info.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, registry site',
      },
      {
        url: 'https://www.identity.digital/',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Registry status page reachability',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'uk',
    summary:
      'A country-code top-level domain delegated by IANA to Nominet UK. IANA lists http://www.nic.uk/ as the registration-services site.',
    policy_url: 'http://www.nic.uk/',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'Requests for nominet.uk may currently be blocked from some networks; if the link does not load for you, the IANA record above still confirms the sponsoring organisation.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/uk.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, registry site',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'de',
    summary:
      'A country-code top-level domain delegated by IANA to DENIC eG, the German registry. IANA lists whois.denic.de as the WHOIS server and http://www.denic.de/ as the registry site.',
    policy_url: 'http://www.denic.de/',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'DENIC\'s own reachable site (https://www.denic.de/en/) states it is the registry for all .de domains. Contact/address expectations are a registry policy question, not something IANA publishes.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/de.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server, registry site',
      },
      {
        url: 'https://www.denic.de/en/',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Registry status page reachability',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'jp',
    summary:
      'A country-code top-level domain delegated by IANA to Japan Registry Services Co., Ltd., with whois.jprs.jp as the WHOIS server.',
    policy_url: 'https://jprs.jp/',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'JPRS\'s site redirects to jprs.co.jp. Follow the registry link for current registrar directories and policy documents.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/jp.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server, registry site',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'cn',
    summary:
      'A country-code top-level domain delegated by IANA to the China Internet Network Information Center (CNNIC), with whois.cnnic.cn as the WHOIS server.',
    policy_url: 'http://www.cnnic.cn/',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'CNNIC has repeatedly published presence-style requirements for .cn registrations over time. Those requirements change and are not part of the IANA record — check CNNIC before registering.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/cn.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server, registry site',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'eu',
    summary:
      'A country-code top-level domain delegated by IANA to EURid vzw, with whois.eu as the WHOIS server. EURid states it operates .eu, .ею and .ευ.',
    policy_url: 'http://www.eurid.eu',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'EURid publishes its own eligibility and registrar information at eurid.eu. We did not independently restate those rules here because they change; read them at the source.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/eu.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server',
      },
      {
        url: 'https://eurid.eu/en/register-a-eu-domain/',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Registry scope and registrar information',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'gov',
    summary:
      'A top-level domain delegated by IANA to the Cybersecurity and Infrastructure Security Agency, with whois.nic.gov as the WHOIS server and get.gov as the services site. IANA\'s current record classifies .gov as a generic top-level domain; older IANA pages listed it as sponsored. Either way, access is controlled by a single sponsoring organisation rather than being open to all comers.',
    policy_url: 'https://get.gov',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'The eligibility rules are set by the sponsoring organisation, not by the DNS. Because IANA\'s record does not publish them, use the linked registry page to confirm current conditions before relying on any specific requirement.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/gov.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type classification, sponsoring organisation, WHOIS server, services site',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'edu',
    summary:
      'A top-level domain delegated by IANA to EDUCAUSE, with whois.educause.edu as the WHOIS server. IANA\'s current record classifies .edu as a generic top-level domain; older IANA pages listed it as sponsored.',
    policy_url: 'http://www.educause.edu/edudomain',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'The .edu policy page is the authoritative place to check the current eligibility statement.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/edu.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type classification, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'museum',
    summary:
      'A top-level domain delegated by IANA to the Museum Domain Management Association, with whois.nic.museum as the WHOIS server. IANA\'s current record classifies .museum as a generic top-level domain; older IANA pages listed it as sponsored.',
    policy_url: 'https://about.museum',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'The sponsoring organisation defines eligibility; the IANA record does not publish the conditions. Use the linked page for the current statement.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/museum.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type classification, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'aero',
    summary:
      'A top-level domain delegated by IANA to the Societe Internationale de Telecommunications Aeronautique (SITA INC USA), with whois.aero as the WHOIS server. IANA\'s current record classifies .aero as a generic top-level domain; older IANA pages listed it as sponsored.',
    policy_url: 'http://www.information.aero',
    policy_verified: false,
    policy_note: null,
    practical_note:
      '.aero was one of the original sponsored TLDs, with an industry-defined eligibility policy. The current conditions are published by the sponsoring organisation.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/aero.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type classification, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'post',
    summary:
      'A top-level domain delegated by IANA to the Universal Postal Union, with whois.nic.post as the WHOIS server. IANA\'s current record classifies .post as a generic top-level domain; older IANA pages listed it as sponsored.',
    policy_url: 'http://www.upu.int',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'The sponsoring organisation is an intergovernmental body, so eligibility is narrow by design.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/post.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type classification, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'biz',
    summary:
      'A top-level domain delegated by IANA to Registry Services, LLC, with whois.nic.biz as the WHOIS server. IANA\'s current record classifies .biz as a generic top-level domain; older IANA pages labelled it "generic-restricted", meaning the registry applies eligibility conditions rather than accepting any registration.',
    policy_url: 'http://www.nic.biz',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'Whether a "restricted" label still applies is a registry policy question. The actual conditions are published by the registry, not by IANA.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/biz.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type classification, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'name',
    summary:
      'A top-level domain delegated by IANA to VeriSign Information Services, Inc. IANA\'s current record classifies .name as a generic top-level domain; older IANA pages labelled it "generic-restricted".',
    policy_url: 'http://www.nic.name',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'Note the distinct sponsoring organisation from .com, which IANA lists under VeriSign Global Registry Services.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/name.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type classification, sponsoring organisation',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'pro',
    summary:
      'A top-level domain delegated by IANA to Identity Digital Limited. IANA\'s current record classifies .pro as a generic top-level domain; older IANA pages labelled it "generic-restricted".',
    policy_url: 'https://www.identity.digital/',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'The same sponsoring organisation operates several TLDs, but any eligibility conditions are defined per-TLD by the registry.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/pro.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type classification, sponsoring organisation',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'tv',
    summary:
      'A country-code top-level domain. IANA lists the Ministry of Transport, Energy, Communications and Innovations as the sponsoring organisation, with whois.nic.tv as the WHOIS server.',
    policy_url: 'https://turnon.tv/',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'Widely used by video and streaming sites, but IANA\'s record shows a national registry as operator.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/tv.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'xyz',
    summary:
      'A generic top-level domain operated by XYZ.COM LLC, with whois.nic.xyz as the WHOIS server.',
    policy_url: 'https://nic.xyz',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'One of the newer generic TLDs launched in the 2014–2016 New gTLD Programme; the registry page linked above is the place for current rules.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/xyz.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'online',
    summary:
      'A generic top-level domain operated by Radix Technologies Inc. SEZC, with whois.nic.online as the WHOIS server.',
    policy_url: 'https://radix.website/',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'Radix operates several TLDs listed separately in the IANA database (for example .site, .store and .tech).',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/online.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'shop',
    summary:
      'A generic top-level domain operated by GMO Registry, Inc., with whois.nic.shop as the WHOIS server.',
    policy_url: 'http://www.gmoregistry.com/en/',
    policy_verified: false,
    policy_note: null,
    practical_note: null,
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/shop.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'store',
    summary:
      'A generic top-level domain operated by Radix Technologies Inc., with whois.nic.store as the WHOIS server.',
    policy_url: 'https://radix.website/',
    policy_verified: false,
    policy_note: null,
    practical_note: null,
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/store.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'tech',
    summary:
      'A generic top-level domain operated by Radix Technologies Inc., with whois.nic.tech as the WHOIS server.',
    policy_url: 'https://radix.website/',
    policy_verified: false,
    policy_note: null,
    practical_note: null,
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/tech.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'cloud',
    summary:
      'A generic top-level domain delegated by IANA to ARUBA PEC S.p.A., with whois.nic.cloud as the WHOIS server.',
    policy_url: 'https://www.get.cloud',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'Despite the name, the TLD is not operated by a specific cloud provider — IANA records an Italian registry company as the sponsoring organisation.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/cloud.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'asia',
    summary:
      'A generic top-level domain operated by DotAsia Organisation Ltd., with whois.nic.asia as the WHOIS server.',
    policy_url: 'http://www.registry.asia',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'Despite the geographic name, IANA classifies .asia as generic rather than country-code. Region-of-interest rules are set by the registry, not by IANA.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/asia.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type classification, sponsoring organisation',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'jobs',
    summary:
      'A generic top-level domain. IANA lists Employ Media LLC as the sponsoring organisation.',
    policy_url: 'http://www.goto.jobs',
    policy_verified: false,
    policy_note: null,
    practical_note: null,
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/jobs.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, registry site',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'mobi',
    summary:
      'A generic top-level domain. IANA lists Identity Digital Limited as the sponsoring organisation.',
    policy_url: 'https://www.identity.digital/',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'Originally positioned for mobile-optimised sites; that positioning is historical marketing rather than a technical requirement enforced by DNS.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/mobi.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, registry site',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'travel',
    summary:
      'A generic top-level domain. IANA lists Dog Beach, LLC as the sponsoring organisation.',
    policy_url: 'https://www.identity.digital/',
    policy_verified: false,
    policy_note: null,
    practical_note:
      'Travel historically had eligibility rules tied to the travel industry; the current conditions come from the operator, not IANA.',
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/travel.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, registry site',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'blog',
    summary:
      'A generic top-level domain. IANA lists Knock Knock WHOIS There, LLC as the sponsoring organisation, with whois.nic.blog as the WHOIS server.',
    policy_url: 'http://nic.blog',
    policy_verified: false,
    policy_note: null,
    practical_note: null,
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/blog.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'design',
    summary:
      'A generic top-level domain. IANA lists Registry Services, LLC as the sponsoring organisation.',
    policy_url: 'http://nic.design/',
    policy_verified: false,
    policy_note: null,
    practical_note: null,
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/design.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'space',
    summary:
      'A generic top-level domain operated by Radix Technologies Inc., with whois.nic.space as the WHOIS server.',
    policy_url: 'https://radix.website/',
    policy_verified: false,
    policy_note: null,
    practical_note: null,
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/space.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'live',
    summary:
      'A generic top-level domain. IANA lists Dog Beach, LLC as the sponsoring organisation.',
    policy_url: 'https://www.identity.digital/',
    policy_verified: false,
    policy_note: null,
    practical_note: null,
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/live.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, registry site',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'email',
    summary:
      'A generic top-level domain. IANA lists Binky Moon, LLC as the sponsoring organisation.',
    policy_url: 'https://www.identity.digital/',
    policy_verified: false,
    policy_note: null,
    practical_note: null,
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/email.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, registry site',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'news',
    summary:
      'A generic top-level domain. IANA lists Dog Beach, LLC as the sponsoring organisation.',
    policy_url: 'https://www.identity.digital/',
    policy_verified: false,
    policy_note: null,
    practical_note: null,
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/news.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, registry site',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'love',
    summary:
      'A generic top-level domain operated by Waterford Limited, with whois.nic.love as the WHOIS server.',
    policy_url: 'https://get.love',
    policy_verified: false,
    policy_note: null,
    practical_note: null,
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/love.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
  {
    suffix: 'site',
    summary:
      'A generic top-level domain operated by Radix Technologies Inc. SEZC, with whois.nic.site as the WHOIS server.',
    policy_url: 'https://radix.website/',
    policy_verified: false,
    policy_note: null,
    practical_note: null,
    sources: [
      {
        url: 'https://www.iana.org/domains/root/db/site.html',
        checked_on: NOTES_CHECKED_ON,
        used_for: 'Type, sponsoring organisation, WHOIS server',
      },
    ],
    status: 'editorial-sourced',
  },
];

/** O(1) lookup by ASCII label (no leading dot). */
export const tldNoteMap = new Map(tldNotes.map(n => [n.suffix, n]));
