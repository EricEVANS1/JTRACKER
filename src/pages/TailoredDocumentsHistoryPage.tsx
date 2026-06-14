import React, { useEffect, useMemo, useState } from 'react';
import {
Download,
Edit3,
ExternalLink,
FileText,
Loader2,
Search,
Trash2,
} from 'lucide-react';

import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface TailoredDocument {
id: string;
cv_version_id: string | null;
job_title: string | null;
company_name: string | null;
generated_cv: string | null;
score: number | null;
created_at: string;
}

interface CVVersionMini {
id: string;
name: string | null;
target_role: string | null;
file_url: string | null;
last_score: number | null;
last_analyzed_at: string | null;
}

const PAGE_SIZE = 6;

const makeSafeFileName = (name: string) => {
return name
.replace(/[^a-zA-Z0-9-_ ]/g, '')
.replace(/\s+/g, '-')
.toLowerCase();
};

const exportAsDOCX = async (text: string, fileName: string) => {
if (!text.trim()) return;

const paragraphs = text.split('\n').map(
(line) =>
new Paragraph({
children: [
new TextRun({
text: line || ' ',
size: 22,
}),
],
spacing: {
after: line.trim() ? 120 : 80,
},
})
);

const doc = new Document({
sections: [
{
properties: {},
children: paragraphs,
},
],
});

const blob = await Packer.toBlob(doc);
saveAs(blob, fileName);
};

const formatDate = (date?: string | null) => {
if (!date) return 'Not set';

return new Date(date).toLocaleDateString('en-GB', {
day: 'numeric',
month: 'short',
year: 'numeric',
});
};

const getScoreLabel = (score?: number | null) => {
if (score === null || score === undefined) return 'Not scored';
if (score >= 85) return 'Strong';
if (score >= 70) return 'Good';
if (score >= 50) return 'Fair';
return 'Needs work';
};

const getScoreBadgeClass = (score?: number | null) => {
if (score === null || score === undefined) return 'bg-slate-100 text-slate-600';
if (score >= 70) return 'bg-emerald-50 text-emerald-700';
if (score >= 50) return 'bg-amber-50 text-amber-700';
return 'bg-red-50 text-red-700';
};

