import { describe, expect, it } from 'vitest';

import {
  clearAllDrafts,
  clearDraft,
  draftDiffersFrom,
  getDraftKey,
  readDraft,
  serializeEditorState,
  writeDraft,
} from './resumeDraft';

const memoryStorage = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
  };
};

const draft = (summary: string) => ({
  resume: { personal: { fullName: 'Alice' }, summary },
  formatting: { fontSize: 11 },
  savedVersion: null,
  savedAt: '2026-10-17T10:00:00.000Z',
});

describe('getDraftKey', () => {
  it('keys drafts by user and by what is being edited', () => {
    expect(getDraftKey({ userId: 'u1', cvVersionId: 'v1', analysisId: 'a1' })).toBe('jtracker_resume_draft:u1:saved:v1');
    expect(getDraftKey({ userId: 'u1', analysisId: 'a1' })).toBe('jtracker_resume_draft:u1:analysis:a1');
    expect(getDraftKey({ userId: 'u1' })).toBe('jtracker_resume_draft:u1:new');
    expect(getDraftKey({ userId: 'u2' })).not.toBe(getDraftKey({ userId: 'u1' }));
  });
});

describe('draft storage', () => {
  it('round-trips a draft and clears it', () => {
    const storage = memoryStorage();
    expect(writeDraft('k', draft('Hello'), storage)).toBe(true);
    expect(readDraft('k', storage)).toEqual(draft('Hello'));

    clearDraft('k', storage);
    expect(readDraft('k', storage)).toBeNull();
  });

  it('ignores corrupt or incomplete drafts', () => {
    const storage = memoryStorage();
    storage.setItem('bad-json', '{not json');
    storage.setItem('no-resume', JSON.stringify({ savedAt: 'x' }));

    expect(readDraft('bad-json', storage)).toBeNull();
    expect(readDraft('no-resume', storage)).toBeNull();
    expect(readDraft('missing', storage)).toBeNull();
  });

  it('reports a failed write instead of throwing (storage full or blocked)', () => {
    const full = { ...memoryStorage(), setItem: () => { throw new Error('QuotaExceededError'); } } as Storage;
    expect(writeDraft('k', draft('x'), full)).toBe(false);
    expect(writeDraft('k', draft('x'), null)).toBe(false);
  });

  it('clears only Resume Builder drafts on sign-out', () => {
    const storage = memoryStorage();
    writeDraft(getDraftKey({ userId: 'u1', cvVersionId: 'v1' }), draft('a'), storage);
    writeDraft(getDraftKey({ userId: 'u1' }), draft('b'), storage);
    storage.setItem('jtracker_gmail_token', 'keep');

    clearAllDrafts(storage);

    expect(storage.length).toBe(1);
    expect(storage.getItem('jtracker_gmail_token')).toBe('keep');
  });
});

describe('draftDiffersFrom', () => {
  it('offers a draft only when it holds different content', () => {
    const loaded = serializeEditorState(draft('Hello').resume, draft('Hello').formatting);

    expect(draftDiffersFrom(draft('Hello'), loaded)).toBe(false);
    expect(draftDiffersFrom(draft('Edited'), loaded)).toBe(true);
    expect(draftDiffersFrom(null, loaded)).toBe(false);
  });
});
