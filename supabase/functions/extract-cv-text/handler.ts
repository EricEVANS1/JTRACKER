// Request handling for extract-cv-text, kept free of Deno and Supabase imports
// so it can be unit tested. index.ts wires in the real dependencies.
//
// Every check runs before the file is downloaded or sent to the paid parser:
//   1. the caller must send a valid Supabase session token;
//   2. fileUrl must point into this project's cv-files bucket, inside the
//      caller's own folder (no other hosts, so no arbitrary server-side fetches);
//   3. one of the caller's own cv_versions rows must reference that file
//      (looked up with the caller's token, so Row Level Security applies).

export const CV_BUCKET = 'cv-files';

// Matches the upload limit in CV Manager.
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export interface ExtractCvTextDeps {
  // Base URL of this Supabase project, e.g. https://abc.supabase.co
  supabaseUrl: string;
  // Returns the signed-in user for the Authorization header, or null.
  getUser: (authHeader: string) => Promise<{ id: string } | null>;
  // True when a cv_versions row visible to the caller (RLS) belongs to them
  // and references fileUrl.
  ownsCvFile: (authHeader: string, userId: string, fileUrl: string) => Promise<boolean>;
  // Downloads the object at path from the CV bucket as the caller.
  downloadCvFile: (authHeader: string, path: string) => Promise<Blob | null>;
  // Sends the file to the text parser and returns the extracted text.
  parseText: (file: Blob) => Promise<string>;
  // True when the parser's API key and URL are configured.
  parserConfigured: boolean;
  log?: (message: string, details?: Record<string, unknown>) => void;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Returns the storage path for fileUrl when it is a public URL in this
// project's CV bucket inside userId's folder; otherwise null.
export const getOwnedStoragePath = (fileUrl: string, supabaseUrl: string, userId: string) => {
  let url: URL;
  let base: URL;

  try {
    url = new URL(fileUrl);
    base = new URL(supabaseUrl);
  } catch {
    return null;
  }

  if (url.origin !== base.origin) return null;

  const prefix = `/storage/v1/object/public/${CV_BUCKET}/`;
  if (!url.pathname.startsWith(prefix)) return null;

  let path: string;
  try {
    path = decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    return null;
  }

  const segments = path.split('/');
  if (segments.length < 2 || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return null;
  }

  return segments[0] === userId ? path : null;
};

export const createExtractCvTextHandler = (deps: ExtractCvTextDeps) => {
  const log = deps.log ?? (() => {});

  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405);
    }

    const authHeader = req.headers.get('Authorization') || '';

    if (!/^Bearer\s+\S+/.test(authHeader)) {
      return json({ error: 'Unauthorized.' }, 401);
    }

    const user = await deps.getUser(authHeader).catch(() => null);

    if (!user) {
      return json({ error: 'Unauthorized.' }, 401);
    }

    let fileUrl: unknown;

    try {
      ({ fileUrl } = await req.json());
    } catch {
      return json({ error: 'Invalid request body.' }, 400);
    }

    if (typeof fileUrl !== 'string' || !fileUrl.trim()) {
      return json({ error: 'Missing fileUrl' }, 400);
    }

    const path = getOwnedStoragePath(fileUrl, deps.supabaseUrl, user.id);
    const allowed = path ? await deps.ownsCvFile(authHeader, user.id, fileUrl).catch(() => false) : false;

    if (!path || !allowed) {
      // Same response whether the file exists or not, so other users' files
      // can't be probed.
      return json({ error: 'You can only extract text from your own CV files.' }, 403);
    }

    if (!deps.parserConfigured) {
      log('[extract-cv-text] parser is not configured');
      return json({ error: 'Text extraction is not configured.' }, 500);
    }

    try {
      const file = await deps.downloadCvFile(authHeader, path);

      if (!file) {
        log('[extract-cv-text] download failed', { step: 'download' });
        return json({ error: 'Could not read the CV file.' }, 404);
      }

      if (file.size > MAX_FILE_BYTES) {
        return json({ error: 'CV file is too large to extract.' }, 413);
      }

      const text = await deps.parseText(file);
      return json({ text });
    } catch (err) {
      // Keep parser and storage details out of the response and the logs.
      log('[extract-cv-text] extraction failed', {
        step: 'parse',
        error: err instanceof Error ? err.name : 'unknown',
      });
      return json({ error: 'Text extraction failed.' }, 502);
    }
  };
};