export const TailoredDocumentsHistoryPage: React.FC = () => {
const { user } = useAuth();

const [documents, setDocuments] = useState<TailoredDocument[]>([]);
const [cvVersionsById, setCvVersionsById] = useState<Record<string, CVVersionMini>>({});

const [searchTerm, setSearchTerm] = useState('');
const [activeSearch, setActiveSearch] = useState('');
const [page, setPage] = useState(1);

const [loading, setLoading] = useState(true);
const [deletingId, setDeletingId] = useState<string | null>(null);
const [error, setError] = useState('');

const fetchDocuments = async () => {
if (!user) return;


setLoading(true);
setError('');

const { data: analysisData, error: analysisError } = await supabase
  .from('cv_analyses')
  .select(
    'id, cv_version_id, job_title, company_name, generated_cv, score, created_at'
  )
  .eq('user_id', user.id)
  .not('generated_cv', 'is', null)
  .order('created_at', { ascending: false });

if (analysisError) {
  setError(analysisError.message);
  setDocuments([]);
  setCvVersionsById({});
  setLoading(false);
  return;
}

const safeDocuments = (analysisData || []) as TailoredDocument[];
setDocuments(safeDocuments);

const cvVersionIds = Array.from(
  new Set(
    safeDocuments
      .map((item) => item.cv_version_id)
      .filter((id): id is string => Boolean(id))
  )
);

if (cvVersionIds.length === 0) {
  setCvVersionsById({});
  setLoading(false);
  return;
}

const { data: cvVersionData, error: cvVersionError } = await supabase
  .from('cv_versions')
  .select('id, name, target_role, file_url, last_score, last_analyzed_at')
  .in('id', cvVersionIds)
  .eq('user_id', user.id);

if (cvVersionError) {
  setError(cvVersionError.message);
  setCvVersionsById({});
  setLoading(false);
  return;
}

const nextMap: Record<string, CVVersionMini> = {};

((cvVersionData || []) as CVVersionMini[]).forEach((item) => {
  nextMap[item.id] = item;
});

setCvVersionsById(nextMap);
setLoading(false);


};

useEffect(() => {
fetchDocuments();
}, [user?.id]);

const getCVVersion = (document: TailoredDocument) => {
if (!document.cv_version_id) return null;
return cvVersionsById[document.cv_version_id] || null;
};

const getCVName = (document: TailoredDocument) => {
const cvVersion = getCVVersion(document);


return (
  cvVersion?.name ||
  document.job_title ||
  cvVersion?.target_role ||
  'Untitled CV'
);


};

const filteredDocuments = useMemo(() => {
const value = activeSearch.trim().toLowerCase();


if (!value) return documents;

return documents.filter((item) => {
  const cvName = getCVName(item);
  const company = item.company_name || '';
  const role = item.job_title || '';
  const cvVersion = getCVVersion(item);
  const targetRole = cvVersion?.target_role || '';

  return `${cvName} ${company} ${role} ${targetRole}`.toLowerCase().includes(value);
});


}, [documents, activeSearch, cvVersionsById]);

const totalPages = Math.max(Math.ceil(filteredDocuments.length / PAGE_SIZE), 1);

const paginatedDocuments = useMemo(() => {
const safePage = Math.min(page, totalPages);
const start = (safePage - 1) * PAGE_SIZE;


return filteredDocuments.slice(start, start + PAGE_SIZE);


}, [filteredDocuments, page, totalPages]);

const handleSearch = () => {
setActiveSearch(searchTerm);
setPage(1);
};

const handleDownload = async (document: TailoredDocument) => {
if (!document.generated_cv?.trim()) return;


const cvName = getCVName(document);
const companyPart = document.company_name ? `-${document.company_name}` : '';
const rolePart = document.job_title ? `-${document.job_title}` : '';

const fileName = `${makeSafeFileName(`${cvName}${companyPart}${rolePart}`)}.docx`;

await exportAsDOCX(document.generated_cv, fileName);


};

const handleEdit = (document: TailoredDocument) => {
window.location.href = `/resume-builder/${document.id}`;
};

const handleDelete = async (documentId: string) => {
const confirmed = window.confirm(
'Delete this tailored CV from your history? This will remove the generated CV result from this analysis.'
);


if (!confirmed) return;

setDeletingId(documentId);
setError('');

const { error } = await supabase
  .from('cv_analyses')
  .update({
    generated_cv: null,
  })
  .eq('id', documentId)
  .eq('user_id', user?.id);

if (error) {
  setError(error.message);
  setDeletingId(null);
  return;
}

setDocuments((prev) => prev.filter((item) => item.id !== documentId));
setDeletingId(null);


};

return ( <div className="w-full max-w-6xl overflow-hidden"> <div className="mb-8"> <p className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 mb-4"> <FileText size={14} />
Resume Builder </p>


    <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
      Tailored documents history
    </h1>

    <p className="text-slate-600 mt-3 max-w-2xl">
      View, download, edit, or delete tailored CVs generated from CV Intelligence.
    </p>
  </div>

  <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm mb-6">
    <label className="block text-sm font-medium text-slate-700 mb-2">
      Search
    </label>

    <div className="flex flex-col sm:flex-row gap-3">
      <div className="relative flex-1">
        <Search
          size={18}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
        />

        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
          }}
          placeholder="Search by company name"
          className="w-full rounded-xl border border-slate-300 pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
      </div>

      <button
        type="button"
        onClick={handleSearch}
        className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-600 transition"
      >
        Search
      </button>
    </div>
  </div>

  {error && (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 mb-6">
      {error}
    </div>
  )}

  <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
    {loading ? (
      <div className="p-10 flex items-center justify-center gap-3 text-slate-500">
        <Loader2 size={18} className="animate-spin" />
        Loading tailored documents...
      </div>
    ) : paginatedDocuments.length === 0 ? (
      <div className="p-10 text-center">
        <FileText size={34} className="mx-auto text-slate-300 mb-3" />

        <h2 className="font-semibold text-slate-800">
          No tailored documents found
        </h2>

        <p className="text-sm text-slate-500 mt-1">
          Generate a tailored CV from CV Intelligence and it will appear here.
        </p>
      </div>
    ) : (
      <div className="divide-y divide-slate-200">
        {paginatedDocuments.map((document) => {
          const cvName = getCVName(document);
          const cvVersion = getCVVersion(document);
          const score = document.score ?? null;

          return (
            <div
              key={document.id}
              className="p-4 sm:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
            >
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                  Resume
                </p>

                <h3 className="font-semibold text-slate-900 break-words">
                  {cvName}
                </h3>

                <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-slate-500">
                  <span>
                    {document.company_name || 'N/A'}
                  </span>

                  {document.job_title && (
                    <>
                      <span>·</span>
                      <span>{document.job_title}</span>
                    </>
                  )}

                  {cvVersion?.target_role && (
                    <>
                      <span>·</span>
                      <span>{cvVersion.target_role}</span>
                    </>
                  )}

                  {score !== null && (
                    <>
                      <span>·</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${getScoreBadgeClass(score)}`}
                      >
                        {score}/100 · {getScoreLabel(score)}
                      </span>
                    </>
                  )}

                  <span>·</span>
                  <span>{formatDate(document.created_at)}</span>

                  {cvVersion?.file_url && (
                    <a
                      href={cvVersion.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900"
                    >
                      Source CV
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleDownload(document)}
                  disabled={!document.generated_cv}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-600 transition disabled:opacity-50"
                >
                  <Download size={16} />
                  Download
                </button>

                <button
                  type="button"
                  onClick={() => handleEdit(document)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  <Edit3 size={16} />
                  Edit
                </button>

                <button
                  type="button"
                  onClick={() => handleDelete(document.id)}
                  disabled={deletingId === document.id}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition disabled:opacity-50"
                >
                  {deletingId === document.id ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>

  {!loading && filteredDocuments.length > 0 && (
    <div className="flex items-center justify-center gap-2 mt-6">
      <button
        type="button"
        onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
        disabled={page === 1}
        className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        Previous
      </button>

      <span className="inline-flex items-center justify-center min-w-10 h-10 rounded-xl bg-yellow-400 border border-yellow-500 text-sm font-semibold text-slate-900">
        {page}
      </span>

      <button
        type="button"
        onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
        disabled={page >= totalPages}
        className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
      >
        Next
      </button>
    </div>
  )}
</div>


);
};
