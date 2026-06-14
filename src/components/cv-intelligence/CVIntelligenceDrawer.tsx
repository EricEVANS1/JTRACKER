import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
AlertCircle,
ArrowRight,
BarChart3,
Brain,
CheckCircle2,
Copy,
Download,
Eye,
EyeOff,
History,
Loader2,
Sparkles,
Tags,
Target,
Wand2,
X,
} from 'lucide-react';

import jsPDF from 'jspdf';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';

import { supabase } from '../../lib/supabase';
import { useCVAnalysis } from '../../hooks/useCVAnalysis';
import type { CVAnalysis } from '../../types/cvIntelligence';

interface Props {
open: boolean;
onClose: () => void;
cvVersionId: string | null;
cvName?: string;
}

interface ScoreHistoryItem {
id: string;
score: number | null;
overall_job_fit_score: number | null;
created_at: string;
}

type KeywordStatus = 'matched' | 'partial' | 'missing';

interface KeywordChipItem {
keyword: string;
status: KeywordStatus;
}

interface FeedbackItem {
title: string;
detail: string;
}

const safeStringArray = (value: unknown): string[] => {
if (!Array.isArray(value)) return [];

return value.map((item) => {
if (typeof item === 'string') return item;


if (item && typeof item === 'object') {
  const obj = item as Record<string, unknown>;

  return String(
    obj.skill ||
      obj.keyword ||
      obj.name ||
      obj.title ||
      obj.value ||
      obj.reason ||
      JSON.stringify(obj)
  );
}

return String(item);


});
};

const safeFeedbackItems = (value: unknown): FeedbackItem[] => {
if (!Array.isArray(value)) return [];

return value.map((item) => {
if (typeof item === 'string') {
return {
title: item,
detail: '',
};
}


if (item && typeof item === 'object') {
  const obj = item as Record<string, unknown>;

  return {
    title: String(obj.title || obj.skill || obj.name || 'Insight'),
    detail: String(obj.detail || obj.reason || obj.description || ''),
  };
}

return {
  title: String(item),
  detail: '',
};


});
};

const clampScore = (value: unknown) => {
const num = Number(value || 0);
if (Number.isNaN(num)) return 0;
return Math.min(Math.max(Math.round(num), 0), 100);
};

const makeSafeFileName = (name?: string) => {
const base = name?.trim() || 'optimized-cv';

return base
.replace(/[^a-zA-Z0-9-_ ]/g, '')
.replace(/\s+/g, '-')
.toLowerCase();
};

const getScoreVerdict = (score: number) => {
if (score >= 85) {
return {
label: 'Strong match',
tone: 'green' as const,
message: 'You can apply confidently after a final review.',
};
}

if (score >= 70) {
return {
label: 'Good match',
tone: 'green' as const,
message: 'This role is realistic. Tailor the CV slightly before applying.',
};
}

if (score >= 50) {
return {
label: 'Fair match',
tone: 'amber' as const,
message: 'Improve the CV before applying. Focus on the missing keywords.',
};
}

return {
label: 'Needs work',
tone: 'red' as const,
message: 'The CV needs stronger alignment before applying.',
};
};

const getScoreColourClass = (score: number) => {
if (score >= 70) return 'text-emerald-700';
if (score >= 50) return 'text-amber-700';
return 'text-red-700';
};

const getScoreBarClass = (score: number) => {
if (score >= 70) return 'bg-emerald-600';
if (score >= 50) return 'bg-amber-500';
return 'bg-red-500';
};

const getRecommendation = (analysis: CVAnalysis) => {
const extendedData = (analysis as CVAnalysis & {
extended_data?: Record<string, unknown>;
}).extended_data;

const rawValue =
analysis.recommended_to_apply ||
extendedData?.recommended_to_apply ||
extendedData?.recommendation ||
'MAYBE';

const value = String(rawValue);

if (value.toUpperCase().includes('YES')) {
return {
label: value === 'YES — Tailor CV First' ? 'Apply after tailoring' : 'Recommended to apply',
sub: value === 'YES — Tailor CV First'
? 'The role is promising, but the CV should be tailored first.'
: 'Your profile is a strong fit for this role.',
tone: 'green' as const,
};
}

if (value.toUpperCase().includes('NO')) {
return {
label: 'Improve before applying',
sub: 'The CV is not aligned enough yet. Improve the gaps first.',
tone: 'red' as const,
};
}

return {
label: 'Maybe apply',
sub: 'There is some alignment, but the CV needs stronger targeting.',
tone: 'amber' as const,
};
};

