import { afterEach, expect, it, vi } from 'vitest';
import { cleanEvent, pageGroup } from './webAnalytics';

afterEach(() => vi.unstubAllGlobals());

it('groups private paths while keeping distinct product pages', () => {
  expect(pageGroup('/offers/new')).toBe('/offers/new');
  expect(pageGroup('/resume-builder/saved/private')).toBe('/resume-builder/saved/:id');
  expect(pageGroup('/secret')).toBe('/other');
});

it('limits events to the data needed for measured traffic', () => {
  vi.stubGlobal('location', new URL('https://example.com'));
  const result = cleanEvent({
    event: '$pageview', uuid: 'abc', $set: { email: 'sensitive' },
    properties: {
      $current_url: 'https://example.com/share/private?email=sensitive#token',
      $prev_pageview_pathname: '/applications/private', $elements: [{ text: 'private' }],
      $session_id: 'session', $prev_pageview_duration: 32,
    },
  });
  expect(result?.properties).toEqual({
    $current_url: 'https://example.com/share/:id', $pathname: '/share/:id',
    $host: 'example.com', $session_id: 'session', $prev_pageview_duration: 32,
    $prev_pageview_pathname: '/applications/:id',
  });
  expect(result?.$set).toBeUndefined();
  expect(cleanEvent({ uuid: 'abc', event: '$snapshot', properties: {} })).toBeNull();
});
