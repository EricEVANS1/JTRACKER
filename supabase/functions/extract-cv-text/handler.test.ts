import { describe, expect, it, vi } from 'vitest';

import {
  MAX_FILE_BYTES,
  createExtractCvTextHandler,
  getOwnedStoragePath,
  type ExtractCvTextDeps,
} from './handler.ts';

const SUPABASE_URL = 'https://project.supabase.co';
const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';
const fileFor = (userId: string, name = '1700000000000-cv.pdf') =>
  `${SUPABASE_URL}/storage/v1/object/public/cv-files/${userId}/${name}`;

// Alice is signed in and owns one CV file; Bob owns another.
const setup = (overrides: Partial<ExtractCvTextDeps> = {}) => {
  const owned = new Set([`${ALICE}|${fileFor(ALICE)}`, `${BOB}|${fileFor(BOB)}`]);
  const deps: ExtractCvTextDeps = {
    supabaseUrl: SUPABASE_URL,
    parserConfigured: true,
    getUser: vi.fn(async (authHeader: string) => (authHeader === 'Bearer alice-token' ? { id: ALICE } : null)),
    ownsCvFile: vi.fn(async (_auth: string, userId: string, fileUrl: string) => owned.has(`${userId}|${fileUrl}`)),
    downloadCvFile: vi.fn(async () => new Blob(['%PDF-1.4 alice cv'])),
    parseText: vi.fn(async () => 'Alice Example — Data Analyst'),
    log: vi.fn(),
    ...overrides,
  };

  return { deps, handle: createExtractCvTextHandler(deps) };
};

const post = (body: unknown, token: string | null = 'alice-token') =>
  new Request('https://project.supabase.co/functions/v1/extract-cv-text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const expectNothingProcessed = (deps: ExtractCvTextDeps) => {
  expect(deps.downloadCvFile).not.toHaveBeenCalled();
  expect(deps.parseText).not.toHaveBeenCalled();
};

describe('extract-cv-text: unauthenticated requests', () => {
  it('rejects a request with no Authorization header before reading the body', async () => {
    const { deps, handle } = setup();
    const res = await handle(post({ fileUrl: fileFor(ALICE) }, null));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized.' });
    expect(deps.getUser).not.toHaveBeenCalled();
    expectNothingProcessed(deps);
  });

  it('rejects an invalid or expired session token', async () => {
    const { deps, handle } = setup();
    const res = await handle(post({ fileUrl: fileFor(ALICE) }, 'forged-or-anon-key'));

    expect(res.status).toBe(401);
    expect(deps.ownsCvFile).not.toHaveBeenCalled();
    expectNothingProcessed(deps);
  });

  it('treats an auth lookup failure as unauthenticated', async () => {
    const { deps, handle } = setup({ getUser: vi.fn(async () => { throw new Error('auth down'); }) });
    const res = await handle(post({ fileUrl: fileFor(ALICE) }));

    expect(res.status).toBe(401);
    expectNothingProcessed(deps);
  });
});

describe('extract-cv-text: unauthorised access', () => {
  it("refuses another user's CV file", async () => {
    const { deps, handle } = setup();
    const res = await handle(post({ fileUrl: fileFor(BOB) }));

    expect(res.status).toBe(403);
    expect(deps.ownsCvFile).not.toHaveBeenCalled();
    expectNothingProcessed(deps);
  });

  it('refuses a file in the caller\'s folder that is not one of their CV versions', async () => {
    const { deps, handle } = setup();
    const res = await handle(post({ fileUrl: fileFor(ALICE, 'not-a-cv.pdf') }));

    expect(res.status).toBe(403);
    expect(deps.ownsCvFile).toHaveBeenCalledWith('Bearer alice-token', ALICE, fileFor(ALICE, 'not-a-cv.pdf'));
    expectNothingProcessed(deps);
  });

  it('refuses URLs outside this project\'s CV bucket (no arbitrary server-side fetches)', async () => {
    const { deps, handle } = setup();

    for (const fileUrl of [
      `https://attacker.example/storage/v1/object/public/cv-files/${ALICE}/cv.pdf`,
      'http://169.254.169.254/latest/meta-data/',
      `${SUPABASE_URL}/storage/v1/object/public/other-bucket/${ALICE}/cv.pdf`,
      `${SUPABASE_URL}/storage/v1/object/public/cv-files/${ALICE}/../${BOB}/1700000000000-cv.pdf`,
      `${SUPABASE_URL}/storage/v1/object/public/cv-files/${ALICE}/%2e%2e/${BOB}/cv.pdf`,
      'not a url',
    ]) {
      const res = await handle(post({ fileUrl }));
      expect(res.status, fileUrl).toBe(403);
    }

    expectNothingProcessed(deps);
  });

  it('gives the same answer for missing and foreign files, so files cannot be probed', async () => {
    const { handle } = setup();
    const foreign = await (await handle(post({ fileUrl: fileFor(BOB) }))).json();
    const missing = await (await handle(post({ fileUrl: fileFor(ALICE, 'missing.pdf') }))).json();

    expect(foreign).toEqual(missing);
  });
});

