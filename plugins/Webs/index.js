import inquirer from 'inquirer';
import https from 'https';
import http from 'http';
import dns from 'dns';
import net from 'net';
import tls from 'tls';
import { URL } from 'url';
import { colors, createSpinner } from '../../core/ui.js';

const dnsResolve = (hostname, type) =>
    new Promise((resolve) => {
        dns.resolve(hostname, type, (err, records) => {
            if (err) return resolve(null);
            resolve(records);
        });
    });

const reverseDns = (ip) =>
    new Promise((resolve) => {
        if (!ip) return resolve(null);
        dns.reverse(ip, (err, hostnames) => {
            if (err) return resolve(null);
            resolve(hostnames);
        });
    });

// ---------- HTTP fetch ----------

function fetchSite(targetUrl, method = 'GET') {
    return new Promise((resolve, reject) => {
        const parsed = new URL(targetUrl);
        const lib = parsed.protocol === 'https:' ? https : http;
        const start = Date.now();

        const req = lib.request(
            parsed,
            { method, timeout: 10000 },
            (res) => {
                const responseTime = Date.now() - start;
                // Socket gets detached once the stream ends, so capture this now.
                const tlsVersion = res.socket && res.socket.getProtocol
                    ? res.socket.getProtocol()
                    : null;
                const remoteAddress = res.socket ? res.socket.remoteAddress : null;

                res.resume();
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        statusMessage: res.statusMessage,
                        headers: res.headers,
                        responseTime,
                        tlsVersion,
                        remoteAddress
                    });
                });
            }
        );

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });
        req.on('error', reject);
        req.end();
    });
}

// follow redirects manually (no auto-follow) so we can report the chain
function traceRedirects(targetUrl, maxHops = 5) {
    return new Promise((resolve) => {
        const chain = [];
        let current = targetUrl;

        const step = async () => {
            if (chain.length >= maxHops) return resolve(chain);
            try {
                const res = await fetchSite(current);
                chain.push({ url: current, status: res.statusCode });
                const location = res.headers && res.headers.location;
                if (res.statusCode >= 300 && res.statusCode < 400 && location) {
                    current = new URL(location, current).toString();
                    return step();
                }
                return resolve(chain);
            } catch {
                return resolve(chain);
            }
        };
        step();
    });
}

function checkPublicFile(targetUrl, path) {
    return new Promise((resolve) => {
        const parsed = new URL(targetUrl);
        parsed.pathname = path;
        const lib = parsed.protocol === 'https:' ? https : http;

        const req = lib.request(
            parsed,
            { method: 'GET', timeout: 6000 },
            (res) => {
                res.resume();
                resolve(res.statusCode >= 200 && res.statusCode < 300);
            }
        );

        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
        req.on('error', () => resolve(false));
        req.end();
    });
}

function fetchOptions(targetUrl) {
    return new Promise((resolve) => {
        const parsed = new URL(targetUrl);
        const lib = parsed.protocol === 'https:' ? https : http;

        const req = lib.request(
            parsed,
            { method: 'OPTIONS', timeout: 6000 },
            (res) => {
                res.resume();
                resolve(res.headers || {});
            }
        );

        req.on('timeout', () => {
            req.destroy();
            resolve({});
        });
        req.on('error', () => resolve({}));
        req.end();
    });
}

// ---------- TLS certificate ----------

function getCertInfo(hostname, port = 443) {
    return new Promise((resolve) => {
        const socket = tls.connect(
            { host: hostname, port, servername: hostname, timeout: 8000 },
            () => {
                const cert = socket.getPeerCertificate(true);
                const protocol = socket.getProtocol();
                const cipher = socket.getCipher();
                socket.end();
                resolve({ cert, protocol, cipher });
            }
        );
        socket.on('error', () => resolve(null));
        socket.on('timeout', () => {
            socket.destroy();
            resolve(null);
        });
    });
}

// ---------- WHOIS ----------

function rawWhois(query, server, port = 43) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: server, port, timeout: 8000 });
        let data = '';
        socket.on('connect', () => socket.write(query + '\r\n'));
        socket.on('data', (chunk) => { data += chunk.toString(); });
        socket.on('end', () => resolve(data));
        socket.on('error', reject);
        socket.on('timeout', () => {
            socket.destroy();
            reject(new Error('WHOIS connection timed out'));
        });
    });
}

