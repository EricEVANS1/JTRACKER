import React, { useState } from 'react';

import {
  companyLogoDomain,
  companyLogoSources,
  getResolvedLogo,
  MIN_LOGO_SIZE,
  setResolvedLogo,
} from '../lib/companyLogo';

interface CompanyLogoProps {
  website?: string | null;
  // Shown when there's no logo: the card's usual icon tile.
  fallback: React.ReactNode;
  // Tile size in pixels.
  size: number;
  className?: string;
}

// The company's own site icon over the card's usual tile. The tile shows
// straight away and stays if the website doesn't identify the company, or the
// icon is missing, fails or is too small to look sharp.
export const CompanyLogo: React.FC<CompanyLogoProps> = (props) => {
  const domain = companyLogoDomain(props.website);
  // A different company starts its lookup afresh.
  return <CompanyLogoImage key={domain ?? 'none'} {...props} domain={domain} />;
};

const CompanyLogoImage: React.FC<CompanyLogoProps & { domain: string | null }> = ({
  domain,
  fallback,
  size,
  className = '',
}) => {
  const known = domain ? getResolvedLogo(domain) : null;
  const sources = domain ? companyLogoSources(domain) : [];

  // The source being tried, or the one that already worked on this page.
  const [attempt, setAttempt] = useState(() => (known ? Math.max(sources.indexOf(known), 0) : 0));
  const [loaded, setLoaded] = useState(Boolean(known));

  const failedBefore = domain !== null && known === null;
  const src = !domain || failedBefore || attempt >= sources.length ? null : sources[attempt];

  const tryNext = () => {
    if (!domain) return;
    if (attempt + 1 >= sources.length) setResolvedLogo(domain, null);
    setAttempt((value) => value + 1);
    setLoaded(false);
  };

  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      {fallback}
      {src && (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          data-company-logo={domain}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth < MIN_LOGO_SIZE || image.naturalHeight < MIN_LOGO_SIZE) {
              tryNext();
              return;
            }
            setResolvedLogo(domain!, src);
            setLoaded(true);
          }}
          onError={tryNext}
          className={`absolute inset-0 h-full w-full rounded-xl border border-slate-200 bg-white object-contain p-1 transition-opacity duration-300 motion-reduce:transition-none ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  );
};
