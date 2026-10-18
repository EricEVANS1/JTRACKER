// Company logos for application cards, from the company's own website.
//
// JTracker has no logo service, so the only reliable identity is the website
// saved on the company. A logo is looked up only when that website is the
// company's own domain: job boards, applicant-tracking systems, social
// networks and site builders host many companies, so their icon would be the
// platform's, not the employer's. Anything else falls back to a neutral tile.

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
  'google.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com',
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

  return host;
};

// Icons the site itself publishes, best first. The touch icon is usually
// 180px; favicon.ico is the last resort.
export const companyLogoSources = (domain: string) => [
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
