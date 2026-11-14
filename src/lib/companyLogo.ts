// Company logos are resolved by the employer's own domain, never its ambiguous
// company name. Shared job-board and ATS hosts must not be mistaken for employers.

// Hosts shared by many companies (matched with their subdomains).
const SHARED_HOSTS = [
  // Job boards and aggregators
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'pracuj.pl', 'justjoin.it', 'nofluffjobs.com', 'theprotocol.it',
  'bulldogjob.pl', 'crossweb.pl', 'adzuna.com', 'monster.com', 'totaljobs.com', 'reed.co.uk', 'stepstone.de',
  'xing.com', 'wellfound.com', 'angel.co', 'otta.com', 'welcometothejungle.com', 'olx.pl', 'jooble.org',
  // Applicant-tracking systems
  'myworkdayjobs.com', 'workday.com', 'greenhouse.io', 'lever.co', 'smartrecruiters.com', 'teamtailor.com',
  'recruitee.com', 'bamboohr.com', 'ashbyhq.com', 'workable.com', 'jobvite.com', 'icims.com', 'taleo.net',
  'successfactors.com', 'personio.de', 'personio.com', 'breezy.hr', 'jazzhr.com', 'pinpointhq.com',
  'erecruiter.pl', 'elevatus.io',
  // Social networks, search and site builders
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com',
  'github.com', 'gitlab.com', 'medium.com', 'notion.site', 'wixsite.com', 'squarespace.com', 'wordpress.com',
  'blogspot.com', 'sites.google.com', 'linktr.ee', 'goo.gl', 'bit.ly',
];

const isSharedHost = (host: string) => SHARED_HOSTS.some((shared) => host === shared || host.endsWith(`.${shared}`));

// The company's own domain from its saved website ("acme.com"), or null when
// there is none or it doesn't identify the company on its own.
export const companyLogoDomain = (website: string | null | undefined): string | null => {
  const value = (website || '').trim();
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\d?\./, '');
  // A real public domain: has a dot, a letter TLD, and isn't an IP address or local name.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host) || host.endsWith('.local')) return null;
  if (isSharedHost(host)) return null;

  // Careers subdomains usually belong to the employer's main site. Ask the
  // provider for that brand rather than a potentially unrecognised subdomain.
  const employerDomain = host.replace(/^(?:jobs|careers|apply|recruitment)\./, '');
  return isSharedHost(employerDomain) ? null : employerDomain;
};

// Only infer an employer from a job link when it is not a generic Google
// search, redirect, or hosted document. An explicitly saved company website
// may still legitimately be google.com.
export const companyLogoDomainFromJobLink = (link: string | null | undefined): string | null => {
  const domain = companyLogoDomain(link);
  if (!domain) return null;
  if (domain !== 'google.com') return domain;
  try {
    const url = new URL(link!);
    return /^\\/(?:about\\/careers|careers|jobs)(?:\\/|$)/i.test(url.pathname) ? domain : null;
  } catch {
    return null;
  }
};

// Use Logo.dev when a browser-safe *publishable* key is configured. Asking for
// fallback=404 avoids displaying Logo.dev's generated monogram instead of the
// distinctive JTracker fallback tile. Without a key, still try the site's icons.
export const companyLogoSources = (domain: string, publishableKey = '', size = 128) => [
  ...(publishableKey.trim() ? [
    `https://img.logo.dev/${domain}?${new URLSearchParams({
      token: publishableKey.trim(),
      size: String(size),
      fallback: '404',
    }).toString()}`,
  ] : []),
  `https://${domain}/apple-touch-icon.png`,
  `https://${domain}/favicon.ico`,
];

// Smaller icons look blurry at card size, so they count as missing.
export const MIN_LOGO_SIZE = 32;

// Per page load: the icon that worked for a domain, or null when none did,
// so a list of cards doesn't request the same failing icons again.
const resolvedLogos = new Map<string, string | null>();

export const getResolvedLogo = (domain: string) => resolvedLogos.get(domain);
export const setResolvedLogo = (domain: string, src: string | null) => void resolvedLogos.set(domain, src);
export const resetResolvedLogosForTests = () => resolvedLogos.clear();
