/**
 * Fixtures for unit tests — small representative samples of the real
 * IANA data so tests run fast and don't depend on the network.
 */

export const DELEGATED_LIST_SAMPLE = `# Version 2026101200, Last Updated Mon Oct 12 07:07:01 2026 UTC
AAA
AARP
ABB
ABBOTT
COM
NET
ORG
AI
IO
DEV
UK
XN--55QX5D
`;

export const DELEGATED_LIST_MINIMAL = `# Version 2024010100, Last Updated Mon Jan 01 00:00:00 2024 UTC
COM
NET
`;

export const ROOT_ZONE_DB_SAMPLE = `<html><body>
<table class="dtable">
<thead>
<tr><th data-stack="primary" scope="col">Domain</th><th scope="col">Type</th><th scope="col">Sponsoring Organisation</th></tr>
</thead>
<tbody>
<tr>
<td><span class="domain tld"><a href="/domains/root/db/com.html">.com</a></span></td>
<td>generic</td>
<td>VeriSign Global Registry Services</td>
</tr>
<tr>
<td><span class="domain tld"><a href="/domains/root/db/org.html">.org</a></span></td>
<td>generic</td>
<td>Public Interest Registry</td>
</tr>
<tr>
<td><span class="domain tld"><a href="/domains/root/db/ai.html">.ai</a></span></td>
<td>country-code</td>
<td>Government of Anguilla</td>
</tr>
<tr>
<td><span class="domain tld"><a href="/domains/root/db/uk.html">.uk</a></span></td>
<td>country-code</td>
<td>Nominet UK</td>
</tr>
<tr>
<td><span class="domain tld"><a href="/domains/root/db/xn--55qx5d.html">.公司</a></span></td>
<td>generic</td>
<td>VeriSign Sarl</td>
</tr>
<tr>
<td><span class="domain tld"><a href="/domains/root/db/abarth.html">.abarth</a></span></td>
<td>generic</td>
<td>Not assigned</td>
</tr>
<tr>
<td><span class="domain tld"><a href="/domains/root/db/test.html">.test</a></span></td>
<td>test</td>
<td>IANA</td>
</tr>
</tbody>
</table>
</body></html>
`;

export const DETAIL_PAGE_COM = `<html><body>
<h1>Delegation Record for .COM</h1>
<p>(Generic top-level domain)</p>
<h2>Sponsoring Organisation</h2>
<b>VeriSign Global Registry Services</b><br/>
12061 Bluemont Way<br>Reston VA 20190<br/>
United States of America (the)<br/>
<h2>Administrative Contact</h2>
<b>Registry Customer Service</b><br/>
VeriSign Global Registry Services<br/>
<h2>Registry Information</h2>
<p><b>URL for registration services:</b> <a href="http://www.verisigninc.com">http://www.verisigninc.com</a><br/>
<b>WHOIS Server:</b> whois.verisign-grs.com <br>
<b>RDAP Server: </b> <a href="https://rdap.verisign.com/com/v1/">https://rdap.verisign.com/com/v1/</a></p>
<p><i>Record last updated 2026-03-10.<br>Registration date 1985-01-01.</i></p>
<ul>
<li><a href="https://www.iana.org/reports/c.2.9.2.d/20120418-com">Delegation of the .com domain</a> (2012-04-18)</li>
<li><a href="https://www.icann.org/resources/pages/agreement-2012-02-25-en">Registry Agreement</a></li>
</ul>
</body></html>
`;

export const DETAIL_PAGE_AI = `<html><body>
<h1>Delegation Record for .AI</h1>
<p>(Country-code top-level domain)</p>
<h2>Sponsoring Organisation</h2>
<b>Government of Anguilla</b><br/>
The Valley<br/>
Anguilla<br/>
<h2>Registry Information</h2>
<p><b>URL for registration services:</b> <a href="http://www.nic.ai">http://www.nic.ai</a><br/>
<b>WHOIS Server:</b> whois.nic.ai <br>
<b>RDAP Server: </b> <a href="https://rdap.nic.ai">https://rdap.nic.ai</a></p>
<p><i>Record last updated 2023-11-15.<br>Registration date 1995-02-16.</i></p>
</body></html>
`;

/**
 * Real IANA page captured on 2026-10-13 from
 * https://www.iana.org/domains/root/db/com.html — used to make sure the
 * parser keeps working when IANA changes the page layout.
 */
export { DETAIL_PAGE_CURRENT_COM };

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DETAIL_PAGE_CURRENT_COM = readFileSync(
  resolve(__dirname, 'fixtures', 'iana-com-current.html'),
  'utf8',
);
export const DETAIL_PAGE_NO_MANAGER = `<html><body>
<h1>Delegation Record for .ABARTH</h1>
<p>(Generic top-level domain)</p>
<h2>Sponsoring Organisation</h2>
<b>Not assigned</b><br/>
<li><a href="/reports/c.2.9.2.d/20160801-abarth">Delegation of the .abarth domain to Fiat Chrysler Automobiles N.V.</a> (2016-08-01)</li>
</body></html>
`;

/**
 * Real IANA Root Zone Database index page captured on 2026-10-16 from
 * https://www.iana.org/domains/root/db — the redesigned table layout
 * (no ".html" suffix, adds a status column and script/language columns).
 */
export { ROOT_ZONE_DB_CURRENT };

import { readFileSync as _readFileSync } from 'node:fs';
import { fileURLToPath as _fileURLToPath } from 'node:url';
import { dirname as _dirname, resolve as _resolve } from 'node:path';

const _dirname2 = _dirname(_fileURLToPath(import.meta.url));
const ROOT_ZONE_DB_CURRENT = _readFileSync(
  _resolve(_dirname2, 'fixtures', 'iana-rootdb-current.html'),
  'utf8',
);
