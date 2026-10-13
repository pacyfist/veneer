import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CrawlerDnsResolver,
  CrawlerVerifierOptions,
  KNOWN_CRAWLERS,
  createCrawlerVerifier,
} from './verify-crawler';

/** No test here touches the network: every lookup goes to this table. */
function fakeDns(records: {
  ptr?: Record<string, string[]>;
  a?: Record<string, string[]>;
  aaaa?: Record<string, string[]>;
}) {
  const missing = (name: string) =>
    Promise.reject(Object.assign(new Error(`queryX ENOTFOUND ${name}`), { code: 'ENOTFOUND' }));
  const answer = (table: Record<string, string[]> | undefined, name: string) =>
    table?.[name] ? Promise.resolve(table[name]) : missing(name);
  return {
    reverse: vi.fn((ip: string) => answer(records.ptr, ip)),
    resolve4: vi.fn((name: string) => answer(records.a, name)),
    resolve6: vi.fn((name: string) => answer(records.aaaa, name)),
  } satisfies CrawlerDnsResolver;
}

const GOOGLE_IP = '66.249.66.1';
const GOOGLE_HOST = 'crawl-66-249-66-1.googlebot.com';
const GOOGLE_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/130.0.0.0';
const BING_IP = '157.55.39.1';
const BING_HOST = 'msnbot-157-55-39-1.search.msn.com';
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0';

const genuine = () =>
  fakeDns({
    ptr: { [GOOGLE_IP]: [GOOGLE_HOST], [BING_IP]: [BING_HOST] },
    a: { [GOOGLE_HOST]: [GOOGLE_IP], [BING_HOST]: [BING_IP] },
  });

const verifier = (resolver: CrawlerDnsResolver, options: CrawlerVerifierOptions = {}) =>
  createCrawlerVerifier({ resolver, ...options });

afterEach(() => {
  vi.useRealTimers();
});

