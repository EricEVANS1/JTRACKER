// Unsaved Resume Builder edits, kept in sessionStorage so a reload, a closed
// route or the browser Back button doesn't lose them. sessionStorage is per
// tab and is cleared when the tab closes; drafts are also removed on sign-out,
// so CV text isn't left behind on a shared computer.

const DRAFT_PREFIX = 'jtracker_resume_draft:';

export interface ResumeDraft<TResume = unknown, TFormatting = unknown, TVersion = unknown> {
  resume: TResume;
  formatting: TFormatting;
  // The CV version Save would update when the draft was written, if any.
  savedVersion: TVersion | null;
  savedAt: string;
}

export interface DraftSource {
  userId: string;
  cvVersionId?: string | null;
  analysisId?: string | null;
}

// One draft per user and per thing being edited.
export const getDraftKey = ({ userId, cvVersionId, analysisId }: DraftSource) =>
  `${DRAFT_PREFIX}${userId}:${cvVersionId ? `saved:${cvVersionId}` : analysisId ? `analysis:${analysisId}` : 'new'}`;

// What counts as an edit: the resume content and its formatting.
export const serializeEditorState = (resume: unknown, formatting: unknown) =>
  JSON.stringify({ resume, formatting });

const defaultStorage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

export const readDraft = <TResume, TFormatting, TVersion>(
  key: string,
  storage: Storage | null = defaultStorage(),
): ResumeDraft<TResume, TFormatting, TVersion> | null => {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;

    const draft = JSON.parse(raw) as ResumeDraft<TResume, TFormatting, TVersion>;
    if (!draft || typeof draft !== 'object' || !draft.resume || !draft.savedAt) return null;

    return draft;
  } catch {
    return null;
  }
};

// Returns false when the draft couldn't be stored (storage full or blocked).
export const writeDraft = (
  key: string,
  draft: ResumeDraft,
  storage: Storage | null = defaultStorage(),
) => {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
};

export const clearDraft = (key: string, storage: Storage | null = defaultStorage()) => {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing to clear.
  }
};

export const clearAllDrafts = (storage: Storage | null = defaultStorage()) => {
  try {
    if (!storage) return;

    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
    }

    keys.forEach((key) => storage.removeItem(key));
  } catch {
    // Nothing to clear.
  }
};

// True when the draft holds edits that differ from what was just loaded.
export const draftDiffersFrom = (draft: ResumeDraft | null, loadedSnapshot: string) =>
  !!draft && serializeEditorState(draft.resume, draft.formatting) !== loadedSnapshot;