const formatDate = (date?: string | null) => {
if (!date) return 'Not set';

return new Date(date).toLocaleDateString('en-GB', {
day: 'numeric',
month: 'short',
});
};

const exportAsPDF = (text: string, fileName = 'optimized-cv.pdf') => {
if (!text.trim()) return;

const doc = new jsPDF({
unit: 'pt',
format: 'a4',
});

const margin = 40;
const pageWidth = doc.internal.pageSize.getWidth();
const pageHeight = doc.internal.pageSize.getHeight();
const maxWidth = pageWidth - margin * 2;
const lineHeight = 16;

doc.setFont('times', 'normal');
doc.setFontSize(11);

const paragraphs = text.split('\n');
let y = margin;

paragraphs.forEach((paragraph) => {
const lines = doc.splitTextToSize(paragraph || ' ', maxWidth);


lines.forEach((line: string) => {
  if (y > pageHeight - margin) {
    doc.addPage();
    y = margin;
  }

  doc.text(line, margin, y);
  y += lineHeight;
});

y += 4;


});

doc.save(fileName);
};

const exportAsDOCX = async (text: string, fileName = 'optimized-cv.docx') => {
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

export const CVIntelligenceDrawer: React.FC<Props> = ({
open,
onClose,
cvVersionId,
cvName,
}) => {
const navigate = useNavigate();

const [jobDescription, setJobDescription] = useState('');
const [copied, setCopied] = useState(false);
const [editableGeneratedCV, setEditableGeneratedCV] = useState('');
const [scoreHistory, setScoreHistory] = useState<ScoreHistoryItem[]>([]);

const {
analysis,
error,
analyzeCV,
resetAnalysis,
isAnalyzing,
isDone,
progressMessage,
progressPercent,
} = useCVAnalysis();

useEffect(() => {
if (analysis?.generated_cv) {
setEditableGeneratedCV(analysis.generated_cv);
}
}, [analysis?.generated_cv]);

useEffect(() => {
if (!analysis?.cv_version_id) return;


const fetchScoreHistory = async () => {
  const { data, error } = await supabase
    .from('cv_analyses')
    .select('id, score, overall_job_fit_score, created_at')
    .eq('cv_version_id', analysis.cv_version_id)
    .order('created_at', { ascending: false })
    .limit(8);

  if (!error) {
    setScoreHistory((data || []) as ScoreHistoryItem[]);
  }
};

fetchScoreHistory();


}, [analysis?.cv_version_id]);

useEffect(() => {
if (!open) {
resetAnalysis();
setJobDescription('');
setCopied(false);
setEditableGeneratedCV('');
setScoreHistory([]);
}
}, [open, resetAnalysis]);

const handleAnalyze = async () => {
if (!cvVersionId) {
alert('No CV version selected. Please select or upload a CV first.');
return;
}


if (!jobDescription.trim()) {
  alert('Please paste a job description first.');
  return;
}

await analyzeCV({
  cvVersionId,
  jobDescription: jobDescription.trim(),
});


};

const handleCopyGeneratedCV = async () => {
if (!editableGeneratedCV.trim()) return;


await navigator.clipboard.writeText(editableGeneratedCV);
setCopied(true);

setTimeout(() => setCopied(false), 2000);


};

const handleOpenResumeBuilder = () => {
if (!analysis?.id || analysis.id === 'unsaved') return;


onClose();
navigate(`/resume-builder/${analysis.id}`);


};

if (!open) return null;

const progress = Math.min(Math.max(progressPercent || 5, 5), 100);

return (
<> <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />


  <div className="fixed inset-y-0 right-0 h-screen w-full sm:w-[880px] bg-slate-50 z-50 shadow-2xl overflow-hidden flex flex-col">
    <div className="shrink-0 bg-white border-b border-slate-200 p-5 flex items-center justify-between z-10">
      <div className="min-w-0">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="w-6 h-6 text-slate-900" />
          CV Intelligence
        </h2>

        <p className="text-sm text-slate-500 mt-1 truncate">
          {cvName || 'Selected CV'}
        </p>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="p-2 rounded-lg hover:bg-slate-100 transition"
        aria-label="Close CV Intelligence drawer"
      >
        <X className="w-5 h-5" />
      </button>
    </div>

    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
      {!isDone && (
        <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-slate-700" />
            </div>

            <div>
              <h3 className="font-semibold text-slate-900">
                Analyse this CV against a job description
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                Paste the full job description. JTracker will score the CV, identify missing keywords, and generate a tailored version.
              </p>
            </div>
          </div>

          <label className="block text-sm font-semibold text-slate-800 mb-2">
            Job description
          </label>

          <textarea
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            rows={10}
            placeholder="Paste the full job description here..."
            className="w-full rounded-xl border border-slate-300 p-4 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
            disabled={isAnalyzing}
          />

          <button
            type="button"
            onClick={handleAnalyze}
            disabled={isAnalyzing || !jobDescription.trim() || !cvVersionId}
            className="mt-4 w-full bg-slate-900 text-white py-3 rounded-xl font-medium hover:bg-slate-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analysing CV...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Analyse CV
              </>
            )}
          </button>

          {isAnalyzing && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-3">
                <Loader2 className="w-4 h-4 animate-spin text-slate-700" />

                <p className="text-sm font-medium text-slate-700">
                  {progressMessage || 'Analysing CV...'}
                </p>
              </div>

              <div className="mt-3 h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-slate-900 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <p className="mt-2 text-xs text-slate-500">
                {progress}% complete
              </p>
            </div>
          )}
        </section>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />

          <div>
            <p className="font-medium text-red-700">Analysis failed</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        </div>
      )}

      {isDone && analysis && (
        <AnalysisContent
          analysis={analysis}
          copied={copied}
          editableGeneratedCV={editableGeneratedCV}
          setEditableGeneratedCV={setEditableGeneratedCV}
          onCopyGeneratedCV={handleCopyGeneratedCV}
          onOpenResumeBuilder={handleOpenResumeBuilder}
          cvName={cvName}
          scoreHistory={scoreHistory}
        />
      )}
    </div>
  </div>
