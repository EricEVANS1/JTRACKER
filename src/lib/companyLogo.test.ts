import { describe, expect, it } from 'vitest';

import { companyLogoDomain, companyLogoSources } from './companyLogo';

describe('companyLogoDomain', () => {
  it("takes the company's own domain from its website", () => {
    expect(companyLogoDomain('https://www.acme.com/careers?ref=x')).toBe('acme.com');
    expect(companyLogoDomain('acme.co.uk')).toBe('acme.co.uk');
    expect(companyLogoDomain('http://Jobs.Globex.PL/')).toBe('jobs.globex.pl');
    expect(companyLogoDomain('  https://www2.initech.com  ')).toBe('initech.com');
  });

  it('ignores sites shared by many companies, whose icon is not the employer', () => {
    for (const website of [
      'https://www.linkedin.com/company/acme',
      'https://pl.linkedin.com/company/acme',
      'https://boards.greenhouse.io/acme',
      'https://jobs.lever.co/acme',
      'https://acme.wd3.myworkdayjobs.com/careers',
      'https://www.pracuj.pl/pracodawcy/acme',
      'https://github.com/acme',
      'https://acme.wixsite.com/home',
    ]) {
      expect(companyLogoDomain(website)).toBeNull();
    }
  });

  it('needs a real public domain', () => {
    for (const website of [null, undefined, '', 'Acme', 'localhost:3000', 'http://192.168.0.1', 'ftp://acme.com', 'https://intranet.local', 'not a url']) {
      expect(companyLogoDomain(website)).toBeNull();
    }
  });
});

describe('companyLogoSources', () => {
  it("lists the site's own icons, best first", () => {
    expect(companyLogoSources('acme.com')).toEqual([
      'https://acme.com/apple-touch-icon.png',
      'https://acme.com/favicon.ico',
    ]);
  });
});
