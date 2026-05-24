import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Brain,
  CheckCircle2,
  ExternalLink,
  FileText,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useOnboarding } from '../hooks/useOnboarding';
import { OnboardingHint } from '../components/OnboardingHint';
import { CVIntelligenceDrawer } from '../components/cv-intelligence/CVIntelligenceDrawer';

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
  'border border-slate-200 rounded-xl px-3 py-2.5 text-sm w-full bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder:text-slate-400 transition';

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
    className={`rounded-2xl p-4 border transition hover:shadow-sm ${
      accent
        ? 'bg-slate-900 border-slate-800 text-white'
        : 'bg-white border-slate-200 text-slate-900'
    }`}
  >
    <p className={`text-xs mb-1 ${accent ? 'text-slate-400' : 'text-slate-500'}`}>
      {label}
    </p>
    <p className="text-2xl font-bold">{value}</p>
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
      <div className="border border-slate-200 rounded-2xl p-4 bg-white">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 flex items-center justify-center shrink-0">
            <FileText size={18} className="text-indigo-600" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800 break-words">
              {file.name}
            </p>
            <p className="text-xs text-slate-500">
              {ext(file.name)} · {formatBytes(file.size)}
            </p>

            {uploadState === 'uploading' && (
              <div className="mt-3 h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 rounded-full transition-all duration-300"
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
              className="text-slate-400 hover:text-slate-700 transition shrink-0"
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
      className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition ${
        dragging
          ? 'border-indigo-500 bg-indigo-50'
          : 'border-slate-200 hover:border-indigo-400 hover:bg-slate-50'
      }`}
    >
      <div className="w-12 h-12 rounded-2xl bg-slate-100 mx-auto mb-3 flex items-center justify-center">
        <Upload size={22} className="text-slate-500" />
      </div>

      <p className="text-sm font-semibold text-slate-700">
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
  const { onboardingComplete, completedSteps, refreshOnboarding } = useOnboarding();

  const [cvVersions, setCvVersions] = useState<CVVersion[]>([]);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [name, setName] = useState('');
  const [targetRole, setTargetRole] = useState('');
  const [notes, setNotes] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('');

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedCV, setSelectedCV] = useState<{ id: string; name: string } | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const filteredCVs = useMemo(() => {
    const q = search.trim().toLowerCase();

    if (!q) return cvVersions;

    return cvVersions.filter((cv) =>
      [cv.name, cv.target_role, cv.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [cvVersions, search]);

  const dashboardStats = useMemo(() => {
    const attached = cvVersions.filter((cv) => cv.file_url).length;
    const totalApps = applications.length;
    const offers = applications.filter((a) => a.status === 'offer').length;
    const interviews = applications.filter((a) =>
      ['interview', 'final_interview'].includes(a.status)
    ).length;

    return {
      totalCVs: cvVersions.length,
      attached,
      totalApps,
      interviews,
      offers,
    };
  }, [cvVersions, applications]);

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
    await refreshOnboarding();

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
      await refreshOnboarding();
    }

    setDeletingId(null);
  };

  return (
    <div className="w-full max-w-full overflow-hidden space-y-8">
      <section className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 border border-white/10 px-3 py-1 text-xs text-indigo-100 mb-4">
              <Sparkles size={14} />
              CV Intelligence workspace
            </div>

            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              CV Manager
            </h2>

            <p className="text-slate-300 text-sm sm:text-base mt-2 max-w-2xl">
              Store CV versions, compare performance, preview files, and analyze each resume against job descriptions.
            </p>
          </div>

          <button
            onClick={() => {
              setShowForm((p) => !p);
              setError('');
            }}
            className="w-full sm:w-auto bg-white text-slate-900 px-5 py-3 rounded-2xl text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-indigo-50 transition"
          >
            {showForm ? <X size={16} /> : <Plus size={16} />}
            {showForm ? 'Close form' : 'Add CV Version'}
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-8">
          <StatBox label="CV versions" value={dashboardStats.totalCVs} accent />
          <StatBox label="Files attached" value={dashboardStats.attached} accent />
          <StatBox label="Applications" value={dashboardStats.totalApps} accent />
          <StatBox label="Interviews" value={dashboardStats.interviews} accent />
          <StatBox label="Offers" value={dashboardStats.offers} accent />
        </div>
      </section>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span className="flex-1 text-sm break-words">{error}</span>

          <button
            onClick={() => setError('')}
            className="text-red-400 hover:text-red-600 shrink-0"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {!onboardingComplete && !completedSteps.hasCV && (
        <OnboardingHint
          title="Upload your first CV version"
          description="This helps JTracker compare which resume versions perform best across applications."
          actionLabel="Add CV Version"
          onAction={() => setShowForm(true)}
        />
      )}

      {showForm && (
        <form
          onSubmit={handleCreateCV}
          className="bg-white border border-slate-200 rounded-3xl shadow-sm p-5 sm:p-8 overflow-hidden"
        >
          <div className="flex items-start gap-3 mb-8">
            <div className="w-11 h-11 rounded-2xl bg-indigo-50 flex items-center justify-center shrink-0">
              <FileText size={18} className="text-indigo-600" />
            </div>

            <div>
              <h3 className="text-xl font-bold text-slate-900">New CV Version</h3>
              <p className="text-sm text-slate-500 mt-1">
                Give this version a clear name and attach the actual document.
              </p>
            </div>
          </div>

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
              <p className="text-xs text-red-500 mt-2 break-words">
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

          <div className="flex flex-col sm:flex-row sm:justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="w-full sm:w-auto border border-slate-200 px-5 py-2.5 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving || uploadState === 'uploading'}
              className="w-full sm:w-auto bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm disabled:opacity-50 transition hover:bg-slate-700 inline-flex items-center justify-center gap-2"
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

      <section className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-900">Your CV versions</h3>
          <p className="text-sm text-slate-500">
            {filteredCVs.length} version{filteredCVs.length === 1 ? '' : 's'} shown
          </p>
        </div>

        <div className="relative w-full md:w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search CV versions..."
            className="w-full rounded-2xl border border-slate-200 bg-white pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </section>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-8 text-slate-500 text-sm">
          Loading CV versions…
        </div>
      ) : filteredCVs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-10 text-center">
          <FileText size={34} className="mx-auto text-slate-300 mb-3" />

          <h3 className="text-lg font-semibold mb-1">No CV versions found</h3>

          <p className="text-slate-500 text-sm">
            Add your first version or adjust your search.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {filteredCVs.map((cv) => {
            const stats = getCVStats(cv.id);
            const isDeleting = deletingId === cv.id;

            return (
              <div
                key={cv.id}
                className={`group bg-white border border-slate-200 rounded-3xl shadow-sm p-5 sm:p-6 transition hover:shadow-md hover:border-indigo-200 overflow-hidden ${
                  isDeleting ? 'opacity-50 pointer-events-none' : ''
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center shrink-0">
                      <FileText size={20} className="text-indigo-600" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900 leading-tight break-words">
                          {cv.name}
                        </h3>

                        {cv.file_url ? (
                          <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 text-[11px] font-semibold">
                            File attached
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-50 text-amber-700 border border-amber-100 px-2 py-0.5 text-[11px] font-semibold">
                            No file
                          </span>
                        )}
                      </div>

                      {cv.target_role && (
                        <p className="text-xs text-slate-500 mt-1 break-words">
                          Target: {cv.target_role}
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

                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 shrink-0">
                    {cv.file_url && (
                      <button
                        type="button"
                        onClick={() => handleOpenPreview(cv)}
                        title="Preview CV"
                        className="w-full sm:w-auto px-3 py-2 rounded-xl text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition inline-flex items-center justify-center gap-1 text-xs font-semibold border border-slate-200"
                      >
                        <ExternalLink size={14} />
                        Open
                      </button>
                    )}

                    {cv.file_url && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCV({
                            id: cv.id,
                            name: cv.name,
                          });
                          setDrawerOpen(true);
                        }}
                        title="Analyze CV"
                        className="w-full sm:w-auto px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 transition inline-flex items-center justify-center gap-1 text-xs font-semibold"
                      >
                        <Brain size={14} />
                        Analyze
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(cv)}
                      title="Delete CV version"
                      className="w-full sm:w-auto px-3 py-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition inline-flex items-center justify-center gap-1 border border-slate-200 text-xs font-semibold"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>

                {!cv.file_url && (
                  <div className="flex items-center gap-2 text-xs text-slate-500 bg-amber-50 border border-amber-100 rounded-2xl px-3 py-3 mb-4">
                    <Upload size={13} className="shrink-0 text-amber-600" />
                    <span className="break-words">
                      Attach a PDF or DOCX to enable CV Intelligence analysis.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                  <StatBox label="Applications" value={stats.total} />
                  <StatBox label="Interviews" value={stats.interviews} />
                  <StatBox label="Offers" value={stats.offers} accent={stats.offers > 0} />
                  <StatBox label="Rejections" value={stats.rejections} />
                  <StatBox label="Interview rate" value={`${stats.interviewRate}%`} />
                  <StatBox label="Offer rate" value={`${stats.offerRate}%`} />
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 size={15} className="text-slate-500" />
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Version notes
                    </p>
                  </div>

                  {cv.notes ? (
                    <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed break-words">
                      {cv.notes}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-400">
                      No notes added for this version.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {previewUrl && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-6xl h-[95vh] sm:h-[88vh] flex flex-col overflow-hidden">
            <div className="flex items-start sm:items-center justify-between gap-3 px-4 sm:px-5 py-4 border-b border-slate-200">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-800 break-words">
                  Preview: {previewName}
                </h3>
                <p className="text-xs text-slate-400">Viewing inside JTracker</p>
              </div>

              <button
                type="button"
                onClick={closePreview}
                className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition shrink-0"
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

      <CVIntelligenceDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedCV(null);
        }}
        cvVersionId={selectedCV?.id ?? null}
        cvName={selectedCV?.name}
      />
    </div>
  );
};