async function whoisLookup(domain) {
    try {
        // IANA tells us which registry WHOIS server is authoritative for the TLD
        const tld = domain.split('.').pop();
        const ianaResult = await rawWhois(tld, 'whois.iana.org');
        const match = ianaResult.match(/refer:\s*(\S+)/i);
        const whoisServer = match ? match[1] : 'whois.verisign-grs.com';
        const result = await rawWhois(domain, whoisServer);
        return result;
    } catch {
        return null;
    }
}

function parseWhois(raw) {
    if (!raw) return null;
    const get = (re) => {
        const m = raw.match(re);
        return m ? m[1].trim() : null;
    };
    return {
        registrar: get(/Registrar:\s*(.+)/i),
        createdDate: get(/Creation Date:\s*(.+)/i) || get(/Created On:\s*(.+)/i) || get(/Registered on:\s*(.+)/i),
        expiryDate: get(/Registry Expiry Date:\s*(.+)/i) || get(/Expiration Date:\s*(.+)/i),
        nameServers: [...raw.matchAll(/Name Server:\s*(.+)/gi)].map(m => m[1].trim())
    };
}

// ---------- ASN lookup ----------

function asnLookup(ip) {
    return new Promise((resolve) => {
        if (!ip) return resolve(null);
        // Team Cymru's whois service resolves IP -> ASN over plain WHOIS protocol
        rawWhois(` -v ${ip}`, 'whois.cymru.com')
            .then((data) => {
                const lines = data.trim().split('\n');
                if (lines.length < 2) return resolve(null);
                const cols = lines[1].split('|').map(s => s.trim());
                // AS | IP | BGP Prefix | CC | Registry | Allocated | AS Name
                resolve({
                    asn: cols[0] || null,
                    prefix: cols[2] || null,
                    country: cols[3] || null,
                    asName: cols[6] || null
                });
            })
            .catch(() => resolve(null));
    });
}

// ---------- Subdomain enumeration via crt.sh (Certificate Transparency logs) ----------

function fetchJson(url) {
    return new Promise((resolve) => {
        const parsed = new URL(url);
        const req = https.request(
            parsed,
            { method: 'GET', timeout: 10000, headers: { 'User-Agent': 'letkira-scanner' } },
            (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(body));
                    } catch {
                        resolve(null);
                    }
                });
            }
        );
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.on('error', () => resolve(null));
        req.end();
    });
}

async function enumerateSubdomains(domain) {
    const data = await fetchJson(`https://crt.sh/?q=%.${domain}&output=json`);
    if (!Array.isArray(data)) return [];
    const names = new Set();
    for (const entry of data) {
        if (!entry.name_value) continue;
        entry.name_value.split('\n').forEach((n) => {
            const clean = n.replace(/^\*\./, '').trim().toLowerCase();
            if (clean && clean.endsWith(domain)) names.add(clean);
        });
    }
    return [...names].sort();
}

// ---------- Technology fingerprinting (heuristic, header/body based) ----------

function fingerprintTech(headers, bodySample) {
    const findings = new Set();
    const server = headers['server'] || '';
    const poweredBy = headers['x-powered-by'] || '';

    if (/nginx/i.test(server)) findings.add('nginx');
    if (/apache/i.test(server)) findings.add('Apache');
    if (/cloudflare/i.test(server)) findings.add('Cloudflare edge');
    if (/php/i.test(poweredBy)) findings.add(poweredBy);
    if (/express/i.test(poweredBy)) findings.add('Express.js');
    if (headers['x-aspnet-version']) findings.add('ASP.NET');
    if (headers['x-drupal-cache']) findings.add('Drupal');
    if (headers['x-generator']) findings.add(headers['x-generator']);

    if (bodySample) {
        if (/wp-content|wp-includes/i.test(bodySample)) findings.add('WordPress');
        if (/Shopify\.theme/i.test(bodySample)) findings.add('Shopify');
        if (/_next\/static/i.test(bodySample)) findings.add('Next.js');
        if (/__NUXT__/i.test(bodySample)) findings.add('Nuxt.js');
        if (/wix\.com/i.test(bodySample)) findings.add('Wix');
        if (/react/i.test(bodySample) && /id="root"/i.test(bodySample)) findings.add('React (likely)');
    }

    return findings.size ? [...findings] : ['Not detected'];
}

