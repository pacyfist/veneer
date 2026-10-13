/// <reference types="node" />
import { Resolver } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * A search crawler that can be verified by DNS: the operator publishes the
 * domains its crawler IPs reverse-resolve to.
 */
export interface VeneerCrawler {
  /** A name to report, such as `'Googlebot'`. */
  readonly name: string;
  /**
   * User-agent tokens this crawler sends. Only used to skip the DNS lookups
   * for requests that do not even claim to be this crawler; a matching
   * user-agent proves nothing, since anyone can send it.
   */
  readonly userAgent: RegExp;
  /**
   * Domains the crawler's reverse DNS names end in. A name matches a domain
   * when it equals it or ends in `.` plus it.
   */
  readonly domains: readonly string[];
}

/**
 * The crawlers `verifyCrawler()` knows, with the domains their operators
 * document for reverse DNS verification: Google's common crawlers
 * (googlebot.com: `crawl-*.googlebot.com`, `geo-crawl-*.geo.googlebot.com`),
 * Bing (search.msn.com) and Apple (applebot.apple.com).
 *
 * Not google.com: Google's special-case crawlers and user-triggered fetchers
 * (AdsBot, `rate-limited-proxy-*.google.com`, `google-proxy-*.google.com`)
 * resolve there, and those fetch on behalf of ads checks or of whoever asked,
 * not for the search index. Kept short on purpose; pass your own list to
 * `createCrawlerVerifier({ crawlers })` to accept more.
 */
export const KNOWN_CRAWLERS: readonly VeneerCrawler[] = [
  {
    name: 'Googlebot',
    userAgent: /Googlebot|Google-InspectionTool|GoogleOther|Storebot-Google/i,
    domains: ['googlebot.com'],
  },
  {
    name: 'Bingbot',
    userAgent: /bingbot|BingPreview|adidxbot|MicrosoftPreview/i,
    domains: ['search.msn.com'],
  },
  { name: 'Applebot', userAgent: /Applebot/i, domains: ['applebot.apple.com'] },
];

/** The DNS lookups the verifier needs; `node:dns/promises`' `Resolver` fits. */
export interface CrawlerDnsResolver {
  reverse(ip: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}

export interface CrawlerVerifierOptions {
  /** The crawlers to accept. Defaults to {@link KNOWN_CRAWLERS}. */
  crawlers?: readonly VeneerCrawler[];
  /** Where lookups go. Defaults to a `node:dns/promises` `Resolver`. */
  resolver?: CrawlerDnsResolver;
  /**
   * Milliseconds one verification may take before it gives up and reports
   * "not a crawler". Defaults to 2000. A timeout is not cached.
   */
  timeout?: number;
  /** Milliseconds a lookup result is reused for an IP. Defaults to one hour. */
  ttl?: number;
  /** IPs kept in the cache; the oldest go first. Defaults to 10,000. */
  maxEntries?: number;
}

/** A crawler whose IP passed reverse and forward DNS verification. */
export interface VerifiedCrawler {
  /** The `name` of the matching {@link VeneerCrawler}. */
  readonly name: string;
  /** The reverse DNS name that resolved back to the IP. */
  readonly hostname: string;
}

/** Verifies one request's IP, optionally with its user-agent. */
export type CrawlerVerifier = (
  ip: string,
  userAgent?: string | null,
) => Promise<VerifiedCrawler | null>;

/** DNS answers that mean "no such record", as opposed to a failed lookup. */
const NO_RECORD = new Set(['ENOTFOUND', 'ENODATA', 'NOTFOUND', 'NODATA']);

class Transient extends Error {}

function noRecord(error: unknown): boolean {
  return NO_RECORD.has((error as { code?: string } | null)?.code ?? '');
}

/** `::ffff:1.2.3.4` (how Node reports IPv4 clients on a dual-stack socket) as `1.2.3.4`. */
function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed);
  return mapped ? mapped[1] : trimmed;
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

function inDomain(hostname: string, domain: string): boolean {
  const d = normalizeHost(domain);
  return hostname === d || hostname.endsWith('.' + d);
}