</>


);
};

const AnalysisContent: React.FC<{
analysis: CVAnalysis;
copied: boolean;
editableGeneratedCV: string;
setEditableGeneratedCV: React.Dispatch<React.SetStateAction<string>>;
onCopyGeneratedCV: () => void;
onOpenResumeBuilder: () => void;
cvName?: string;
scoreHistory: ScoreHistoryItem[];
}> = ({
analysis,
copied,
editableGeneratedCV,
setEditableGeneratedCV,
onCopyGeneratedCV,
onOpenResumeBuilder,
cvName,
scoreHistory,
}) => {
const [showFullCV, setShowFullCV] = useState(false);

const mainScore = useMemo(
() => clampScore(analysis.overall_job_fit_score ?? analysis.score ?? 0),
[analysis]
);

const verdict = getScoreVerdict(mainScore);
const recommendation = getRecommendation(analysis);

const matchedKeywords = safeStringArray(analysis.matched_keywords);
const partialKeywords = safeStringArray(analysis.partial_keywords);
const missingKeywords = safeStringArray(analysis.missing_keywords);

const allKeywords: KeywordChipItem[] = [
...matchedKeywords.map((keyword) => ({
keyword,
status: 'matched' as const,
})),
...partialKeywords.map((keyword) => ({
keyword,
status: 'partial' as const,
})),
...missingKeywords.map((keyword) => ({
keyword,
status: 'missing' as const,
})),
];

const strengths = safeFeedbackItems(analysis.strengths);
const gaps = safeFeedbackItems(analysis.gaps);

const topMissingKeywords = missingKeywords.slice(0, 3);

const exportBaseName = makeSafeFileName(cvName || analysis.job_title || 'optimized-cv');
const canOpenBuilder = Boolean(analysis.id && analysis.id !== 'unsaved');

return ( <div className="space-y-5"> <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 overflow-hidden"> <div className="grid grid-cols-1 lg:grid-cols-[210px_1fr] gap-6 items-center"> <div className="flex flex-col items-center text-center"> <p className="text-xs uppercase tracking-widest text-slate-400 font-semibold mb-3">
Match score </p>


        <ScoreDial score={mainScore} />

        <span
          className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
            verdict.tone === 'green'
              ? 'bg-emerald-50 text-emerald-700'
              : verdict.tone === 'amber'
                ? 'bg-amber-50 text-amber-700'
                : 'bg-red-50 text-red-700'
          }`}
        >
          {verdict.label}
        </span>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MiniStat
            label="Keywords matched"
            value={matchedKeywords.length}
            tone="green"
          />
          <MiniStat
            label="Partial matches"
            value={partialKeywords.length}
            tone="amber"
          />
          <MiniStat
            label="Missing keywords"
            value={missingKeywords.length}
            tone="red"
          />
        </div>

        <RecommendationBanner recommendation={recommendation} />

        <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-900">
            What this score means
          </p>
          <p className="text-sm text-slate-600 mt-1">
            {verdict.message}
          </p>
        </div>

        {topMissingKeywords.length > 0 && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4">
            <p className="text-sm font-semibold text-red-800">
              Top missing keywords
            </p>

            <div className="flex flex-wrap gap-2 mt-3">
              {topMissingKeywords.map((keyword) => (
                <span
                  key={keyword}
                  className="rounded-full bg-white border border-red-200 text-red-700 px-3 py-1 text-xs font-medium"
                >
                  {keyword}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  </section>

  <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 overflow-hidden">
    <SectionHeading icon={Tags} title="Keywords" />

    <div className="flex flex-wrap gap-3 mb-4 text-xs text-slate-500">
      <LegendDot label="Matched" tone="green" />
      <LegendDot label="Partial" tone="amber" />
      <LegendDot label="Missing" tone="red" />
    </div>

    {allKeywords.length > 0 ? (
      <div className="flex flex-wrap gap-2">
        {allKeywords.map((item, index) => (
          <KeywordChip
            key={`${item.status}-${item.keyword}-${index}`}
            item={item}
          />
        ))}
      </div>
    ) : (
      <EmptyText text="No keyword evidence returned yet." />
    )}
  </section>

  <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 overflow-hidden">
    <SectionHeading icon={BarChart3} title="Strengths & gaps" />

    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {strengths.slice(0, 3).map((item, index) => (
        <InsightCard
          key={`strength-${item.title}-${index}`}
          type="strength"
          title={item.title}
          detail={item.detail}
        />
      ))}

      {gaps.slice(0, 3).map((item, index) => (
        <InsightCard
          key={`gap-${item.title}-${index}`}
          type="gap"
          title={item.title}
          detail={item.detail}
        />
      ))}
    </div>

    {!strengths.length && !gaps.length && (
      <EmptyText text="No strengths or gaps returned." />
    )}
  </section>

  <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 overflow-hidden">
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
      <SectionHeading icon={Sparkles} title="Generated CV" />

      <p className="text-xs text-slate-400">
        Tailored for {analysis.job_title || 'this role'}
        {analysis.company_name ? ` at ${analysis.company_name}` : ''}
      </p>
    </div>

    {editableGeneratedCV.trim() ? (
      <>
        <div
          className={`relative rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-700 leading-7 whitespace-pre-wrap overflow-hidden ${
            showFullCV ? 'max-h-none' : 'max-h-[260px]'
          }`}
        >
          {editableGeneratedCV}

          {!showFullCV && (
            <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-slate-50 to-transparent pointer-events-none" />
          )}
        </div>

        <textarea
          value={editableGeneratedCV}
          onChange={(e) => setEditableGeneratedCV(e.target.value)}
          className="mt-4 w-full rounded-xl border border-slate-300 p-4 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white min-h-[220px]"
        />

        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 mt-4">
          <button
            type="button"
            onClick={onCopyGeneratedCV}
            disabled={!editableGeneratedCV.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white hover:bg-slate-700 transition disabled:opacity-50"
          >
            {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
            {copied ? 'Copied' : 'Copy CV'}
          </button>

          <button
            type="button"
            onClick={() => exportAsDOCX(editableGeneratedCV, `${exportBaseName}.docx`)}
            disabled={!editableGeneratedCV.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
          >
            <Download size={16} />
            Download .docx
          </button>

          <button
            type="button"
            onClick={() => exportAsPDF(editableGeneratedCV, `${exportBaseName}.pdf`)}
            disabled={!editableGeneratedCV.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
          >
            <Download size={16} />
            Download PDF
          </button>

          <button
            type="button"
            onClick={() => setShowFullCV((prev) => !prev)}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition"
          >
            {showFullCV ? <EyeOff size={16} /> : <Eye size={16} />}
            {showFullCV ? 'Collapse' : 'Show full CV'}
          </button>

          <button
            type="button"
            onClick={onOpenResumeBuilder}
            disabled={!canOpenBuilder}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition disabled:opacity-50 sm:ml-auto"
          >
            <Wand2 size={16} />
            Open Resume Builder
          </button>
        </div>
      </>
    ) : (
      <EmptyGeneratedCV onOpenResumeBuilder={onOpenResumeBuilder} disabled={!canOpenBuilder} />
    )}
  </section>

  <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 overflow-hidden">
    <SectionHeading icon={History} title={`Score history — ${cvName || 'current CV'}`} />

    <ScoreHistoryList
      history={scoreHistory.length ? scoreHistory : [
        {
          id: analysis.id,
          score: analysis.score,
          overall_job_fit_score: analysis.overall_job_fit_score,
          created_at: analysis.created_at,
        },
      ]}
    />
  </section>

  <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 overflow-hidden">
    <SectionHeading icon={Target} title="Detailed scores" />

    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <ScoreMetric label="Transferability" value={analysis.transferability_score} />
      <ScoreMetric label="ATS Match" value={analysis.ats_match_score} />
      <ScoreMetric label="Seniority Match" value={analysis.seniority_match_score} />
      <ScoreMetric label="Skill Gap" value={analysis.skill_gap_score} />
    </div>
  </section>

  <section className="rounded-2xl bg-slate-900 text-white p-5 overflow-hidden">
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div>
        <h4 className="font-semibold flex items-center gap-2">
          <ArrowRight size={18} />
          Recommended next step
        </h4>

        <p className="text-sm text-slate-300 mt-2">
          Add the missing keywords where truthful, review the generated CV, then save it as a tailored version for this application.
        </p>
      </div>

      <button
        type="button"
        onClick={onOpenResumeBuilder}
        disabled={!canOpenBuilder}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-50"
      >
        Continue
        <ArrowRight size={15} />
      </button>
    </div>
  </section>
</div>


);
};

const ScoreDial = ({ score }: { score: number }) => {
const radius = 72;
const circumference = Math.PI * radius;
const progress = (score / 100) * circumference;

return ( <div className="relative w-[180px] h-[118px]"> <svg width="180" height="118" viewBox="0 0 180 118"> <path
       d="M 18 96 A 72 72 0 0 1 162 96"
       fill="none"
       stroke="#e2e8f0"
       strokeWidth="13"
       strokeLinecap="round"
     />


    <path
      d="M 18 96 A 72 72 0 0 1 162 96"
      fill="none"
      stroke="currentColor"
      strokeWidth="13"
      strokeLinecap="round"
      strokeDasharray={`${progress} ${circumference}`}
      className={getScoreColourClass(score)}
    />
  </svg>

  <div className="absolute left-0 right-0 bottom-2 flex flex-col items-center">
    <span className="text-4xl font-bold text-slate-900">{score}</span>
    <span className="text-xs text-slate-400">out of 100</span>
  </div>
</div>


);
};

const RecommendationBanner = ({
recommendation,
}: {
recommendation: {
label: string;
sub: string;
tone: 'green' | 'amber' | 'red';
};
}) => {
const classes = {
green: 'bg-emerald-50 border-emerald-200 text-emerald-800',
amber: 'bg-amber-50 border-amber-200 text-amber-800',
red: 'bg-red-50 border-red-200 text-red-800',
}[recommendation.tone];

return (
<div className={`rounded-xl border p-4 flex items-start gap-3 ${classes}`}> <CheckCircle2 size={18} className="shrink-0 mt-0.5" />


  <div>
    <p className="text-sm font-semibold">{recommendation.label}</p>
    <p className="text-xs mt-1 opacity-85">{recommendation.sub}</p>
  </div>
</div>


);
};

const MiniStat = ({
label,
value,
tone,
}: {
label: string;
value: number;
tone: 'green' | 'amber' | 'red';
}) => {
const valueClasses = {
green: 'text-emerald-700',
amber: 'text-amber-700',
red: 'text-red-700',
}[tone];

return ( <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
<p className={`text-2xl font-bold ${valueClasses}`}>{value}</p> <p className="text-xs text-slate-500 mt-1">{label}</p> </div>
);
};

const SectionHeading = ({
icon: Icon,
title,
}: {
icon: React.ElementType;
title: string;
}) => (

  <div className="flex items-center gap-2 mb-4">
    <Icon size={18} className="text-slate-500" />
    <h4 className="font-semibold text-slate-900">{title}</h4>
  </div>
);

const LegendDot = ({
label,
tone,
}: {
label: string;
tone: 'green' | 'amber' | 'red';
}) => {
const classes = {
green: 'bg-emerald-600',
amber: 'bg-amber-500',
red: 'bg-red-500',
}[tone];

return ( <span className="inline-flex items-center gap-1.5">
<span className={`w-2 h-2 rounded-full ${classes}`} />
{label} </span>
);
};

const KeywordChip = ({ item }: { item: KeywordChipItem }) => {
const classes = {
matched: 'bg-emerald-50 text-emerald-700 border-emerald-200',
partial: 'bg-amber-50 text-amber-700 border-amber-200',
missing: 'bg-red-50 text-red-700 border-red-200',
}[item.status];

const icon = item.status === 'matched' ? '✓' : item.status === 'partial' ? '−' : '×';

return (
<span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${classes}`}> <span>{icon}</span>
{item.keyword} </span>
);
};

