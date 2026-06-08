import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Brain,
  CheckCircle2,
  Download,
  Loader2,
  Sparkles,
  Target,
  Wand2,
  X,
} from 'lucide-react';

import jsPDF from 'jspdf';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';

import { useCVAnalysis } from '../../hooks/useCVAnalysis';
import type { CVAnalysis } from '../../types/cvIntelligence';
import {
  getRecommendationColor,
  getScoreBgColor,
  getScoreColor,
  getVerdictColor,
} from '../../types/cvIntelligence';

interface Props {
  open: boolean;
  onClose: () => void;
  cvVersionId: string | null;
  cvName?: string;
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
          JSON.stringify(obj),
      );
    }

    return String(item);
  });
};

const safeTransferableSkills = (value: unknown) => {
  if (!Array.isArray(value)) return [];

  return value.map((item) => {
    if (typeof item === 'string') {
      return {
        skill: item,
        reason: 'Transferable skill identified from the CV.',
      };
    }

    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;

      return {
        skill: String(obj.skill || obj.title || obj.name || 'Transferable skill'),
        reason: String(obj.reason || obj.detail || 'Relevant experience identified.'),
      };
    }

    return {
      skill: String(item),
      reason: 'Relevant experience identified.',
    };
  });
};

const safeFeedbackItems = (value: unknown) => {
  if (!Array.isArray(value)) return [];

  return value.map((item) => {
    if (typeof item === 'string') {
      return { title: item, detail: '' };
    }

    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;

      return {
        title: String(obj.title || obj.skill || obj.name || 'Insight'),
        detail: String(obj.detail || obj.reason || obj.description || ''),
      };
    }

    return { title: String(item), detail: '' };
  });
};

const clampScore = (value: unknown) => {
  const num = Number(value || 0);
  if (Number.isNaN(num)) return 0;
  return Math.min(Math.max(Math.round(num), 0), 100);
};

const makeSafeFileName = (name?: string) => {
  const base = name?.trim() || 'optimized-cv';
  return base.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-').toLowerCase();
};

const getScoreMessage = (score: number) => {
  if (score >= 85) return 'Strong match. You can apply confidently after a final review.';
  if (score >= 70) return 'Good match. Tailor the CV slightly before applying.';
  if (score >= 55) return 'Moderate match. Improve the CV before applying.';
  return 'Low match. Use the Resume Builder to strengthen this version first.';
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
      }),
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
    if (!open) {
      resetAnalysis();
      setJobDescription('');
      setCopied(false);
      setEditableGeneratedCV('');
    }
  }, [open, resetAnalysis]);

  const handleAnalyze = async () => {
    console.log('Drawer analyze clicked:', {
      cvVersionId,
      cvName,
      jobDescriptionLength: jobDescription.trim().length,
    });

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
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 h-screen w-full sm:w-[820px] bg-white z-50 shadow-2xl overflow-hidden flex flex-col">
        <div className="shrink-0 bg-white border-b border-slate-200 p-5 flex items-center justify-between z-10">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="w-6 h-6 text-indigo-600" />
              CV Intelligence
            </h2>

            <p className="text-sm text-slate-500 mt-1">
              {cvName || 'Selected CV'}
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 transition"
            aria-label="Close CV Intelligence drawer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!isDone && (
            <section className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
              <label className="block text-sm font-semibold text-slate-800 mb-2">
                Paste Job Description
              </label>

              <textarea
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                rows={9}
                placeholder="Paste the full job description here..."
                className="w-full rounded-xl border border-slate-300 p-4 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                disabled={isAnalyzing}
              />

              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing || !jobDescription.trim() || !cvVersionId}
                className="mt-4 w-full bg-slate-900 text-white py-3 rounded-xl font-medium hover:bg-slate-700 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing CV...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Analyze CV
                  </>
                )}
              </button>

              {isAnalyzing && (
                <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />

                    <p className="text-sm font-medium text-indigo-700">
                      {progressMessage || 'Analyzing CV...'}
                    </p>
                  </div>

                  <div className="mt-3 h-2 w-full rounded-full bg-indigo-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-600 transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>

                  <p className="mt-2 text-xs text-indigo-600">
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
            />
          )}
        </div>
      </div>
    </>
  );
};

