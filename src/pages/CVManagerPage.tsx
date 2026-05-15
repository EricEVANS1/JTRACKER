import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  FileText,
  Plus,
  Trash2,
  Upload,
  X,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface CVVersion {
  id: string;
  name: string;
  target_role: string | null;
  notes: string | null;
  file_url: string | null;
  created_at: string;
}

interface ApplicationRecord {
  id: string;
  cv_version_id: string | null;
  status: string;
}

type UploadState = 'idle' | 'uploading' | 'done' | 'error';

const ACCEPTED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const ACCEPTED_EXT = '.pdf,.doc,.docx';
const MAX_MB = 10;
const BUCKET = 'cv-files';

const inputCls =
  'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent ' +
  'placeholder:text-slate-400 transition';

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const ext = (filename: string) =>
  filename.split('.').pop()?.toUpperCase() ?? 'FILE';

const StatBox: React.FC<{
  label: string;
  value: string | number;
  accent?: boolean;
}> = ({ label, value, accent }) => (
  <div
    className={`rounded-xl p-3 border ${
      accent
        ? 'bg-slate-900 border-slate-800 text-white'
        : 'bg-slate-50 border-slate-200'
    }`}
  >
    <p className={`text-xs mb-0.5 ${accent ? 'text-slate-400' : 'text-slate-500'}`}>
      {label}
    </p>
    <p className="text-xl font-bold">{value}</p>
  </div>
);