function fetchBodySample(targetUrl, maxBytes = 20000) {
    return new Promise((resolve) => {
        const parsed = new URL(targetUrl);
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.request(parsed, { method: 'GET', timeout: 8000 }, (res) => {
            let body = '';
            let received = 0;
            res.on('data', (chunk) => {
                received += chunk.length;
                if (received <= maxBytes) body += chunk.toString();
                if (received >= maxBytes) res.destroy();
            });
            res.on('end', () => resolve(body));
            res.on('close', () => resolve(body));
        });
        req.on('timeout', () => { req.destroy(); resolve(''); });
        req.on('error', () => resolve(''));
        req.end();
    });
}

// ---------- Email security (SPF/DKIM/DMARC) ----------

async function checkEmailSecurity(domain) {
    const txt = await dnsResolve(domain, 'TXT');
    const flat = (txt || []).map(r => r.join(''));
    const spf = flat.find(t => /^v=spf1/i.test(t)) || null;

    const dmarcTxt = await dnsResolve(`_dmarc.${domain}`, 'TXT');
    const dmarc = dmarcTxt ? dmarcTxt.map(r => r.join('')).find(t => /^v=DMARC1/i.test(t)) : null;

    // DKIM selector is arbitrary/org-specific; we check the common default selector only
    const dkimTxt = await dnsResolve(`default._domainkey.${domain}`, 'TXT');
    const dkim = dkimTxt ? dkimTxt.map(r => r.join('')).find(t => /v=DKIM1/i.test(t)) : null;

    return { spf, dmarc, dkim };
}

// ---------- formatting helpers ----------

function detectCdn(headers) {
    if (headers['cf-ray'] || headers['cf-cache-status']) return 'Cloudflare';
    if (headers['x-amz-cf-id']) return 'Amazon CloudFront';
    if (headers['x-fastly-request-id']) return 'Fastly';
    if (headers['x-akamai-transformed']) return 'Akamai';
    if (headers['server'] && /cloudflare/i.test(headers['server'])) return 'Cloudflare';
    return 'Not detected';
}

function detectCompression(headers) {
    return headers['content-encoding'] || 'None';
}

function row(label, value) {
    const text = `${colors.secondary(label.padEnd(17))} ${colors.accent(String(value))}`;
    console.log(`${colors.primary('│')} ${text}`);
}

function section(title) {
    console.log(`\n${colors.primary(title)}`);
    console.log(colors.primary('─'.repeat(48)));
}

function checkLine(label, present) {
    const mark = present ? colors.success('✓') : colors.error('✗');
    console.log(`${mark} ${colors.secondary(label)}`);
}

function infoLine(label, value) {
    console.log(`${colors.secondary(label.padEnd(20))}: ${colors.accent(value || 'Unknown')}`);
}

