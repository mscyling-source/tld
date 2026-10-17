/**
 * Shared data model for TLD records.
 *
 * Field provenance rules:
 *  - `source_*` fields are copied verbatim from an authoritative source.
 *  - `normalized_*` fields are derived by documented, tested rules.
 *  - editorial fields come from human-reviewed content stored in
 *    `src/content/notes/` and always carry a review date + source links.
 *  - Anything that cannot be verified stays `null` — never guessed.
 */

/** Verbatim type as published by IANA's Root Zone Database. */
export type IanaSourceType =
  | 'generic'
  | 'generic-restricted'
  | 'country-code'
  | 'sponsored'
  | 'infrastructure'
  | 'test'
  | 'special-use'
  | (string & {});

/**
 * Normalised type used for categories, filters and tests.
 *
 * IANA's Root Zone Database index page was redesigned in 2026 and now
 * publishes only "Generic", "Country Code" and "Special Use". The older
 * values (`sponsored`, `generic-restricted`, `infrastructure`, `test`) are
 * still accepted so datasets captured before the redesign keep working.
 */
export type NormalizedType =
  | 'generic'
  | 'generic-restricted'
  | 'country-code'
  | 'sponsored'
  | 'infrastructure'
  | 'test'
  | 'special-use';

export type DataQualityStatus =
  /** Type + manager + delegation status verified against IANA sources. */
  | 'verified'
  /** Verified, plus a human-reviewed editorial profile exists. */
  | 'verified-editorial'
  /** Something could not be verified (e.g. missing manager) — treat as thin. */
  | 'incomplete';

export interface TldReference {
  title: string;
  url: string;
}

export interface TldRecord {
  /** Canonical suffix including the leading dot, lowercase, e.g. ".com". */
  suffix: string;
  /** ASCII (punycode) label without the dot, e.g. "com" or "xn--55qx5d". */
  ascii_name: string;
  /** Unicode display label without the dot when the TLD is an IDN, else null. */
  unicode_name: string | null;
  /** Type exactly as published by IANA. */
  source_type: string;
  /** Type after documented normalisation (null when the source was unknown). */
  normalized_type: NormalizedType | null;
  /** Sponsoring organisation (registry operator) as published by IANA. */
  manager_name: string | null;
  /** Canonical IANA delegation record for this TLD. */
  source_url: string;
  /** Registry "URL for registration services" as published by IANA, else null. */
  official_url: string | null;
  whois_server: string | null;
  rdap_server: string | null;
  /** IANA/ICANN reference documents (RFCs, delegation reports). */
  references: TldReference[];
  /** Short factual description (editorial summary, else a derived sentence). */
  description: string;
  /** Human-reviewed registration notes, null when not verified yet. */
  registration_restrictions: string | null;
  /** ISO date the record was last verified against the sources, null if unknown. */
  last_verified_at: string | null;
  /** ISO date the upstream IANA record was last updated, null if unknown. */
  source_updated_at: string | null;
  /** ISO date the TLD was originally registered/delegated, null if unknown. */
  delegated_since: string | null;
  /** True while the TLD appears in IANA's authoritative delegated list. */
  is_active: boolean;
  /**
   * Raw delegation status from IANA's index page ("Active", "Retired",
   * "Reserved", "Eligible"), or null when not published (legacy layout).
   * Preserved verbatim so the derived `is_active` stays auditable.
   */
  iana_status: string | null;
  /**
   * For reserved names IANA publishes usage prose (e.g. "For testing
   * purposes") in the organisation column. Kept here so it is rendered as
   * what it is, rather than as a sponsoring organisation.
   */
  iana_status_note: string | null;
  /** True for punycode (xn--) TLDs — internationalized domain names. */
  is_idn: boolean;
  /** Has a human-reviewed editorial profile in this repository. */
  has_editorial: boolean;
  data_quality_status: DataQualityStatus;
  /** First letter used for the A–Z index (ASCII label, lowercase). */
  letter: string;
}

export interface SyncChange {
  added: string[];
  removed: string[];
}

export interface TldDataset {
  schema_version: number;
  generated_at: string;
  sources: {
    delegated_list: {
      url: string;
      version: string;
      last_updated: string;
    };
    root_zone_db: {
      url: string;
      last_modified: string;
    };
  };
  records: TldRecord[];
}

export interface SyncMeta {
  last_success_at: string | null;
  last_attempt_at: string | null;
  status: 'success' | 'failed' | 'never-run';
  last_error: string | null;
  counts: {
    total: number;
    by_type: Record<string, number>;
    idn: number;
    editorial: number;
  };
  last_changes: SyncChange;
  history: Array<{
    at: string;
    status: 'success' | 'failed';
    total: number;
    added: number;
    removed: number;
    note: string;
  }>;
}
