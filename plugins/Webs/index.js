import inquirer from 'inquirer';
import https from 'https';
import http from 'http';
import dns from 'dns';
import { URL } from 'url';
import { colors, createSpinner } from '../../core/ui.js';

const dnsResolve = (hostname, type) =>
    new Promise((resolve) => {
        dns.resolve(hostname, type, (err, records) => {
            if (err) return resolve(null);
            resolve(records);
        });
    });

function fetchSite(targetUrl) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(targetUrl);
        const lib = parsed.protocol === 'https:' ? https : http;
        const start = Date.now();

        const req = lib.request(
            parsed,
            { method: 'GET', timeout: 10000 },
            (res) => {
                const responseTime = Date.now() - start;
                // Socket gets detached once the stream ends, so capture this now.
                const tlsVersion = res.socket && res.socket.getProtocol
                    ? res.socket.getProtocol()
                    : null;
                const remoteAddress = res.socket ? res.socket.remoteAddress : null;

                // We don't need the body, just headers/status/socket info.
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

function detectCdn(headers) {
    if (headers['cf-ray'] || headers['cf-cache-status']) return 'Cloudflare';
    if (headers['x-amz-cf-id']) return 'Amazon CloudFront';
    if (headers['x-fastly-request-id']) return 'Fastly';
    if (headers['x-akamai-transformed']) return 'Akamai';
    if (headers['server'] && /cloudflare/i.test(headers['server'])) return 'Cloudflare';
    return 'Not detected';
}

function detectCompression(headers) {
    const enc = headers['content-encoding'];
    if (!enc) return 'None';
    return enc;
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

export default async function run() {
    console.log(colors.primary('\n--- Website Scanner Module ---'));

    const { target } = await inquirer.prompt([
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
        }
    ]);

    const targetUrl = target.trim();
    const hostname = new URL(targetUrl).hostname;

    const spinner = createSpinner('Scanning target...').start();

    let result;
    try {
        result = await fetchSite(targetUrl);
    } catch (err) {
        spinner.fail(colors.error(`Could not reach target: ${err.message}`));
        return;
    }

    const [aRecords, aaaaRecords, mxRecords, txtRecords, nsRecords, robots, sitemap] =
        await Promise.all([
            dnsResolve(hostname, 'A'),
            dnsResolve(hostname, 'AAAA'),
            dnsResolve(hostname, 'MX'),
            dnsResolve(hostname, 'TXT'),
            dnsResolve(hostname, 'NS'),
            checkPublicFile(targetUrl, '/robots.txt'),
            checkPublicFile(targetUrl, '/sitemap.xml')
        ]);

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

    section('Security Headers');
    checkLine('Strict-Transport-Security', !!headers['strict-transport-security']);
    checkLine('Content-Security-Policy', !!headers['content-security-policy']);
    checkLine('X-Frame-Options', !!headers['x-frame-options']);
    checkLine('Permissions-Policy', !!headers['permissions-policy']);
    checkLine('X-Content-Type-Options', !!headers['x-content-type-options']);

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

    section('DNS');
    console.log(`${colors.secondary('A'.padEnd(7))}: ${colors.accent(aRecords ? aRecords.join(', ') : 'None')}`);
    console.log(`${colors.secondary('AAAA'.padEnd(7))}: ${colors.accent(aaaaRecords ? aaaaRecords.join(', ') : 'None')}`);
    console.log(`${colors.secondary('MX'.padEnd(7))}: ${colors.accent(mxRecords ? mxRecords.map(r => `${r.exchange} (${r.priority})`).join(', ') : 'None')}`);
    console.log(`${colors.secondary('TXT'.padEnd(7))}: ${colors.accent(txtRecords ? txtRecords.map(r => r.join('')).join(' | ') : 'None')}`);
    console.log(`${colors.secondary('NS'.padEnd(7))}: ${colors.accent(nsRecords ? nsRecords.join(', ') : 'None')}\n`);
          }
