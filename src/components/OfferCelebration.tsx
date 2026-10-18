import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, X } from 'lucide-react';

import {
  OFFER_CELEBRATION_EVENT,
  setCelebrationsEnabled,
  type OfferCelebrationDetail,
} from '../lib/offerCelebration';

// Fixed confetti layout (no randomness, so it looks the same every time):
// pieces burst up and out from behind the trophy, away from the text below.
const CONFETTI_COLOURS = ['bg-emerald-400', 'bg-amber-400', 'bg-indigo-400', 'bg-rose-400', 'bg-sky-400', 'bg-slate-900'];
const CONFETTI = Array.from({ length: 22 }, (_, index) => {
  const angle = (index / 22) * Math.PI * 2;
  const distance = 80 + (index % 4) * 20;
  return {
    x: Math.round(Math.cos(angle) * distance * 1.4),
    y: Math.round(-Math.abs(Math.sin(angle)) * distance - 12),
    rotate: (index % 2 ? 1 : -1) * (180 + index * 23),
    delay: (index % 5) * 40,
    colour: CONFETTI_COLOURS[index % CONFETTI_COLOURS.length],
    shape: index % 3 === 0 ? 'h-2 w-2 rounded-full' : 'h-2.5 w-1.5 rounded-[1px]',
  };
});

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

// Shown when a page reports a newly recorded offer (see lib/offerCelebration).
export const OfferCelebration: React.FC = () => {
  const [offer, setOffer] = useState<OfferCelebrationDetail | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [turnedOff, setTurnedOff] = useState(false);
  const viewButtonRef = useRef<HTMLAnchorElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<OfferCelebrationDetail>).detail;
      if (!detail?.applicationId) return;
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      setReducedMotion(prefersReducedMotion());
      setTurnedOff(false);
      setOffer(detail);
    };

    window.addEventListener(OFFER_CELEBRATION_EVENT, show);
    return () => window.removeEventListener(OFFER_CELEBRATION_EVENT, show);
  }, []);

  const close = useCallback(() => {
    setOffer(null);
    returnFocusRef.current?.focus?.();
  }, []);

  useEffect(() => {
    if (!offer) return;
    viewButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [offer, close]);

  if (!offer) return null;

  const role = offer.roleTitle?.trim();
  const company = offer.companyName?.trim();
  // "Acme Sp. z o.o." already ends the sentence.
  const fullStop = (text: string) => (text.endsWith('.') ? '' : '.');
  const motion = (className: string) => (reducedMotion ? '' : className);

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px] ${motion('animate-offer-fade')}`}
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="offer-celebration-title"
        aria-describedby="offer-celebration-details"
        onClick={(event) => event.stopPropagation()}
        className={`relative w-full max-w-sm rounded-2xl bg-white p-6 pt-8 text-center shadow-2xl ${motion('animate-offer-pop')}`}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <X size={16} />
        </button>

        <div className="relative mx-auto mb-4 h-16 w-16">
          {!reducedMotion && (
            <>
              <span aria-hidden="true" className="absolute inset-0 rounded-full bg-emerald-300/60 animate-offer-glow" />
              <span aria-hidden="true" data-offer-confetti className="pointer-events-none absolute left-1/2 top-1/2">
                {CONFETTI.map((piece, index) => (
                  <span
                    key={index}
                    className={`absolute -ml-1 -mt-1 ${piece.shape} ${piece.colour} animate-offer-confetti`}
                    style={
                      {
                        '--offer-x': `${piece.x}px`,
                        '--offer-y': `${piece.y}px`,
                        '--offer-r': `${piece.rotate}deg`,
                        animationDelay: `${piece.delay}ms`,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </span>
            </>
          )}
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/30">
            <Trophy size={28} />
          </div>
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">Offer received</p>
        <h2 id="offer-celebration-title" className="mt-1 text-xl font-semibold text-slate-900">
          Congratulations!
        </h2>
        <p id="offer-celebration-details" className="mt-2 text-sm text-slate-600 break-words">
          {role && company ? (
            <>
              You have an offer for <span className="font-medium text-slate-900">{role}</span> at{' '}
              <span className="font-medium text-slate-900">{company}</span>
              {fullStop(company)}
            </>
          ) : role ? (
            <>
              You have an offer for <span className="font-medium text-slate-900">{role}</span>
              {fullStop(role)}
            </>
          ) : company ? (
            <>
              You have an offer from <span className="font-medium text-slate-900">{company}</span>
              {fullStop(company)}
            </>
          ) : (
            'A new job offer is now in your tracker.'
          )}
        </p>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
          >
            Close
          </button>
          <Link
            ref={viewButtonRef}
            to={`/applications/${offer.applicationId}`}
            onClick={() => setOffer(null)}
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
          >
            View offer
          </Link>
        </div>

        <p className="mt-4 text-xs text-slate-400" role={turnedOff ? 'status' : undefined}>
          {turnedOff ? (
            'Celebrations are off. Turn them back on in Settings → Notifications.'
          ) : (
            <button
              type="button"
              onClick={() => {
                setCelebrationsEnabled(false);
                setTurnedOff(true);
              }}
              className="underline-offset-2 hover:text-slate-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 rounded"
            >
              Don’t show celebrations
            </button>
          )}
        </p>
      </div>
    </div>
  );
};
