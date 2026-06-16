import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
AlertCircle,
ArrowLeft,
ArrowRight,
Brain,
Briefcase,
CheckCircle2,
ClipboardList,
Copy,
Download,
Edit3,
FileText,
History,
Loader2,
Search,
Sparkles,
Target,
Wand2,
XCircle,
} from 'lucide-react';

import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useCVAnalysis } from '../hooks/useCVAnalysis';

interface CVVersion {
id: string;
name: string;
target_role: string | null;
file_url: string | null;
cv_text: string | null;
cv_text_extracted_at: string | null;
last_score: number | null;
last_analyzed_at: string | null;
created_at: string;
}

interface ApplicationItem {
id: string;
role_title: string;
status: string;
company_id: string | null;
created_at: string;
}

interface CompanyMini {
id: string;
name: string;
}

interface AnalysisResult {
id: string;
cv_version_id: string;
job_title: string | null;
company_name: string | null;
score: number;
matched_keywords: string[] | null;
partial_keywords: string[] | null;
missing_keywords: string[] | null;
strengths: unknown;
gaps: unknown;
suggestions: string[] | null;
generated_cv: string | null;
extended_data?: Record<string, unknown> | null;
created_at?: string;
}

const inputCls =
'w-full rounded-xl border border-slate-300 px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-500';

const steps = [
'Choose CV',
'Paste job description',
'Analyse match',
'Tailored CV',
];

const formatDate = (date?: string | null) => {
if (!date) return 'Not set';

return new Date(date).toLocaleDateString('en-GB', {
day: 'numeric',
month: 'short',
year: 'numeric',
});
};

const makeSafeFileName = (name: string) => {
return name
.replace(/[^a-zA-Z0-9-_ ]/g, '')
.replace(/\s+/g, '-')
.toLowerCase();
};

const getScoreLabel = (score?: number | null) => {
if (score === null || score === undefined) return 'Not scored';
if (score >= 85) return 'Strong';
if (score >= 70) return 'Good';
if (score >= 50) return 'Fair';
return 'Needs work';
};

const getScoreBadgeClass = (score?: number | null) => {
if (score === null || score === undefined) return 'bg-slate-100 text-slate-600 border-slate-200';
if (score >= 70) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
if (score >= 50) return 'bg-amber-50 text-amber-700 border-amber-200';
return 'bg-red-50 text-red-700 border-red-200';
};