export default async function run() {
    console.log(colors.primary('\n--- Website Scanner Module ---'));

    const { target, deepScan } = await inquirer.prompt([
        {
            type: 'input',
            name: 'target',
            message: colors.accent('Enter target URL (e.g. https://example.com):'),
            validate: (input) => {
                if (!input.trim()) return 'Please enter a URL.';
                try {
                    // eslint-disable-next-line no-new
                    new URL(input.trim());
                    return true;
                } catch {
                    return 'Please enter a valid URL, including http:// or https://';
                }
            }
        },
        {
            type: 'confirm',
            name: 'deepScan',
            message: colors.accent('Include WHOIS, ASN, and subdomain enumeration? (slower)'),
            default: true
        }
    ]);

    const targetUrl = target.trim();
    const hostname = new URL(targetUrl).hostname;
    const rootDomain = hostname.split('.').slice(-2).join('.');

    const spinner = createSpinner('Scanning target...').start();

    let result;
    try {
        result = await fetchSite(targetUrl);
    } catch (err) {
        spinner.fail(colors.error(`Could not reach target: ${err.message}`));
        return;
    }

    const basicTasks = Promise.all([
        dnsResolve(hostname, 'A'),
        dnsResolve(hostname, 'AAAA'),
        dnsResolve(hostname, 'MX'),
        dnsResolve(hostname, 'TXT'),
        dnsResolve(hostname, 'NS'),
        dnsResolve(hostname, 'CNAME'),
        checkPublicFile(targetUrl, '/robots.txt'),
        checkPublicFile(targetUrl, '/sitemap.xml'),
        checkPublicFile(targetUrl, '/.well-known/security.txt'),
        getCertInfo(hostname),
        fetchOptions(targetUrl),
        traceRedirects(targetUrl),
        fetchBodySample(targetUrl),
        checkEmailSecurity(rootDomain)
    ]);

    const [
        aRecords, aaaaRecords, mxRecords, txtRecords, nsRecords, cnameRecords,
        robots, sitemap, securityTxt, certInfo, optionsHeaders, redirectChain,
        bodySample, emailSec
    ] = await basicTasks;

    const ptrRecords = await reverseDns(result.remoteAddress);

    let asnInfo = null;
    let whoisParsed = null;
    let subdomains = [];

    if (deepScan) {
        spinner.start('Running deep scan: WHOIS, ASN, subdomains...');
        const [asn, whoisRaw, subs] = await Promise.all([
            asnLookup(result.remoteAddress),
            whoisLookup(rootDomain),
            enumerateSubdomains(rootDomain)
        ]);
        asnInfo = asn;
        whoisParsed = parseWhois(whoisRaw);
        subdomains = subs;
    }

    spinner.succeed(colors.success('Scan complete.'));

    const headers = result.headers || {};
    const cookies = headers['set-cookie'] || [];
    const cookieBlob = cookies.join('; ');

    console.log(`\n${colors.primary('═'.repeat(48))}`);
    console.log(colors.primary('LETKIRA Website Scanner'));
    console.log(colors.primary('═'.repeat(48)));

    console.log(`\n${colors.primary(`┌${'─'.repeat(48)}┐`)}`);
    row('Target:', targetUrl);
    row('IP:', result.remoteAddress || 'Unknown');
    row('Status:', `${result.statusCode} ${result.statusMessage || ''}`.trim());
    row('Response Time:', `${result.responseTime} ms`);
    console.log(colors.primary(`└${'─'.repeat(48)}┘`));

    console.log('');
    row('Server:', headers['server'] || 'Unknown');
    row('Powered By:', headers['x-powered-by'] || 'Unknown');
    row('HTTPS:', targetUrl.startsWith('https://') ? 'Yes' : 'No');
    row('TLS:', result.tlsVersion || 'N/A');
    row('CDN:', detectCdn(headers));
    row('Compression:', detectCompression(headers));

    section('Technology Fingerprint');
    fingerprintTech(headers, bodySample).forEach((t) => console.log(`• ${colors.accent(t)}`));

    section('IP & Network');
    infoLine('Reverse DNS', ptrRecords ? ptrRecords.join(', ') : 'None');
    if (deepScan) {
        infoLine('ASN', asnInfo ? asnInfo.asn : 'Unknown');
        infoLine('AS Name', asnInfo ? asnInfo.asName : 'Unknown');
        infoLine('Network Prefix', asnInfo ? asnInfo.prefix : 'Unknown');
        infoLine('Country', asnInfo ? asnInfo.country : 'Unknown');
    }

    if (deepScan) {
        section('WHOIS');
        if (whoisParsed) {
            infoLine('Registrar', whoisParsed.registrar);
            infoLine('Created', whoisParsed.createdDate);
            infoLine('Expires', whoisParsed.expiryDate);
            infoLine('Name Servers', whoisParsed.nameServers.join(', ') || 'Unknown');
        } else {
            console.log(colors.secondary('WHOIS data unavailable for this TLD/registrar.'));
        }
    }

    section('SSL/TLS Analysis');
    if (certInfo && certInfo.cert && certInfo.cert.subject) {
        infoLine('Protocol', certInfo.protocol);
        infoLine('Cipher Suite', certInfo.cipher ? certInfo.cipher.name : 'Unknown');
        infoLine('Subject CN', certInfo.cert.subject.CN);
        infoLine('Issuer', certInfo.cert.issuer ? (certInfo.cert.issuer.O || certInfo.cert.issuer.CN) : 'Unknown');
        infoLine('Valid From', certInfo.cert.valid_from);
        infoLine('Valid To', certInfo.cert.valid_to);
        const expiry = new Date(certInfo.cert.valid_to);
        const daysLeft = Math.round((expiry - Date.now()) / (1000 * 60 * 60 * 24));
        infoLine('Days Until Expiry', String(daysLeft));
        infoLine('Subject Alt Names', certInfo.cert.subjectaltname || 'None');
        const weakProtocols = ['TLSv1', 'TLSv1.1', 'SSLv3', 'SSLv2'];
        checkLine('Modern TLS (1.2+)', !weakProtocols.includes(certInfo.protocol));
    } else {
        console.log(colors.secondary('Could not establish a direct TLS connection to inspect the certificate.'));
    }
    checkLine('HSTS Enabled', !!headers['strict-transport-security']);

    section('Security Headers');
    checkLine('Strict-Transport-Security', !!headers['strict-transport-security']);
    checkLine('Content-Security-Policy', !!headers['content-security-policy']);
    checkLine('X-Frame-Options', !!headers['x-frame-options']);
    checkLine('Permissions-Policy', !!headers['permissions-policy']);
    checkLine('X-Content-Type-Options', !!headers['x-content-type-options']);
    checkLine('Referrer-Policy', !!headers['referrer-policy']);

    section('HTTP Analysis');
    infoLine('Allowed Methods', optionsHeaders['allow'] || 'Not advertised');
    infoLine('Cache-Control', headers['cache-control'] || 'Not set');
    infoLine('ETag', headers['etag'] || 'Not set');
    infoLine('CORS (Access-Control-Allow-Origin)', headers['access-control-allow-origin'] || 'Not set');
    infoLine('Content-Type', headers['content-type'] || 'Not set');
    if (redirectChain.length > 1) {
        console.log(colors.secondary('Redirect chain:'));
        redirectChain.forEach((hop, i) => console.log(`  ${i + 1}. [${hop.status}] ${hop.url}`));
    } else {
        console.log(colors.secondary('No redirects detected.'));
    }

    section('Cookies');
    if (cookies.length === 0) {
        console.log(colors.secondary('No cookies set on initial request.'));
    } else {
        checkLine('Secure', /secure/i.test(cookieBlob));
        checkLine('HttpOnly', /httponly/i.test(cookieBlob));
        checkLine('SameSite=Lax', /samesite=lax/i.test(cookieBlob));
        checkLine('SameSite=Strict', /samesite=strict/i.test(cookieBlob));
    }

    section('Public Files');
    checkLine('robots.txt', robots);
    checkLine('sitemap.xml', sitemap);
    checkLine('security.txt', securityTxt);

    section('Email Security');
    checkLine('SPF Record', !!emailSec.spf);
    checkLine('DMARC Record', !!emailSec.dmarc);
    checkLine('DKIM Record (default selector)', !!emailSec.dkim);
    if (emailSec.spf) infoLine('SPF', emailSec.spf);
    if (emailSec.dmarc) infoLine('DMARC', emailSec.dmarc);

    section('DNS');
    console.log(`${colors.secondary('A'.padEnd(7))}: ${colors.accent(aRecords ? aRecords.join(', ') : 'None')}`);
    console.log(`${colors.secondary('AAAA'.padEnd(7))}: ${colors.accent(aaaaRecords ? aaaaRecords.join(', ') : 'None')}`);
    console.log(`${colors.secondary('CNAME'.padEnd(7))}: ${colors.accent(cnameRecords ? cnameRecords.join(', ') : 'None')}`);
    console.log(`${colors.secondary('MX'.padEnd(7))}: ${colors.accent(mxRecords ? mxRecords.map(r => `${r.exchange} (${r.priority})`).join(', ') : 'None')}`);
    console.log(`${colors.secondary('TXT'.padEnd(7))}: ${colors.accent(txtRecords ? txtRecords.map(r => r.join('')).join(' | ') : 'None')}`);
    console.log(`${colors.secondary('NS'.padEnd(7))}: ${colors.accent(nsRecords ? nsRecords.join(', ') : 'None')}`);

    if (deepScan) {
        section(`Subdomains (via Certificate Transparency logs)`);
        if (subdomains.length === 0) {
            console.log(colors.secondary('No subdomains found in public CT logs.'));
        } else {
            const shown = subdomains.slice(0, 30);
            shown.forEach((s) => console.log(`• ${colors.accent(s)}`));
            if (subdomains.length > shown.length) {
                console.log(colors.secondary(`...and ${subdomains.length - shown.length} more.`));
            }
        }
    }

    console.log('');
}