describe('extract-cv-text: authorised requests', () => {
  it('extracts text from the caller\'s own CV and keeps the response shape', async () => {
    const { deps, handle } = setup();
    const res = await handle(post({ fileUrl: fileFor(ALICE) }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'Alice Example — Data Analyst' });
    expect(deps.downloadCvFile).toHaveBeenCalledWith('Bearer alice-token', `${ALICE}/1700000000000-cv.pdf`);
    expect(deps.parseText).toHaveBeenCalledTimes(1);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('answers CORS preflight without authentication', async () => {
    const { deps, handle } = setup();
    const res = await handle(new Request('https://x/', { method: 'OPTIONS' }));

    expect(res.status).toBe(200);
    expect(deps.getUser).not.toHaveBeenCalled();
  });
});

describe('extract-cv-text: validation and failures', () => {
  it('rejects other methods and bad bodies', async () => {
    const { handle } = setup();

    expect((await handle(new Request('https://x/', { method: 'GET' }))).status).toBe(405);
    expect((await handle(post('{not json'))).status).toBe(400);
    expect(await (await handle(post({}))).json()).toEqual({ error: 'Missing fileUrl' });
  });

  it('rejects files larger than the upload limit before parsing', async () => {
    const { deps, handle } = setup({
      downloadCvFile: vi.fn(async () => new Blob([new Uint8Array(MAX_FILE_BYTES + 1)])),
    });
    const res = await handle(post({ fileUrl: fileFor(ALICE) }));

    expect(res.status).toBe(413);
    expect(deps.parseText).not.toHaveBeenCalled();
  });

  it('does not leak parser details or CV contents in responses or logs', async () => {
    const secret = 'upstream said: invalid key sk-live-123 for account acme';
    const { deps, handle } = setup({ parseText: vi.fn(async () => { throw new Error(secret); }) });
    const res = await handle(post({ fileUrl: fileFor(ALICE) }));
    const body = await res.text();
    const logged = JSON.stringify((deps.log as ReturnType<typeof vi.fn>).mock.calls);

    expect(res.status).toBe(502);
    expect(body).toBe(JSON.stringify({ error: 'Text extraction failed.' }));
    expect(logged).not.toContain('sk-live-123');
    expect(logged).not.toContain(ALICE);
    expect(logged).not.toContain('cv.pdf');
  });

  it('reports a missing parser configuration without calling the parser', async () => {
    const { deps, handle } = setup({ parserConfigured: false });
    const res = await handle(post({ fileUrl: fileFor(ALICE) }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Text extraction is not configured.' });
    expectNothingProcessed(deps);
  });
});

describe('getOwnedStoragePath', () => {
  it('returns the path only for the caller\'s folder in this project\'s CV bucket', () => {
    expect(getOwnedStoragePath(fileFor(ALICE), SUPABASE_URL, ALICE)).toBe(`${ALICE}/1700000000000-cv.pdf`);
    expect(getOwnedStoragePath(fileFor(ALICE, 'my%20cv.pdf'), SUPABASE_URL, ALICE)).toBe(`${ALICE}/my cv.pdf`);
    expect(getOwnedStoragePath(fileFor(BOB), SUPABASE_URL, ALICE)).toBeNull();
    expect(getOwnedStoragePath(`${SUPABASE_URL}/storage/v1/object/public/cv-files/${ALICE}`, SUPABASE_URL, ALICE)).toBeNull();
    expect(getOwnedStoragePath(`${SUPABASE_URL}/storage/v1/object/public/cv-files//${ALICE}/cv.pdf`, SUPABASE_URL, ALICE)).toBeNull();
  });
});
