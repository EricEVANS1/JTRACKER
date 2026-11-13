import { supabase } from './supabase';

export const CV_BUCKET = 'cv-files';
const storedUrlPrefix = `/storage/v1/object/public/${CV_BUCKET}/`;

// Existing CV rows store a URL. Use it only to recover the storage path.
export function getCvStoragePath(fileUrl: string, userId: string): string {
  const url = new URL(fileUrl);
  const projectOrigin = new URL(import.meta.env.VITE_SUPABASE_URL).origin;
  if (url.origin !== projectOrigin || !url.pathname.startsWith(storedUrlPrefix)) {
    throw new Error('This CV does not reference a JTracker storage file.');
  }

  const parts = url.pathname.slice(storedUrlPrefix.length).split('/').map(decodeURIComponent);
  if (parts[0] !== userId || parts.length < 2 ||
      parts.some((part) => !part || part === '.' || part === '..' || /[\\/]/.test(part) || part.includes(String.fromCharCode(0)))) {
    throw new Error('This CV file is unavailable for your account.');
  }
  return parts.join('/');
}

export async function readPrivateCv(fileUrl: string, userId: string) {
  const path = getCvStoragePath(fileUrl, userId);
  const { data, error } = await supabase.storage.from(CV_BUCKET).download(path);
  if (error || !data) throw new Error('Could not open the CV file. Please try again.');
  return { file: data, filename: path.split('/').pop()!.replace(/^\d+-/, '') };
}
