import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { CV_BUCKET, createExtractCvTextHandler } from './handler.ts';

console.log('EXTRACT CV TEXT VERSION 3 RUNNING');

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const apiKey = Deno.env.get('PARSER_API_KEY') ?? '';
const apiUrl = Deno.env.get('PARSER_API_URL') ?? '';

// Acts as the caller (anon key + their session token), so Row Level Security
// and storage policies apply. No service-role key is used here.
const clientFor = (authHeader: string) =>
  createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

const tokenFrom = (authHeader: string) => authHeader.replace(/^Bearer\s+/i, '');

const parseText = async (file: Blob) => {
  const form = new FormData();
  form.append('file', file, 'cv.pdf');
  form.append('result_type', 'text');

  const uploadRes = await fetch(`${apiUrl}/api/parsing/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!uploadRes.ok) {
    throw new Error(`Parser upload failed with status ${uploadRes.status}`);
  }

  const uploadData = await uploadRes.json();
  const jobId = uploadData.id;
  let extractedText = '';

  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const resultRes = await fetch(`${apiUrl}/api/parsing/job/${jobId}/result/text`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (resultRes.ok) {
      extractedText = await resultRes.text();

      if (extractedText?.trim()) {
        break;
      }
    }
  }

  return extractedText;
};

Deno.serve(
  createExtractCvTextHandler({
    supabaseUrl,
    parserConfigured: Boolean(apiKey && apiUrl),

    getUser: async (authHeader) => {
      const { data, error } = await clientFor(authHeader).auth.getUser(tokenFrom(authHeader));
      return error || !data.user ? null : { id: data.user.id };
    },

    ownsCvFile: async (authHeader, userId, fileUrl) => {
      const { data, error } = await clientFor(authHeader)
        .from('cv_versions')
        .select('id')
        .eq('user_id', userId)
        .eq('file_url', fileUrl)
        .limit(1);

      return !error && (data?.length ?? 0) > 0;
    },

    downloadCvFile: async (authHeader, path) => {
      // Prefer downloading as the caller so storage policies apply.
      const { data, error } = await clientFor(authHeader).storage.from(CV_BUCKET).download(path);
      if (!error && data) return data;

      // The bucket currently serves CVs by public URL. The path has already been
      // checked to be in this project's bucket and the caller's own folder.
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      const res = await fetch(`${supabaseUrl}/storage/v1/object/public/${CV_BUCKET}/${encodedPath}`);
      return res.ok ? await res.blob() : null;
    },

    parseText,

    log: (message, details) => console.error(message, details ?? {}),
  }),
);