const DropZone: React.FC<{
  file: File | null;
  uploadState: UploadState;
  progress: number;
  onFile: (f: File) => void;
  onClear: () => void;
}> = ({ file, uploadState, progress, onFile, onClear }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);

      const dropped = e.dataTransfer.files[0];
      if (dropped && ACCEPTED_TYPES.includes(dropped.type)) {
        onFile(dropped);
      }
    },
    [onFile]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (picked) onFile(picked);
    e.target.value = '';
  };

  if (file) {
    return (
      <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-200 flex items-center justify-center shrink-0">
            <FileText size={16} className="text-slate-600" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate">{file.name}</p>
            <p className="text-xs text-slate-500">
              {ext(file.name)} · {formatBytes(file.size)}
            </p>

            {uploadState === 'uploading' && (
              <div className="mt-1.5 h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-slate-800 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>

          {uploadState === 'done' && (
            <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
          )}

          {uploadState === 'error' && (
            <AlertCircle size={18} className="text-red-500 shrink-0" />
          )}

          {uploadState === 'idle' && (
            <button
              type="button"
              onClick={onClear}
              className="text-slate-400 hover:text-slate-700 transition"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDrop={handleDrop}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      className={`
        border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition
        ${
          dragging
            ? 'border-slate-500 bg-slate-100'
            : 'border-slate-200 hover:border-slate-400 hover:bg-slate-50'
        }
      `}
    >
      <Upload size={20} className="mx-auto mb-2 text-slate-400" />
      <p className="text-sm font-medium text-slate-600">
        Drop your CV here, or <span className="underline">browse</span>
      </p>
      <p className="text-xs text-slate-400 mt-1">
        PDF, DOC, DOCX · Max {MAX_MB} MB
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXT}
        onChange={handleFileInput}
        className="hidden"
      />
    </div>
  );
};

export const CVManagerPage: React.FC = () => {
  const { user } = useAuth();

  const [cvVersions, setCvVersions] = useState<CVVersion[]>([]);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [targetRole, setTargetRole] = useState('');
  const [notes, setNotes] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('');

  const fetchCVVersions = async () => {
    if (!user) return;

    setLoading(true);

    const { data, error } = await supabase
      .from('cv_versions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) setError(error.message);
    else setCvVersions(data ?? []);

    setLoading(false);
  };

  const fetchApplications = async () => {
    if (!user) return;

    const { data } = await supabase
      .from('applications')
      .select('id, cv_version_id, status')
      .eq('user_id', user.id);

    setApplications(data ?? []);
  };

  useEffect(() => {
    fetchCVVersions();
    fetchApplications();
  }, [user]);

  const getCVStats = (cvId: string) => {
    const linked = applications.filter((a) => a.cv_version_id === cvId);

    const total = linked.length;
    const interviews = linked.filter((a) =>
      ['interview', 'final_interview'].includes(a.status)
    ).length;
    const offers = linked.filter((a) => a.status === 'offer').length;
    const rejections = linked.filter((a) => a.status === 'rejected').length;

    const interviewRate = total > 0 ? Math.round((interviews / total) * 100) : 0;
    const offerRate = total > 0 ? Math.round((offers / total) * 100) : 0;

    return {
      total,
      interviews,
      offers,
      rejections,
      interviewRate,
      offerRate,
    };
  };

  const getPreviewUrl = (url: string) => {
    const lower = url.toLowerCase();

    if (lower.includes('.pdf')) {
      return url;
    }

    return `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(url)}`;
  };

  const handleOpenPreview = (cv: CVVersion) => {
    if (!cv.file_url) return;

    setPreviewUrl(getPreviewUrl(cv.file_url));
    setPreviewName(cv.name);
  };

  const closePreview = () => {
    setPreviewUrl(null);
    setPreviewName('');
  };

  const handleFileSelect = (f: File) => {
    if (f.size > MAX_MB * 1024 * 1024) {
      setError(`File is too large. Maximum size is ${MAX_MB} MB.`);
      return;
    }

    if (!ACCEPTED_TYPES.includes(f.type)) {
      setError('Invalid file type. Please upload a PDF, DOC, or DOCX file.');
      return;
    }

    setFile(f);
    setUploadState('idle');
    setUploadProgress(0);
    setError('');
  };

  const uploadFile = async (): Promise<string | null> => {
    if (!file || !user) return null;

    setUploadState('uploading');
    setUploadProgress(0);

    const progressInterval = window.setInterval(() => {
      setUploadProgress((p) => (p < 85 ? Math.round(p + Math.random() * 15) : p));
    }, 300);

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${user.id}/${Date.now()}-${safeName}`;

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    window.clearInterval(progressInterval);

    if (uploadErr) {
      setUploadState('error');
      setError(`Upload failed: ${uploadErr.message}`);
      return null;
    }

    setUploadProgress(100);
    setUploadState('done');

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    return data.publicUrl;
  };

  const handleCreateCV = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user || !name.trim()) return;

    setSaving(true);
    setError('');

    let fileUrl: string | null = null;

    if (file) {
      fileUrl = await uploadFile();

      if (!fileUrl) {
        setSaving(false);
        return;
      }
    }

    const { error: dbErr } = await supabase.from('cv_versions').insert({
      user_id: user.id,
      name: name.trim(),
      target_role: targetRole.trim() || null,
      notes: notes.trim() || null,
      file_url: fileUrl,
    });

    if (dbErr) {
      setError(dbErr.message);
      setSaving(false);
      return;
    }

    setName('');
    setTargetRole('');
    setNotes('');
    setFile(null);
    setUploadState('idle');
    setUploadProgress(0);
    setShowForm(false);

    await fetchCVVersions();

    setSaving(false);
  };

  const handleDelete = async (cv: CVVersion) => {
    if (!user) return;

    const confirmed = window.confirm(`Delete "${cv.name}"? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingId(cv.id);

    if (cv.file_url) {
      try {
        const url = new URL(cv.file_url);
        const parts = url.pathname.split(`/object/public/${BUCKET}/`);
        const path = parts[1];

        if (path) {
          await supabase.storage.from(BUCKET).remove([path]);
        }
      } catch {
        // Storage cleanup should not block DB deletion.
      }
    }

    const { error } = await supabase
      .from('cv_versions')
      .delete()
      .eq('id', cv.id)
      .eq('user_id', user.id);

    if (error) {
      setError(error.message);
    } else {
      setCvVersions((prev) => prev.filter((c) => c.id !== cv.id));
    }

    setDeletingId(null);
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-3xl font-bold mb-1">CV Manager</h2>
          <p className="text-slate-500 text-sm">
            Store and compare resume versions by role — see which one performs best.
          </p>
        </div>

        <button
          onClick={() => {
            setShowForm((p) => !p);
            setError('');
          }}
          className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm inline-flex items-center gap-2 self-start md:self-auto hover:bg-slate-700 transition"
        >
          {showForm ? <X size={16} /> : <Plus size={16} />}
          {showForm ? 'Close' : 'Add CV Version'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6 flex items-start gap-3">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span className="flex-1 text-sm">{error}</span>

          <button
            onClick={() => setError('')}
            className="text-red-400 hover:text-red-600"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={handleCreateCV}
          className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 mb-8"
        >
          <h3 className="text-lg font-semibold mb-1">New CV Version</h3>
          <p className="text-sm text-slate-500 mb-6">
            Give it a clear name so you can tell versions apart at a glance.
          </p>

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
            Details
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Name *
              </span>

              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Backend Engineer v3"
                className={inputCls}
                required
                autoFocus
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Target role
              </span>

              <input
                value={targetRole}
                onChange={(e) => setTargetRole(e.target.value)}
                placeholder="e.g. Junior Software Developer"
                className={inputCls}
              />
            </label>
          </div>

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
            File
          </p>

          <div className="mb-6">
            <DropZone
              file={file}
              uploadState={uploadState}
              progress={uploadProgress}
              onFile={handleFileSelect}
              onClear={() => {
                setFile(null);
                setUploadState('idle');
              }}
            />

            {uploadState === 'error' && (
              <p className="text-xs text-red-500 mt-2">
                Upload failed. Make sure you have a Supabase Storage bucket named{' '}
                <code className="font-mono">cv-files</code> with public access enabled.
              </p>
            )}
          </div>

          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
            Notes
          </p>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What's different in this version? Key skills emphasised, length, tailored for..."
            rows={3}
            className={`${inputCls} resize-y mb-6`}
          />

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="border border-slate-200 px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving || uploadState === 'uploading'}
              className="bg-slate-900 text-white px-5 py-2 rounded-lg text-sm disabled:opacity-50 transition hover:bg-slate-700 inline-flex items-center gap-2"
            >
              {saving
                ? uploadState === 'uploading'
                  ? `Uploading ${uploadProgress}%…`
                  : 'Saving…'
                : 'Save CV Version'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm">Loading CV versions…</p>
      ) : cvVersions.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-10 text-center">
          <FileText size={32} className="mx-auto text-slate-300 mb-3" />

          <h3 className="text-lg font-semibold mb-1">No CV versions yet</h3>

          <p className="text-slate-500 text-sm">
            Add your first version to start tracking which resume performs best.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {cvVersions.map((cv) => {
            const stats = getCVStats(cv.id);
            const isDeleting = deletingId === cv.id;

            return (
              <div
                key={cv.id}
                className={`bg-white border border-slate-200 rounded-2xl shadow-sm p-6 transition-opacity ${
                  isDeleting ? 'opacity-50 pointer-events-none' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                      <FileText size={18} className="text-slate-600" />
                    </div>

                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-slate-900 leading-tight truncate">
                        {cv.name}
                      </h3>

                      {cv.target_role && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          ↳ {cv.target_role}
                        </p>
                      )}

                      <p className="text-xs text-slate-400 mt-1">
                        Added{' '}
                        {new Date(cv.created_at).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {cv.file_url && (
                      <button
                        type="button"
                        onClick={() => handleOpenPreview(cv)}
                        title="Preview CV"
                        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition inline-flex items-center gap-1 text-xs font-medium"
                      >
                        <ExternalLink size={14} />
                        Open
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(cv)}
                      title="Delete CV version"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {!cv.file_url && (
                  <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 border border-slate-200 border-dashed rounded-lg px-3 py-2 mb-4">
                    <Upload size={12} />
                    No file attached — add a PDF or DOCX
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 mb-4">
                  <StatBox label="Applications" value={stats.total} />
                  <StatBox label="Interviews" value={stats.interviews} />
                  <StatBox label="Offers" value={stats.offers} accent={stats.offers > 0} />
                  <StatBox label="Rejections" value={stats.rejections} />
                  <StatBox label="Interview rate" value={`${stats.interviewRate}%`} />
                  <StatBox label="Offer rate" value={`${stats.offerRate}%`} />
                </div>

                {cv.notes && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                    {cv.notes}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-6xl h-[88vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-800 truncate">
                  Preview: {previewName}
                </h3>
                <p className="text-xs text-slate-400">
                  Viewing inside the app
                </p>
              </div>

              <button
                type="button"
                onClick={closePreview}
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition"
              >
                <X size={18} />
              </button>
            </div>

            <iframe
              src={previewUrl}
              title={previewName}
              className="w-full flex-1 bg-slate-100"
            />
          </div>
        </div>
      )}
    </div>
  );
};