const InsightCard = ({
type,
title,
detail,
}: {
type: 'strength' | 'gap';
title: string;
detail: string;
}) => {
const classes =
type === 'strength'
? 'bg-emerald-50 border-emerald-200 text-emerald-800'
: 'bg-red-50 border-red-200 text-red-800';

return (
<div className={`rounded-xl border p-4 flex gap-3 ${classes}`}>
{type === 'strength' ? ( <CheckCircle2 size={17} className="shrink-0 mt-0.5" />
) : ( <AlertCircle size={17} className="shrink-0 mt-0.5" />
)}


  <div>
    <p className="text-sm font-semibold">{title}</p>
    {detail && <p className="text-xs mt-1 opacity-85">{detail}</p>}
  </div>
</div>


);
};

const EmptyGeneratedCV = ({
onOpenResumeBuilder,
disabled,
}: {
onOpenResumeBuilder: () => void;
disabled: boolean;
}) => (

  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
    <Sparkles size={26} className="mx-auto text-slate-400 mb-3" />


<p className="font-semibold text-slate-800">No generated CV returned yet</p>

<p className="text-sm text-slate-500 mt-1">
  The analysis completed, but no generated CV was available. You can still open Resume Builder if this analysis was saved.
</p>

<button
  type="button"
  onClick={onOpenResumeBuilder}
  disabled={disabled}
  className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
>
  <Wand2 size={16} />
  Open Resume Builder
</button>


  </div>
);

