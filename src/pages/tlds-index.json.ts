/**
 * Static JSON endpoint consumed by the TLD comparison tool
 * (`/tools/compare/`). Returns the fields the tool renders — previously
 * referenced by CompareTool.astro but never generated.
 */
import type { APIRoute } from 'astro';
import { loadAllRecords } from '../lib/store.js';

export const GET: APIRoute = async () => {
  const records = await loadAllRecords();
  const index = records.map(r => ({
    suffix: r.suffix,
    ascii_name: r.ascii_name,
    unicode_name: r.unicode_name,
    normalized_type: r.normalized_type,
    manager_name: r.manager_name,
    is_idn: r.is_idn,
    official_url: r.official_url,
    whois_server: r.whois_server,
    rdap_server: r.rdap_server,
    data_quality_status: r.data_quality_status,
  }));
  return new Response(JSON.stringify(index), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