/** Whether `address` is the same IP as `ip`, however either is written. */
function sameAddress(ip: string, family: 4 | 6, address: string): boolean {
  const type = family === 4 ? 'ipv4' : 'ipv6';
  try {
    const list = new BlockList();
    list.addAddress(ip, type);
    return list.check(address, type);
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Transient(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Builds a crawler verifier with its own cache. Most apps use the shared
 * {@link verifyCrawler}; create one to change the crawlers, the timeout, the
 * cache, or to inject a resolver in tests.
 */
export function createCrawlerVerifier(options: CrawlerVerifierOptions = {}): CrawlerVerifier {
  const crawlers = options.crawlers ?? KNOWN_CRAWLERS;
  const timeout = options.timeout ?? 2000;
  const ttl = options.ttl ?? 60 * 60 * 1000;
  const maxEntries = options.maxEntries ?? 10_000;
  let resolver = options.resolver;
  const domains = crawlers.flatMap((crawler) => crawler.domains);

  /** Per IP: its reverse DNS names that resolve back to it, within `domains`. */
  const cache = new Map<string, { expires: number; names: Promise<string[]> }>();

  async function confirmedNames(ip: string, family: 4 | 6): Promise<string[]> {
    resolver ??= new Resolver({ timeout, tries: 1 });
    const dns = resolver;
    let names: string[];
    try {
      names = await dns.reverse(ip);
    } catch (error) {
      if (noRecord(error)) return [];
      throw new Transient(String((error as Error)?.message ?? error));
    }
    const candidates = [
      ...new Set(names.map(normalizeHost).filter((name) => domains.some((d) => inDomain(name, d)))),
    ];
    const confirmed = await Promise.all(
      candidates.map(async (name) => {
        try {
          const addresses = await (family === 4 ? dns.resolve4(name) : dns.resolve6(name));
          return addresses.some((address) => sameAddress(ip, family, address)) ? name : null;
        } catch (error) {
          if (noRecord(error)) return null;
          throw new Transient(String((error as Error)?.message ?? error));
        }
      }),
    );
    return confirmed.filter((name): name is string => name !== null);
  }

  function lookup(ip: string, family: 4 | 6): Promise<string[]> {
    const now = Date.now();
    const hit = cache.get(ip);
    if (hit && hit.expires > now) return hit.names;
    if (hit) cache.delete(ip);

    // Stored before it settles, so concurrent requests from one IP share a
    // lookup. A failed lookup (not a "no record" answer) is dropped again.
    const names = confirmedNames(ip, family);
    const entry = { expires: now + ttl, names };
    cache.set(ip, entry);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
    names.catch(() => {
      if (cache.get(ip) === entry) cache.delete(ip);
    });
    return names;
  }

  return async (rawIp, userAgent) => {
    const ip = normalizeIp(rawIp ?? '');
    const family = isIP(ip);
    if (family !== 4 && family !== 6) return null;

    const claimed =
      userAgent == null
        ? crawlers
        : crawlers.filter((crawler) => {
            crawler.userAgent.lastIndex = 0;
            return crawler.userAgent.test(userAgent);
          });
    if (claimed.length === 0) return null;

    const pending = lookup(ip, family);
    let names: string[];
    try {
      names = await withTimeout(pending, timeout);
    } catch {
      // A timeout or a failed lookup: not verified, so not a crawler. A
      // lookup that hangs is dropped too, so the next request tries afresh.
      if (cache.get(ip)?.names === pending) cache.delete(ip);
      return null;
    }
    for (const crawler of claimed) {
      const hostname = names.find((name) => crawler.domains.some((d) => inDomain(name, d)));
      if (hostname) return { name: crawler.name, hostname };
    }
    return null;
  };
}

let shared: CrawlerVerifier | undefined;

/**
 * Whether a request comes from a search crawler, verified the way Google and
 * Bing document it: the IP's reverse DNS name must end in one of the
 * crawler's domains (googlebot.com, search.msn.com, applebot.apple.com), and
 * that name must resolve forward to the same IP. A user-agent alone is never
 * trusted. Server only (`node:dns/promises`).
 *
 * ```ts
 * // server.ts
 * const crawler = await verifyCrawler(req.ip ?? '', req.get('user-agent'));
 * angularApp.handle(req, { crawler });
 * ```
 *
 * Pass the client's IP. Behind a proxy or CDN, configure Express `trust proxy`
 * for exactly your proxies so `req.ip` is the client's address; an
 * `X-Forwarded-For` header from anyone else is whatever they want it to be.
 *
 * The user-agent is optional: when given, only the crawlers it claims to be
 * are checked, and a request claiming none resolves to null without any DNS
 * lookup. Results are cached per IP for an hour; a lookup that fails or takes
 * longer than two seconds resolves to null and is not cached. Never rejects.
 */
export function verifyCrawler(
  ip: string,
  userAgent?: string | null,
): Promise<VerifiedCrawler | null> {
  return (shared ??= createCrawlerVerifier())(ip, userAgent);
}