const ScoreHistoryList = ({
history,
}: {
history: ScoreHistoryItem[];
}) => {
const ordered = [...history].sort(
(a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
);

if (!ordered.length) {
return <EmptyText text="No score history yet." />;
}

return ( <div className="space-y-1">
{ordered.map((item, index) => {
const score = clampScore(item.overall_job_fit_score ?? item.score ?? 0);
const previous = ordered[index + 1]
? clampScore(ordered[index + 1].overall_job_fit_score ?? ordered[index + 1].score ?? 0)
: null;


    const delta = previous === null ? null : score - previous;

    return (
      <div
        key={item.id}
        className="grid grid-cols-[82px_1fr_38px_44px] items-center gap-3 py-2 border-b border-slate-100 last:border-0"
      >
        <span className="text-xs text-slate-400">
          {index === 0 ? 'Latest' : formatDate(item.created_at)}
        </span>

        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full rounded-full ${getScoreBarClass(score)}`}
            style={{ width: `${score}%` }}
          />
        </div>

        <span className="text-sm font-semibold text-slate-800 text-right">
          {score}
        </span>

        <span
          className={`text-xs text-right ${
            delta === null
              ? 'text-slate-400'
              : delta >= 0
                ? 'text-emerald-700'
                : 'text-red-700'
          }`}
        >
          {delta === null ? '—' : delta >= 0 ? `+${delta}` : delta}
        </span>
      </div>
    );
  })}
</div>


);
};

const ScoreMetric = ({
label,
value,
}: {
label: string;
value?: number | null;
}) => {
const score = clampScore(value);

return ( <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"> <p className="text-xs text-slate-500">{label}</p>
<p className={`text-2xl font-bold mt-1 ${getScoreColourClass(score)}`}>
{score}/100 </p>

  <div className="h-2 rounded-full bg-slate-200 overflow-hidden mt-3">
    <div
      className={`h-full rounded-full ${getScoreBarClass(score)}`}
      style={{ width: `${score}%` }}
    />
  </div>
</div>


);
};

const EmptyText = ({ text }: { text: string }) => (

  <p className="text-sm text-slate-400">{text}</p>
);