type AtsEvidenceSummary = {
  total_requirements: number;
  matched_count: number;
  partial_count: number;
  missing_count: number;
  deterministic_score: number;
  coverage_ratio: number;
  critical_missing_count: number;
};

type AtsKeywordEvidenceItem = {
  keyword: string;
  canonical?: string;
  status: 'matched' | 'partial' | 'missing';
  priority: 'required' | 'nice_to_have' | 'inferred' | 'critical';
  evidence?: string[];
  matched_as?: string | null;
  reason?: string | null;
};

const safeAtsEvidenceSummary = (value: unknown): AtsEvidenceSummary | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const obj = value as Record<string, unknown>;

  return {
    total_requirements: Number(obj.total_requirements ?? 0),
    matched_count: Number(obj.matched_count ?? 0),
    partial_count: Number(obj.partial_count ?? 0),
    missing_count: Number(obj.missing_count ?? 0),
    deterministic_score: clampScore(obj.deterministic_score),
    coverage_ratio: Number(obj.coverage_ratio ?? 0),
    critical_missing_count: Number(obj.critical_missing_count ?? 0),
  };
};

const safeAtsKeywordEvidence = (value: unknown): AtsKeywordEvidenceItem[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;

      const obj = item as Record<string, unknown>;

      const status = String(obj.status || 'missing') as AtsKeywordEvidenceItem['status'];
      const priority = String(obj.priority || 'inferred') as AtsKeywordEvidenceItem['priority'];

      if (!['matched', 'partial', 'missing'].includes(status)) return null;

      return {
        keyword: String(obj.keyword || obj.canonical || 'Unknown keyword'),
        canonical: obj.canonical ? String(obj.canonical) : undefined,
        status,
        priority: ['required', 'nice_to_have', 'inferred', 'critical'].includes(priority)
          ? priority
          : 'inferred',
        evidence: Array.isArray(obj.evidence)
          ? obj.evidence.map(String)
          : [],
        matched_as: obj.matched_as ? String(obj.matched_as) : null,
        reason: obj.reason ? String(obj.reason) : null,
      };
    })
    .filter(Boolean) as AtsKeywordEvidenceItem[];
};