const getRecommendation = (analysis: AnalysisResult | null) => {
if (!analysis) {
return {
label: 'Not analysed yet',
description: 'Run the analysis to get an apply recommendation.',
className: 'bg-slate-50 text-slate-700 border-slate-200',
};
}

const raw =
analysis.extended_data?.recommended_to_apply ||
analysis.extended_data?.recommendation ||
'';

const value = String(raw).toLowerCase();

if (value.includes('yes')) {
return {
label: 'Recommended to apply',
description: 'This role looks realistic. Review the tailored CV before applying.',
className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
}

if (value.includes('no')) {
return {
label: 'Improve before applying',
description: 'The CV needs stronger alignment before you apply.',
className: 'bg-red-50 text-red-700 border-red-200',
};
}

if (analysis.score >= 70) {
return {
label: 'Good opportunity',
description: 'The score is strong enough to continue tailoring.',
className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};
}

if (analysis.score >= 50) {
return {
label: 'Maybe apply',
description: 'Improve the missing keywords before applying.',
className: 'bg-amber-50 text-amber-700 border-amber-200',
};
}

return {
label: 'Needs work',
description: 'The CV is not aligned enough yet.',
className: 'bg-red-50 text-red-700 border-red-200',
};
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

export const ResumeBuilderFlowPage: React.FC = () => {
const { user } = useAuth();
const navigate = useNavigate();

const {
analysis,
error: analysisError,
analyzeCV,
isAnalyzing,
isDone,
progressMessage,
progressPercent,
resetAnalysis,
} = useCVAnalysis();

const [cvVersions, setCvVersions] = useState<CVVersion[]>([]);
const [applications, setApplications] = useState<ApplicationItem[]>([]);
const [companiesById, setCompaniesById] = useState<Record<string, CompanyMini>>({});

const [selectedCvId, setSelectedCvId] = useState('');
const [selectedApplicationId, setSelectedApplicationId] = useState('');

const [search, setSearch] = useState('');
const [applicationSearch, setApplicationSearch] = useState('');
const [jobDescription, setJobDescription] = useState('');

const [manualTextOpen, setManualTextOpen] = useState(false);
const [manualCvText, setManualCvText] = useState('');
const [savingManualText, setSavingManualText] = useState(false);

const [loading, setLoading] = useState(true);
const [loadingApplications, setLoadingApplications] = useState(true);
const [attaching, setAttaching] = useState(false);

const [pageError, setPageError] = useState('');
const [message, setMessage] = useState('');
const [attachedApplicationId, setAttachedApplicationId] = useState<string | null>(null);
const [copied, setCopied] = useState(false);

const result = analysis as unknown as AnalysisResult | null;

const selectedCv = useMemo(() => {
return cvVersions.find((item) => item.id === selectedCvId) || null;
}, [cvVersions, selectedCvId]);

const selectedApplication = useMemo(() => {
return applications.find((item) => item.id === selectedApplicationId) || null;
}, [applications, selectedApplicationId]);

const activeStep = useMemo(() => {
if (isDone && result) return 4;
if (isAnalyzing) return 3;
if (jobDescription.trim()) return 2;
if (selectedCvId) return 1;
return 1;
}, [isDone, result, isAnalyzing, jobDescription, selectedCvId]);

const filteredCVs = useMemo(() => {
const term = search.trim().toLowerCase();


if (!term) return cvVersions;

return cvVersions.filter((cv) => {
  return `${cv.name} ${cv.target_role || ''}`.toLowerCase().includes(term);
});


}, [cvVersions, search]);

const filteredApplications = useMemo(() => {
const term = applicationSearch.trim().toLowerCase();


if (!term) return applications;

return applications.filter((application) => {
  const companyName = application.company_id
    ? companiesById[application.company_id]?.name || ''
    : '';

  return `${application.role_title} ${application.status} ${companyName}`
    .toLowerCase()
    .includes(term);
});


}, [applications, applicationSearch, companiesById]);

const generatedCvText = result?.generated_cv || '';

const fetchCVVersions = async () => {
if (!user) return;


setLoading(true);
setPageError('');

const { data, error } = await supabase
  .from('cv_versions')
  .select(
    'id, name, target_role, file_url, cv_text, cv_text_extracted_at, last_score, last_analyzed_at, created_at'
  )
  .eq('user_id', user.id)
  .order('created_at', { ascending: false });

if (error) {
  setPageError(error.message);
  setCvVersions([]);
  setLoading(false);
  return;
}

setCvVersions((data || []) as CVVersion[]);
setLoading(false);


};

const fetchApplications = async () => {
if (!user) return;


setLoadingApplications(true);

const { data: applicationData, error: applicationError } = await supabase
  .from('applications')
  .select('id, role_title, status, company_id, created_at')
  .eq('user_id', user.id)
  .or('archived.is.false,archived.is.null')
  .neq('status', 'archived')
  .order('created_at', { ascending: false });

if (applicationError) {
  setPageError(applicationError.message);
  setApplications([]);
  setCompaniesById({});
  setLoadingApplications(false);
  return;
}

const safeApplications = (applicationData || []) as ApplicationItem[];
setApplications(safeApplications);

const companyIds = Array.from(
  new Set(
    safeApplications
      .map((item) => item.company_id)
      .filter((id): id is string => Boolean(id))
  )
);

if (companyIds.length === 0) {
  setCompaniesById({});
  setLoadingApplications(false);
  return;
}

const { data: companyData, error: companyError } = await supabase
  .from('companies')
  .select('id, name')
  .in('id', companyIds)
  .eq('user_id', user.id);

if (companyError) {
  setPageError(companyError.message);
  setCompaniesById({});
  setLoadingApplications(false);
  return;
}

const nextCompanies: Record<string, CompanyMini> = {};

((companyData || []) as CompanyMini[]).forEach((company) => {
  nextCompanies[company.id] = company;
});

setCompaniesById(nextCompanies);
setLoadingApplications(false);


};

useEffect(() => {
fetchCVVersions();
fetchApplications();
}, [user?.id]);

useEffect(() => {
if (selectedCv) {
setManualCvText(selectedCv.cv_text || '');
}
}, [selectedCv?.id]);

const getCompanyName = (application: ApplicationItem) => {
if (!application.company_id) return 'No company';
return companiesById[application.company_id]?.name || 'Unknown company';
};

const handleSaveManualText = async () => {
if (!user || !selectedCv) return;


if (!manualCvText.trim()) {
  setPageError('Paste the CV text before saving.');
  return;
}

setSavingManualText(true);
setPageError('');
setMessage('');

const { error } = await supabase
  .from('cv_versions')
  .update({
    cv_text: manualCvText.trim(),
    cv_text_extracted_at: new Date().toISOString(),
  })
  .eq('id', selectedCv.id)
  .eq('user_id', user.id);

if (error) {
  setPageError(error.message);
  setSavingManualText(false);
  return;
}

setCvVersions((prev) =>
  prev.map((cv) =>
    cv.id === selectedCv.id
      ? {
          ...cv,
          cv_text: manualCvText.trim(),
          cv_text_extracted_at: new Date().toISOString(),
        }
      : cv
  )
);

setMessage('CV text saved successfully.');
setManualTextOpen(false);
setSavingManualText(false);


};

const handleAnalyse = async () => {
setPageError('');
setMessage('');
setAttachedApplicationId(null);
setCopied(false);

if (!selectedCv) {
  setPageError('Choose a CV first.');
  return;
}

if (!selectedCv.cv_text?.trim()) {
  setPageError('This CV has no extracted text. Paste the CV text manually before analysing.');
  setManualTextOpen(true);
  return;
}

if (!jobDescription.trim()) {
  setPageError('Paste a job description before analysing.');
  return;
}

await analyzeCV({
  cvVersionId: selectedCv.id,
  jobDescription: jobDescription.trim(),
});


};

const handleCopy = async () => {
if (!generatedCvText.trim()) return;


await navigator.clipboard.writeText(generatedCvText);
setCopied(true);

window.setTimeout(() => setCopied(false), 2000);


};

const handleDownload = async () => {
if (!generatedCvText.trim()) return;


const baseName = makeSafeFileName(
  `${result?.job_title || selectedCv?.target_role || selectedCv?.name || 'tailored-cv'}`
);

await exportAsDOCX(generatedCvText, `${baseName}.docx`);


};

const handleAttachToApplication = async () => {
if (!user || !selectedCv || !result || !selectedApplicationId) {
setPageError('Select an application before attaching the tailored CV.');
return;
}


if (!result.id) {
  setPageError('This analysis does not have a saved analysis ID yet.');
  return;
}

setAttaching(true);
setPageError('');
setMessage('');

const score = Number(result.score || 0);
const fitLabel = getScoreLabel(score);

const { error } = await supabase
  .from('applications')
  .update({
    analysis_id: result.id,
    cv_version_id: selectedCv.id,
    match_score: score,
    cv_score_at_apply: score,
    fit_label: fitLabel,
    job_description: jobDescription.trim() || null,
  })
  .eq('id', selectedApplicationId)
  .eq('user_id', user.id);

if (error) {
  setPageError(error.message);
  setAttaching(false);
  return;
}

await supabase.from('application_events').insert({
  user_id: user.id,
  application_id: selectedApplicationId,
  event_type: 'cv_attached',
  title: 'Tailored CV attached',
  description: `Attached tailored CV from Resume Builder with match score ${score}/100 (${fitLabel}).`,
});

setAttachedApplicationId(selectedApplicationId);
setMessage('Tailored CV attached to application successfully.');
setAttaching(false);


};

const handleReset = () => {
resetAnalysis();
setJobDescription('');
setCopied(false);
setMessage('');
setPageError('');
setAttachedApplicationId(null);
};

const recommendation = getRecommendation(result);

return ( <div className="w-full max-w-7xl overflow-hidden"> <div className="mb-6"> <Link
       to="/resume-builder"
       className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 mb-4"
     > <ArrowLeft size={16} />
Back to Resume Builder </Link>


    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
      <div>
        <p className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 mb-4">
          <Sparkles size={14} />
          Guided tailoring flow
        </p>

        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
          Tailor a CV for a specific job
        </h1>

        <p className="text-slate-600 mt-3 max-w-2xl">
          Choose an existing CV, paste a job description, analyse the match, then generate and attach a tailored CV.
        </p>
      </div>

      <Link
        to="/resume-builder/history"
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
      >
        <History size={16} />
        Tailored history
      </Link>
    </div>
  </div>

  <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 shadow-sm mb-6">
    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
      {steps.map((step, index) => {
        const number = index + 1;
        const active = activeStep === number;
        const complete = activeStep > number;

        return (
          <div
            key={step}
            className={`rounded-2xl border p-4 ${
              active
                ? 'bg-slate-900 text-white border-slate-900'
                : complete
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide">
              Step {number}
            </p>

            <div className="flex items-center justify-between gap-3 mt-1">
              <p className="font-semibold">{step}</p>
              {complete && <CheckCircle2 size={17} />}
            </div>
          </div>
        );
      })}
    </div>
  </div>

  {(pageError || analysisError || message) && (
    <div className="mb-6 space-y-3">
      {(pageError || analysisError) && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-start gap-3">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>{pageError || analysisError}</span>
        </div>
      )}

      {message && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 flex items-start gap-3">
          <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
          <span>{message}</span>
        </div>
      )}
    </div>
  )}

  <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-6">
    <section className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm overflow-hidden">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <FileText size={20} />
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              1. Choose CV
            </h2>

            <p className="text-sm text-slate-500 mt-1">
              Select the CV version you want to tailor.
            </p>
          </div>
        </div>

        <div className="relative mb-4">
          <Search
            size={17}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
          />

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search CVs"
            className="w-full rounded-xl border border-slate-300 pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
        </div>

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 flex items-center justify-center gap-3 text-sm text-slate-500">
            <Loader2 size={17} className="animate-spin" />
            Loading CVs...
          </div>
        ) : filteredCVs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
            <FileText size={28} className="mx-auto text-slate-300 mb-3" />

            <p className="font-semibold text-slate-800">No CV versions found</p>

            <p className="text-sm text-slate-500 mt-1">
              Upload or create a CV in CV Manager first.
            </p>

            <Link
              to="/cv-manager"
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white hover:bg-slate-700"
            >
              Go to CV Manager
              <ArrowRight size={15} />
            </Link>
          </div>
        ) : (
          <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
            {filteredCVs.map((cv) => {
              const selected = selectedCvId === cv.id;
              const hasText = Boolean(cv.cv_text?.trim());

              return (
                <button
                  key={cv.id}
                  type="button"
                  onClick={() => {
                    setSelectedCvId(cv.id);
                    setMessage('');
                    setPageError('');
                  }}
                  className={`w-full text-left rounded-2xl border p-4 transition ${
                    selected
                      ? 'border-slate-900 bg-slate-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 break-words">
                        {cv.name}
                      </h3>

                      <p className="text-sm text-slate-500 mt-1 break-words">
                        {cv.target_role || 'No target role set'}
                      </p>
                    </div>

                    {selected && <CheckCircle2 size={18} className="text-slate-900 shrink-0" />}
                  </div>

                  <div className="flex flex-wrap gap-2 mt-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
                        hasText
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-red-50 text-red-700 border-red-200'
                      }`}
                    >
                      {hasText ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                      {hasText ? 'CV text extracted' : 'CV text missing'}
                    </span>

                    {cv.last_score !== null && (
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getScoreBadgeClass(cv.last_score)}`}
                      >
                        Last score {cv.last_score}/100
                      </span>
                    )}

                    <span className="inline-flex rounded-full bg-slate-100 text-slate-500 px-2.5 py-1 text-xs font-medium">
                      Created {formatDate(cv.created_at)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {selectedCv && (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Selected CV text
                </p>

                <p className="text-xs text-slate-500 mt-1">
                  {selectedCv.cv_text?.trim()
                    ? `${selectedCv.cv_text.trim().slice(0, 160)}${selectedCv.cv_text.trim().length > 160 ? '...' : ''}`
                    : 'No extracted CV text found. Paste it manually before analysis.'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setManualTextOpen((prev) => !prev);
                  setManualCvText(selectedCv.cv_text || '');
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Edit3 size={15} />
                {selectedCv.cv_text?.trim() ? 'Edit text' : 'Paste manually'}
              </button>
            </div>

            {manualTextOpen && (
              <div className="mt-4">
                <textarea
                  value={manualCvText}
                  onChange={(e) => setManualCvText(e.target.value)}
                  rows={9}
                  placeholder="Paste the full CV text here..."
                  className={`${inputCls} resize-y`}
                />

                <div className="flex flex-col sm:flex-row gap-2 mt-3">
                  <button
                    type="button"
                    onClick={handleSaveManualText}
                    disabled={savingManualText || !manualCvText.trim()}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    {savingManualText ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                    Save CV text
                  </button>

                  <button
                    type="button"
                    onClick={() => setManualTextOpen(false)}
                    className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm overflow-hidden">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
            <ClipboardList size={20} />
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              2. Paste job description
            </h2>

            <p className="text-sm text-slate-500 mt-1">
              Use the full job description for the best score and tailored CV.
            </p>
          </div>
        </div>

        <textarea
          value={jobDescription}
          onChange={(e) => setJobDescription(e.target.value)}
          rows={12}
          placeholder="Paste the job description here..."
          className={`${inputCls} resize-y`}
          disabled={isAnalyzing}
        />

        <div className="flex flex-col sm:flex-row gap-3 mt-4">
          <button
            type="button"
            onClick={handleAnalyse}
            disabled={isAnalyzing || !selectedCvId || !jobDescription.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-700 transition disabled:opacity-50"
          >
            {isAnalyzing ? <Loader2 size={16} className="animate-spin" /> : <Brain size={16} />}
            {isAnalyzing ? 'Analysing...' : 'Analyse and generate CV'}
          </button>

          {(isDone || jobDescription.trim()) && (
            <button
              type="button"
              onClick={handleReset}
              disabled={isAnalyzing}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Reset
            </button>
          )}
        </div>

        {isAnalyzing && (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-3">
              <Loader2 size={17} className="animate-spin text-slate-700" />

              <p className="text-sm font-medium text-slate-700">
                {progressMessage || 'Analysing CV...'}
              </p>
            </div>

            <div className="mt-3 h-2 w-full rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full rounded-full bg-slate-900 transition-all duration-500"
                style={{ width: `${Math.max(progressPercent || 8, 8)}%` }}
              />
            </div>

            <p className="mt-2 text-xs text-slate-500">
              {Math.max(progressPercent || 8, 8)}% complete
            </p>
          </div>
        )}
      </div>
    </section>

    <section className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm overflow-hidden">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
            <Target size={20} />
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              3. Match result
            </h2>

            <p className="text-sm text-slate-500 mt-1">
              Your score and missing keywords will appear here after analysis.
            </p>
          </div>
        </div>

        {!result ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <Brain size={32} className="mx-auto text-slate-300 mb-3" />

            <p className="font-semibold text-slate-800">
              No analysis yet
            </p>

            <p className="text-sm text-slate-500 mt-1">
              Select a CV, paste a job description, then run the analysis.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-5 items-center">
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-center">
                <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
                  Match score
                </p>

                <p className="text-5xl font-bold text-slate-900 mt-3">
                  {result.score}
                </p>

                <p className="text-xs text-slate-500 mt-1">
                  out of 100
                </p>

                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold mt-4 ${getScoreBadgeClass(result.score)}`}
                >
                  {getScoreLabel(result.score)}
                </span>
              </div>

              <div className={`rounded-2xl border p-4 ${recommendation.className}`}>
                <p className="font-semibold">
                  {recommendation.label}
                </p>

                <p className="text-sm mt-1 opacity-90">
                  {recommendation.description}
                </p>
              </div>
            </div>

            <KeywordSummary
              title="Matched keywords"
              items={result.matched_keywords || []}
              tone="green"
            />

            <KeywordSummary
              title="Partial matches"
              items={result.partial_keywords || []}
              tone="amber"
            />

            <KeywordSummary
              title="Top missing keywords"
              items={(result.missing_keywords || []).slice(0, 8)}
              tone="red"
            />
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-4 sm:p-6 shadow-sm overflow-hidden">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <Wand2 size={20} />
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              4. Tailored CV
            </h2>

            <p className="text-sm text-slate-500 mt-1">
              Copy, download, attach, or continue editing the generated CV.
            </p>
          </div>
        </div>

        {!generatedCvText.trim() ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <Sparkles size={32} className="mx-auto text-slate-300 mb-3" />

            <p className="font-semibold text-slate-800">
              Generated CV will appear here
            </p>

            <p className="text-sm text-slate-500 mt-1">
              Run the analysis to generate a tailored CV.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 max-h-[360px] overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-slate-700">
              {generatedCvText}
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 mt-4">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white hover:bg-slate-700"
              >
                {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                {copied ? 'Copied' : 'Copy CV'}
              </button>

              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50"
              >
                <Download size={16} />
                Download .docx
              </button>

              <button
                type="button"
                onClick={() => {
                  if (result?.id) navigate(`/resume-builder/${result.id}`);
                }}
                disabled={!result?.id}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <Edit3 size={16} />
                Open editor
              </button>

              <Link
                to="/resume-builder/history"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 sm:ml-auto"
              >
                <History size={16} />
                View history
              </Link>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
                  <Briefcase size={18} className="text-slate-700" />
                </div>

                <div>
                  <h3 className="font-semibold text-slate-900">
                    Attach to application
                  </h3>

                  <p className="text-sm text-slate-500 mt-1">
                    Save this CV score and analysis to one of your tracked applications.
                  </p>
                </div>
              </div>

              {attachedApplicationId ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-sm font-semibold text-emerald-700">
                    Tailored CV attached successfully.
                  </p>

                  <Link
                    to={`/applications/${attachedApplicationId}`}
                    className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm text-white hover:bg-emerald-700"
                  >
                    Open application
                    <ArrowRight size={15} />
                  </Link>
                </div>
              ) : (
                <>
                  <div className="relative mb-3">
                    <Search
                      size={17}
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                    />

                    <input
                      value={applicationSearch}
                      onChange={(e) => setApplicationSearch(e.target.value)}
                      placeholder="Search applications"
                      className="w-full rounded-xl border border-slate-300 pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                    />
                  </div>

                  {loadingApplications ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-center gap-2 text-sm text-slate-500">
                      <Loader2 size={15} className="animate-spin" />
                      Loading applications...
                    </div>
                  ) : filteredApplications.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-center">
                      <Briefcase size={26} className="mx-auto text-slate-300 mb-2" />

                      <p className="text-sm font-semibold text-slate-700">
                        No applications found
                      </p>

                      <p className="text-xs text-slate-500 mt-1">
                        Create an application first, then attach the tailored CV.
                      </p>

                      <Link
                        to="/applications"
                        className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white hover:bg-slate-700"
                      >
                        Go to Applications
                        <ArrowRight size={15} />
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                      {filteredApplications.map((application) => {
                        const selected = selectedApplicationId === application.id;

                        return (
                          <button
                            key={application.id}
                            type="button"
                            onClick={() => setSelectedApplicationId(application.id)}
                            className={`w-full text-left rounded-xl border p-3 transition ${
                              selected
                                ? 'border-slate-900 bg-white'
                                : 'border-slate-200 bg-white hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-semibold text-sm text-slate-900 break-words">
                                  {application.role_title}
                                </p>

                                <p className="text-xs text-slate-500 mt-1 break-words">
                                  {getCompanyName(application)} · {application.status.replaceAll('_', ' ')}
                                </p>
                              </div>

                              {selected && <CheckCircle2 size={17} className="text-slate-900 shrink-0" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleAttachToApplication}
                    disabled={attaching || !selectedApplicationId}
                    className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    {attaching ? <Loader2 size={16} className="animate-spin" /> : <Briefcase size={16} />}
                    {attaching ? 'Attaching...' : 'Attach to application'}
                  </button>

                  {selectedApplication && (
                    <p className="text-xs text-slate-500 mt-2">
                      Selected: {selectedApplication.role_title} · {getCompanyName(selectedApplication)}
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  </div>
</div>


);
};

const KeywordSummary = ({
title,
items,
tone,
}: {
title: string;
items: string[];
tone: 'green' | 'amber' | 'red';
}) => {
const classes = {
green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
amber: 'bg-amber-50 text-amber-700 border-amber-200',
red: 'bg-red-50 text-red-700 border-red-200',
}[tone];

return ( <div> <p className="text-sm font-semibold text-slate-800 mb-2">
{title} </p>


  {items.length === 0 ? (
    <p className="text-sm text-slate-400">
      None returned.
    </p>
  ) : (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={`${title}-${item}`}
          className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${classes}`}
        >
          {item}
        </span>
      ))}
    </div>
  )}
</div>


);
};
