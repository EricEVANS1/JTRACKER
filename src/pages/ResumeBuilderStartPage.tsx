// src/pages/ResumeBuilderStartPage.tsx

import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  FileText,
  GitBranch,
  Sparkles,
} from 'lucide-react';

export const ResumeBuilderStartPage: React.FC = () => {
  return (
    <div className="w-full max-w-5xl">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-widest text-slate-400 mb-2">
          CV Intelligence
        </p>

        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-2">
          Resume Builder
        </h1>

        <p className="text-sm sm:text-base text-slate-600 max-w-2xl leading-relaxed">
          Create tailored CV versions from your saved CV analyses. Start with a CV
          and job description in CV Manager, run analysis, then open the optimized
          result here for editing, formatting, PDF export, DOCX export, and saving
          back to your CV library.
        </p>
      </div>

      <div className="bg-slate-900 text-white rounded-2xl p-5 sm:p-6 mb-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
            <Sparkles size={24} />
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold mb-1">
              Build a role-specific CV from real analysis
            </h2>

            <p className="text-sm text-slate-300 leading-relaxed">
              Resume Builder works best after JTracker compares your CV against a
              target job description. This keeps tailoring grounded and helps avoid
              adding skills or experience that are not actually in your profile.
            </p>

            <div className="mt-5 flex flex-col sm:flex-row gap-3">
              <Link
                to="/cv-manager"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100 transition"
              >
                Go to CV Manager
                <ArrowRight size={15} />
              </Link>

              <Link
                to="/applications"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition"
              >
                View Applications
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <WorkflowCard
          icon={FileText}
          title="1. Select a CV"
          description="Upload or choose an existing CV version from CV Manager."
        />

        <WorkflowCard
          icon={Briefcase}
          title="2. Add job details"
          description="Paste the job description so JTracker can compare your CV against the role."
        />

        <WorkflowCard
          icon={Sparkles}
          title="3. Generate tailored CV"
          description="Open the Resume Builder from an analysis and refine the final version."
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">
            What you can do here
          </h3>

          <div className="space-y-3">
            <FeatureItem text="Edit generated CV sections before saving." />
            <FeatureItem text="Adjust layout, spacing, page size, fonts, and template." />
            <FeatureItem text="Export the finished CV as PDF or DOCX." />
            <FeatureItem text="Save the tailored CV as a new CV version." />
            <FeatureItem text="Keep tailoring safer by using your locked CV facts." />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">
            Recommended next steps
          </h3>

          <div className="space-y-3">
            <ActionLink
              to="/cv-manager"
              icon={FileText}
              title="Run CV analysis"
              description="Analyze your CV against a job description first."
            />

            <ActionLink
              to="/applications"
              icon={Briefcase}
              title="Attach CVs to applications"
              description="Track which CV version you used for each job."
            />

            <ActionLink
              to="/settings?tab=profile"
              icon={GitBranch}
              title="Add profile links"
              description="Save LinkedIn, GitHub, and portfolio links for CV reuse."
            />
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-800">
          <span className="font-semibold">Note:</span> Resume Builder opens the
          editor from a specific CV analysis. If you came here directly, start in
          CV Manager first.
        </p>
      </div>
    </div>
  );
};

const WorkflowCard = ({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) => (
  <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center mb-4">
      <Icon size={19} className="text-slate-700" />
    </div>

    <h3 className="font-semibold text-slate-900 mb-2">{title}</h3>

    <p className="text-sm text-slate-500 leading-relaxed">{description}</p>
  </div>
);

const FeatureItem = ({ text }: { text: string }) => (
  <div className="flex items-start gap-2">
    <CheckCircle2 size={16} className="text-slate-500 shrink-0 mt-0.5" />
    <p className="text-sm text-slate-600">{text}</p>
  </div>
);

const ActionLink = ({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: string;
  icon: React.ElementType;
  title: string;
  description: string;
}) => (
  <Link
    to={to}
    className="block rounded-xl border border-slate-200 p-4 hover:bg-slate-50 transition"
  >
    <div className="flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
        <Icon size={17} className="text-slate-700" />
      </div>

      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">{title}</p>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  </Link>
);