describe('createCrawlerVerifier', () => {
  it('verifies a genuine Googlebot by reverse and forward DNS', async () => {
    const dns = genuine();
    await expect(verifier(dns)(GOOGLE_IP, GOOGLE_UA)).resolves.toEqual({
      name: 'Googlebot',
      hostname: GOOGLE_HOST,
    });
    expect(dns.reverse).toHaveBeenCalledWith(GOOGLE_IP);
    expect(dns.resolve4).toHaveBeenCalledWith(GOOGLE_HOST);
  });

  it('verifies a genuine Bingbot, and checks every crawler when no user-agent is given', async () => {
    await expect(verifier(genuine())(BING_IP)).resolves.toEqual({
      name: 'Bingbot',
      hostname: BING_HOST,
    });
  });

  it('rejects a reverse name that only looks like the crawler domain', async () => {
    for (const spoofed of [
      'crawl-66-249-66-1.googlebot.com.attacker.example',
      'fakegooglebot.com',
      'googlebot.com-evil.example',
    ]) {
      const dns = fakeDns({ ptr: { '203.0.113.7': [spoofed] }, a: { [spoofed]: ['203.0.113.7'] } });
      await expect(verifier(dns)('203.0.113.7', GOOGLE_UA)).resolves.toBeNull();
      // Not in the allowlist, so not even looked up forward.
      expect(dns.resolve4).not.toHaveBeenCalled();
    }
  });

  it("rejects Google's special-case and user-triggered fetchers under google.com", async () => {
    for (const host of [
      'rate-limited-proxy-66-249-90-1.google.com',
      'google-proxy-66-249-81-1.google.com',
    ]) {
      const ip = '66.249.90.1';
      const dns = fakeDns({ ptr: { [ip]: [host] }, a: { [host]: [ip] } });
      await expect(verifier(dns)(ip, GOOGLE_UA)).resolves.toBeNull();
      await expect(verifier(dns)(ip)).resolves.toBeNull();
      expect(dns.resolve4).not.toHaveBeenCalled();
    }
  });

  it('verifies a geo-distributed Googlebot', async () => {
    const ip = '66.249.70.1';
    const host = 'geo-crawl-66-249-70-1.geo.googlebot.com';
    const dns = fakeDns({ ptr: { [ip]: [host] }, a: { [host]: [ip] } });
    await expect(verifier(dns)(ip, GOOGLE_UA)).resolves.toEqual({
      name: 'Googlebot',
      hostname: host,
    });
  });

  it('accepts google.com again through a custom list', async () => {
    const ip = '66.249.90.1';
    const host = 'rate-limited-proxy-66-249-90-1.google.com';
    const dns = fakeDns({ ptr: { [ip]: [host] }, a: { [host]: [ip] } });
    const verify = verifier(dns, {
      crawlers: [{ name: 'AdsBot', userAgent: /AdsBot-Google/, domains: ['google.com'] }],
    });
    await expect(verify(ip, 'AdsBot-Google (+http://www.google.com/adsbot.html)')).resolves.toEqual(
      { name: 'AdsBot', hostname: host },
    );
  });

  it('rejects a spoofed PTR record whose name does not resolve back to the IP', async () => {
    // The attacker controls the PTR record for their own IP, not googlebot.com.
    const dns = fakeDns({
      ptr: { '203.0.113.7': [GOOGLE_HOST] },
      a: { [GOOGLE_HOST]: [GOOGLE_IP] },
    });
    await expect(verifier(dns)('203.0.113.7', GOOGLE_UA)).resolves.toBeNull();
    expect(dns.resolve4).toHaveBeenCalledWith(GOOGLE_HOST);
  });

  it('rejects a name with no forward record', async () => {
    const dns = fakeDns({ ptr: { [GOOGLE_IP]: [GOOGLE_HOST] } });
    await expect(verifier(dns)(GOOGLE_IP, GOOGLE_UA)).resolves.toBeNull();
  });

  it('skips DNS entirely for a user-agent that claims no known crawler', async () => {
    const dns = genuine();
    await expect(verifier(dns)(GOOGLE_IP, BROWSER_UA)).resolves.toBeNull();
    await expect(verifier(dns)(GOOGLE_IP, '')).resolves.toBeNull();
    expect(dns.reverse).not.toHaveBeenCalled();
  });

  it('needs the user-agent and the DNS to agree on the crawler', async () => {
    // A genuine Bing IP sending a Googlebot user-agent is not Googlebot.
    await expect(verifier(genuine())(BING_IP, GOOGLE_UA)).resolves.toBeNull();
  });

  it('never trusts the user-agent alone', async () => {
    await expect(verifier(genuine())('198.51.100.20', GOOGLE_UA)).resolves.toBeNull();
  });

  it('gives up after the timeout, resolving to null, and does not cache that', async () => {
    const dns = genuine();
    dns.reverse.mockImplementationOnce(() => new Promise(() => {}));
    const verify = verifier(dns, { timeout: 20 });

    const started = Date.now();
    await expect(verify(GOOGLE_IP, GOOGLE_UA)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);

    // The next request looks up again instead of reusing the timeout.
    await expect(verify(GOOGLE_IP, GOOGLE_UA)).resolves.toMatchObject({ name: 'Googlebot' });
    expect(dns.reverse).toHaveBeenCalledTimes(2);
  });

  it('treats a failed lookup as not verified and does not cache it', async () => {
    const dns = genuine();
    dns.reverse.mockRejectedValueOnce(Object.assign(new Error('SERVFAIL'), { code: 'ESERVFAIL' }));
    const verify = verifier(dns);
    await expect(verify(GOOGLE_IP, GOOGLE_UA)).resolves.toBeNull();
    await expect(verify(GOOGLE_IP, GOOGLE_UA)).resolves.toMatchObject({ name: 'Googlebot' });
  });

  it('caches results per IP for the TTL, positive and negative', async () => {
    vi.useFakeTimers();
    const dns = genuine();
    const verify = verifier(dns, { ttl: 60_000 });

    await verify(GOOGLE_IP, GOOGLE_UA);
    await verify(GOOGLE_IP, GOOGLE_UA);
    await verify('198.51.100.20', GOOGLE_UA);
    await verify('198.51.100.20', GOOGLE_UA);
    expect(dns.reverse).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(60_001);
    await verify(GOOGLE_IP, GOOGLE_UA);
    expect(dns.reverse).toHaveBeenCalledTimes(3);
  });

  it('shares one lookup between concurrent requests from an IP', async () => {
    const dns = genuine();
    const verify = verifier(dns);
    const results = await Promise.all([verify(GOOGLE_IP, GOOGLE_UA), verify(GOOGLE_IP)]);
    expect(results.map((r) => r?.name)).toEqual(['Googlebot', 'Googlebot']);
    expect(dns.reverse).toHaveBeenCalledTimes(1);
  });

  it('keeps at most maxEntries IPs', async () => {
    const dns = genuine();
    const verify = verifier(dns, { maxEntries: 1 });
    await verify(GOOGLE_IP);
    await verify(BING_IP);
    await verify(GOOGLE_IP);
    expect(dns.reverse).toHaveBeenCalledTimes(3);
  });

  it('accepts IPv4-mapped IPv6 addresses, as Node reports them', async () => {
    await expect(verifier(genuine())(`::ffff:${GOOGLE_IP}`, GOOGLE_UA)).resolves.toMatchObject({
      name: 'Googlebot',
    });
  });

  it('compares IPv6 addresses however they are written', async () => {
    const host = 'crawl-2001-4860-4801-10--1.googlebot.com';
    const dns = fakeDns({
      ptr: { '2001:4860:4801:10::1': [host.toUpperCase() + '.'] },
      aaaa: { [host]: ['2001:4860:4801:10:0:0:0:1'] },
    });
    await expect(verifier(dns)('2001:4860:4801:10::1', GOOGLE_UA)).resolves.toEqual({
      name: 'Googlebot',
      hostname: host,
    });
  });

  it('returns null without lookups for something that is not an IP', async () => {
    const dns = genuine();
    for (const ip of ['', 'localhost', 'crawl.googlebot.com', '999.1.1.1']) {
      await expect(verifier(dns)(ip, GOOGLE_UA)).resolves.toBeNull();
    }
    expect(dns.reverse).not.toHaveBeenCalled();
  });

  it('takes a custom crawler list', async () => {
    const dns = fakeDns({
      ptr: { '192.0.2.5': ['bot-5.crawl.example.org'] },
      a: { 'bot-5.crawl.example.org': ['192.0.2.5'] },
    });
    const verify = verifier(dns, {
      crawlers: [{ name: 'ExampleBot', userAgent: /ExampleBot/, domains: ['crawl.example.org'] }],
    });
    await expect(verify('192.0.2.5', 'ExampleBot/1.0')).resolves.toEqual({
      name: 'ExampleBot',
      hostname: 'bot-5.crawl.example.org',
    });
  });

  it('knows Google, Bing and Apple by their documented domains', () => {
    expect(Object.fromEntries(KNOWN_CRAWLERS.map((c) => [c.name, c.domains]))).toEqual({
      Googlebot: ['googlebot.com'],
      Bingbot: ['search.msn.com'],
      Applebot: ['applebot.apple.com'],
    });
  });
});