const AnalysisContent: React.FC<{
  analysis: CVAnalysis;
  copied: boolean;
  editableGeneratedCV: string;
  setEditableGeneratedCV: React.Dispatch<React.SetStateAction<string>>;
  onCopyGeneratedCV: () => void;
  onOpenResumeBuilder: () => void;
  cvName?: string;
}> = ({
  analysis,
  editableGeneratedCV,
  setEditableGeneratedCV,
  onCopyGeneratedCV,
  onOpenResumeBuilder,
  cvName,
}) => {
  const mainScore = useMemo(
    () => clampScore(analysis.overall_job_fit_score ?? analysis.score ?? 0),
    [analysis],
  );

  const transferableSkills = safeTransferableSkills(
    analysis.strongest_transferable_skills,
  );

  const recommendations = safeStringArray(analysis.ai_recommendations);
  const improvementActions = safeStringArray(analysis.cv_improvement_actions);

  const breakdownEntries = Object.entries(analysis.score_breakdown || {}).map(
    ([key, value]) => [key, clampScore(value)] as const,
  );

const rawAtsSummary = safeAtsEvidenceSummary(analysis.ats_evidence);
const rawAtsKeywordEvidence = safeAtsKeywordEvidence(analysis.ats_keyword_evidence);

const fallbackMatchedKeywords = safeStringArray(analysis.matched_keywords);
const fallbackPartialKeywords = safeStringArray(analysis.partial_keywords);
const fallbackMissingKeywords = safeStringArray(analysis.missing_keywords);

const fallbackAtsKeywordEvidence = [
  ...fallbackMatchedKeywords.map((keyword) => ({
    keyword,
    canonical: keyword.toLowerCase(),
    status: 'matched' as const,
    priority: 'required' as const,
    evidence: [keyword],
    matched_as: keyword,
    reason: 'Recovered from matched keywords because ATS evidence was empty.',
  })),

  ...fallbackPartialKeywords.map((keyword) => ({
    keyword,
    canonical: keyword.toLowerCase(),
    status: 'partial' as const,
    priority: 'required' as const,
    evidence: [keyword],
    matched_as: keyword,
    reason: 'Recovered from partial keywords because ATS evidence was empty.',
  })),

  ...fallbackMissingKeywords.map((keyword) => ({
    keyword,
    canonical: keyword.toLowerCase(),
    status: 'missing' as const,
    priority: 'required' as const,
    evidence: [],
    matched_as: null,
    reason: 'Recovered from missing keywords because ATS evidence was empty.',
  })),
];

const atsKeywordEvidence =
  rawAtsKeywordEvidence.length > 0
    ? rawAtsKeywordEvidence
    : fallbackAtsKeywordEvidence;

const atsSummary =
  rawAtsSummary && rawAtsSummary.total_requirements > 0
    ? rawAtsSummary
    : atsKeywordEvidence.length > 0
      ? {
          total_requirements: atsKeywordEvidence.length,
          matched_count: atsKeywordEvidence.filter((item) => item.status === 'matched').length,
          partial_count: atsKeywordEvidence.filter((item) => item.status === 'partial').length,
          missing_count: atsKeywordEvidence.filter((item) => item.status === 'missing').length,
          deterministic_score: clampScore(
            analysis.ats_match_score ??
              analysis.score_breakdown?.ats ??
              analysis.score ??
              0,
          ),
          coverage_ratio: atsKeywordEvidence.length
            ? (
                atsKeywordEvidence.filter((item) => item.status === 'matched').length +
                atsKeywordEvidence.filter((item) => item.status === 'partial').length * 0.5
              ) / atsKeywordEvidence.length
            : 0,
          critical_missing_count: atsKeywordEvidence.filter(
            (item) =>
              item.status === 'missing' &&
              (item.priority === 'critical' || item.priority === 'required'),
          ).length,
        }
      : null;

const atsStrengths = safeStringArray(analysis.ats_strengths);
const atsRisks = safeStringArray(analysis.ats_risks);


  const exportBaseName = makeSafeFileName(cvName || analysis.job_title || 'optimized-cv');
  const canOpenBuilder = Boolean(analysis.id && analysis.id !== 'unsaved');

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white p-6 overflow-hidden relative">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-indigo-500/20 blur-2xl" />

        <div className="relative flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div>
            <p className="text-slate-300 text-sm">Analysis complete</p>

            <h3 className="text-4xl font-bold mt-2">
              {mainScore}
              <span className="text-2xl text-slate-400">/100</span>
            </h3>

            <p className="text-sm text-slate-300 mt-3 max-w-xl">
              {getScoreMessage(mainScore)}
            </p>

            <div className="flex flex-wrap gap-2 mt-4">
              <span
                className={`border rounded-full px-3 py-1 text-xs font-semibold ${getRecommendationColor(
                  analysis.recommended_to_apply,
                )}`}
              >
                Apply: {analysis.recommended_to_apply || 'MAYBE'}
              </span>

              <span
                className={`bg-white/10 border border-white/10 rounded-full px-3 py-1 text-xs font-semibold ${getVerdictColor(
                  analysis.qualification_verdict,
                )}`}
              >
                {analysis.qualification_verdict || 'Borderline Qualified'}
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col gap-2 min-w-[190px]">
            <button
              onClick={onOpenResumeBuilder}
              disabled={!canOpenBuilder}
              className="px-4 py-3 rounded-xl bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              <Wand2 size={16} />
              Open Resume Builder
            </button>

            <button
              onClick={() => exportAsPDF(editableGeneratedCV, `${exportBaseName}.pdf`)}
              disabled={!editableGeneratedCV.trim()}
              className="px-4 py-3 rounded-xl bg-white/10 border border-white/10 text-white text-sm font-semibold hover:bg-white/15 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              <Download size={16} />
              Export PDF
            </button>

            <button
              onClick={() => exportAsDOCX(editableGeneratedCV, `${exportBaseName}.docx`)}
              disabled={!editableGeneratedCV.trim()}
              className="px-4 py-3 rounded-xl bg-white/10 border border-white/10 text-white text-sm font-semibold hover:bg-white/15 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              <Download size={16} />
              Export DOCX
            </button>
          </div>

          <Target className="hidden lg:block w-12 h-12 text-indigo-400 shrink-0" />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 p-5 bg-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="font-semibold text-slate-900 flex items-center gap-2">
              <ArrowRight size={18} className="text-indigo-600" />
              Recommended Next Step
            </h4>

            <p className="text-sm text-slate-600 mt-2">
              Review the improvements below, then open the Resume Builder to edit the
              optimized CV visually, save it as a new version, and export it for the
              application.
            </p>
          </div>

          <button
            onClick={onOpenResumeBuilder}
            disabled={!canOpenBuilder}
            className="hidden sm:inline-flex px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 disabled:opacity-50 items-center gap-2"
          >
            Continue
            <ArrowRight size={15} />
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ScoreCard label="Transferability" value={analysis.transferability_score} />
        <ScoreCard label="ATS Match" value={analysis.ats_match_score} />
        <ScoreCard label="Seniority Match" value={analysis.seniority_match_score} />
        <ScoreCard label="Skill Gap" value={analysis.skill_gap_score} />
      </section>

      <Section title="Generated CV">
        <textarea
          value={editableGeneratedCV}
          onChange={(e) => setEditableGeneratedCV(e.target.value)}
          rows={18}
          className="w-full rounded-xl border border-slate-300 p-4 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        />

        <button
          onClick={onCopyGeneratedCV}
          disabled={!editableGeneratedCV.trim()}
          className="mt-3 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 disabled:opacity-50"
        >
          Copy Generated CV
        </button>
      </Section>

      <Section title="Why You're a Match">
        {transferableSkills.length ? (
          <div className="space-y-3">
            {transferableSkills.slice(0, 4).map((item, index) => (
              <div
                key={`${item.skill}-${index}`}
                className="rounded-xl bg-emerald-50 border border-emerald-200 p-4"
              >
                <p className="font-semibold text-emerald-800">{item.skill}</p>
                <p className="text-sm text-emerald-700 mt-1">{item.reason}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyText text="No transferable skills returned." />
        )}
      </Section>

      <Section title="Improve Your Chances">
        {recommendations.length || improvementActions.length ? (
          <BulletList items={[...recommendations, ...improvementActions].slice(0, 8)} />
        ) : (
          <EmptyText text="No recommendations returned." />
        )}
      </Section>

      <section className="grid grid-cols-1 gap-4">
        <SkillList
          title="Critical Missing Skills"
          items={safeStringArray(analysis.critical_missing_skills)}
          tone="red"
        />

        <SkillList
          title="Learnable Missing Skills"
          items={safeStringArray(analysis.learnable_missing_skills)}
          tone="amber"
        />

        <SkillList
          title="Nice-to-Have Missing Skills"
          items={safeStringArray(analysis.nice_to_have_missing_skills)}
          tone="blue"
        />
      </section>


{(atsSummary || atsKeywordEvidence.length || atsStrengths.length || atsRisks.length) && (
  <Section title="ATS Evidence Summary">
    <div className="space-y-5">
      {atsSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniMetric
            label="Requirements"
            value={atsSummary.total_requirements}
          />

          <MiniMetric
            label="Matched"
            value={atsSummary.matched_count}
            tone="green"
          />

          <MiniMetric
            label="Partial"
            value={atsSummary.partial_count}
            tone="amber"
          />

          <MiniMetric
            label="Missing"
            value={atsSummary.missing_count}
            tone="red"
          />

          <MiniMetric
            label="ATS Score"
            value={`${atsSummary.deterministic_score}/100`}
            tone="blue"
          />

          <MiniMetric
            label="Coverage"
            value={`${Math.round(atsSummary.coverage_ratio * 100)}%`}
            tone="blue"
          />

          <MiniMetric
            label="Critical Missing"
            value={atsSummary.critical_missing_count}
            tone={atsSummary.critical_missing_count ? 'red' : 'green'}
          />
        </div>
      )}

      {!!atsStrengths.length && (
        <div>
          <p className="text-sm font-semibold text-slate-800 mb-2">
            ATS Strengths
          </p>
          <BulletList items={atsStrengths.slice(0, 5)} />
        </div>
      )}

      {!!atsRisks.length && (
        <div>
          <p className="text-sm font-semibold text-slate-800 mb-2">
            ATS Risks
          </p>
          <BulletList items={atsRisks.slice(0, 5)} />
        </div>
      )}

      <AtsEvidenceTable evidence={atsKeywordEvidence.slice(0, 18)} />
    </div>
  </Section>
)}

      <details className="rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer p-5 font-semibold text-slate-900">
          Advanced Analysis
        </summary>

        <div className="px-5 pb-5 space-y-5">
          {!!breakdownEntries.length && (
            <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {breakdownEntries.map(([key, value]) => (
                <ScoreCard key={key} label={key} value={value} compact />
              ))}
            </section>
          )}

          <Section title="Matched Keywords">
            <PillList items={safeStringArray(analysis.matched_keywords)} tone="green" />
          </Section>

          <Section title="Partial Keywords">
            <PillList items={safeStringArray(analysis.partial_keywords)} tone="amber" />
          </Section>

          <Section title="Missing Keywords">
            <PillList items={safeStringArray(analysis.missing_keywords)} tone="red" />
          </Section>

          <Section title="Strengths">
            <FeedbackList items={safeFeedbackItems(analysis.strengths)} type="strength" />
          </Section>

          <Section title="Gaps & Weaknesses">
            <FeedbackList items={safeFeedbackItems(analysis.gaps)} type="gap" />
          </Section>
        </div>
      </details>
    </div>
  );
};


const AtsEvidenceTable: React.FC<{
  evidence: AtsKeywordEvidenceItem[];
}> = ({ evidence }) => {
  if (!evidence.length) return <EmptyText text="No keyword evidence returned." />;

  const statusClasses = {
    matched: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    partial: 'bg-amber-50 text-amber-700 border-amber-200',
    missing: 'bg-red-50 text-red-700 border-red-200',
  } as const;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="py-2 pr-3 font-semibold">Keyword</th>
            <th className="py-2 pr-3 font-semibold">Status</th>
            <th className="py-2 pr-3 font-semibold">Priority</th>
            <th className="py-2 font-semibold">Evidence</th>
          </tr>
        </thead>

        <tbody>
          {evidence.map((item, index) => {
            const evidenceText =
              item.evidence?.length
                ? item.evidence.join(', ')
                : item.matched_as || item.reason || 'No evidence found';

            return (
              <tr
                key={`${item.keyword}-${index}`}
                className="border-b border-slate-100 last:border-0"
              >
                <td className="py-3 pr-3 font-medium text-slate-800">
                  <div>{item.keyword}</div>

                  {item.canonical && item.canonical !== item.keyword && (
                    <div className="text-xs text-slate-400 mt-0.5">
                      Canonical: {item.canonical}
                    </div>
                  )}
                </td>

                <td className="py-3 pr-3">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClasses[item.status]}`}
                  >
                    {item.status}
                  </span>
                </td>

                <td className="py-3 pr-3 text-slate-600 capitalize">
                  {item.priority.replaceAll('_', ' ')}
                </td>

                <td className="py-3 text-slate-600">
                  {evidenceText}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

const MiniMetric: React.FC<{
  label: string;
  value: string | number;
  tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue';
}> = ({ label, value, tone = 'slate' }) => {
  const toneClasses = {
    slate: 'bg-slate-50 border-slate-200 text-slate-800',
    green: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
  }[tone];

  return (
    <div className={`rounded-xl border p-3 ${toneClasses}`}>
      <p className="text-xs opacity-75">{label}</p>
      <p className="text-lg font-bold mt-1">{value}</p>
    </div>
  );
};

const ScoreCard: React.FC<{
  label: string;
  value?: number | null;
  compact?: boolean;
}> = ({ label, value = 0, compact }) => {
  const safeValue = clampScore(value);

  return (
    <div className={`rounded-xl border p-4 ${getScoreBgColor(safeValue)}`}>
      <p className="text-xs text-slate-500 capitalize">
        {label.replaceAll('_', ' ')}
      </p>

      <p className={`${compact ? 'text-xl' : 'text-2xl'} font-bold mt-1 ${getScoreColor(safeValue)}`}>
        {safeValue}/100
      </p>
    </div>
  );
};

const Section: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
  <section className="rounded-xl border border-slate-200 p-5 bg-white">
    <h4 className="font-semibold mb-4">{title}</h4>
    {children}
  </section>
);

const SkillList: React.FC<{
  title: string;
  items?: string[];
  tone: 'red' | 'amber' | 'blue';
}> = ({ title, items = [], tone }) => {
  const toneClasses = {
    red: 'bg-red-50 border-red-200 text-red-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
  }[tone];

  return (
    <section className={`rounded-xl border p-5 ${toneClasses}`}>
      <h4 className="font-semibold mb-3">{title}</h4>

      {items.length ? (
        <div className="flex flex-wrap gap-2">
          {items.map((item, index) => (
            <span
              key={`${item}-${index}`}
              className="px-3 py-1 rounded-full bg-white/70 text-sm"
            >
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm opacity-80">None listed.</p>
      )}
    </section>
  );
};

const PillList: React.FC<{
  items?: string[];
  tone: 'green' | 'amber' | 'red';
}> = ({ items = [], tone }) => {
  if (!items.length) return <EmptyText text="None returned." />;

  const toneClasses = {
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
  }[tone];

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <span
          key={`${item}-${index}`}
          className={`px-3 py-1 rounded-full text-sm ${toneClasses}`}
        >
          {item}
        </span>
      ))}
    </div>
  );
};

const FeedbackList: React.FC<{
  items?: { title: string; detail: string }[];
  type: 'strength' | 'gap';
}> = ({ items = [], type }) => {
  if (!items.length) return <EmptyText text="None returned." />;

  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div key={`${item.title}-${index}`} className="flex items-start gap-3">
          {type === 'strength' ? (
            <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-orange-500 mt-0.5" />
          )}

          <div>
            <p className="font-medium">{item.title}</p>
            {item.detail && (
              <p className="text-sm text-slate-600 mt-1">{item.detail}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

const BulletList: React.FC<{ items?: string[] }> = ({ items = [] }) => {
  if (!items.length) return <EmptyText text="None returned." />;

  return (
    <ul className="space-y-3">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="text-sm text-slate-700 flex gap-2">
          <span className="text-indigo-500 font-bold">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
};

const EmptyText: React.FC<{ text: string }> = ({ text }) => (
  <p className="text-sm text-slate-400">{text}</p>
);