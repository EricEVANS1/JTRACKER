import React from 'react';
import { Link } from 'react-router-dom';
import {
ArrowRight,
Brain,
CheckCircle2,
ClipboardList,
Download,
FileText,
History,
Sparkles,
Target,
} from 'lucide-react';

const steps = [
{
title: 'Choose your CV',
description: 'Start from an existing CV version already saved in JTracker.',
icon: FileText,
},
{
title: 'Paste the job description',
description: 'Compare your CV against the exact role you want to apply for.',
icon: ClipboardList,
},
{
title: 'Analyse the match',
description: 'See your score, missing keywords, strengths, and gaps.',
icon: Brain,
},
{
title: 'Generate tailored CV',
description: 'Copy or download a targeted CV for that application.',
icon: Download,
},
];

const benefits = [
'CV text extraction confirmation',
'Match score with clear explanation',
'Top missing keywords',
'Apply recommendation badge',
'Generated CV copy and download actions',
'Score history over time',
];

export const ResumeBuilderStartPage: React.FC = () => {
return ( <div className="w-full max-w-6xl overflow-hidden"> <div className="mb-8"> <p className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 mb-4"> <Sparkles size={14} />
CV Intelligence workflow </p>


    <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">
      Build a tailored CV from a job description
    </h1>

    <p className="text-slate-600 mt-3 max-w-2xl">
      Start with one of your saved CVs, paste a job description, analyse your match,
      then generate a tailored CV you can copy or download.
    </p>
  </div>

  <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-6">
    <section className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-8 shadow-sm overflow-hidden">
      <div className="flex items-start gap-4 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0">
          <Target size={22} />
        </div>

        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Recommended flow
          </h2>

          <p className="text-sm text-slate-500 mt-1">
            Best for applications where you want a stronger CV match score.
          </p>
        </div>
      </div>

      <div className="space-y-3 mb-8">
        {steps.map((step, index) => {
          const Icon = step.icon;

          return (
            <div
              key={step.title}
              className="flex gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"
            >
              <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
                <Icon size={18} className="text-slate-700" />
              </div>

              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Step {index + 1}
                </p>

                <h3 className="font-semibold text-slate-900 mt-0.5">
                  {step.title}
                </h3>

                <p className="text-sm text-slate-500 mt-1">
                  {step.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Link
          to="/cv-manager"
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-700 transition"
        >
          Start from CV Manager
          <ArrowRight size={16} />
        </Link>

        <Link
          to="/resume-builder/history"
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
        >
          <History size={16} />
          View tailored history
        </Link>
      </div>
    </section>

    <section className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-8 shadow-sm overflow-hidden">
        <div className="flex items-start gap-4 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
            <Brain size={22} />
          </div>

          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              What CV Intelligence gives you
            </h2>

            <p className="text-sm text-slate-500 mt-1">
              A clearer result than a simple score.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {benefits.map((benefit) => (
            <div key={benefit} className="flex items-center gap-3 text-sm text-slate-700">
              <CheckCircle2 size={17} className="text-emerald-600 shrink-0" />
              <span>{benefit}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 text-white rounded-3xl p-5 sm:p-8 shadow-sm overflow-hidden">
        <h2 className="text-xl font-semibold">
          Coming next
        </h2>

        <p className="text-sm text-slate-300 mt-2 leading-relaxed">
          After generating a tailored CV, JTracker should let you attach it directly
          to an application, track which CV version was used, and compare your score
          improvements over time.
        </p>

        <div className="mt-5 rounded-2xl bg-white/10 border border-white/10 p-4">
          <p className="text-sm font-medium">
            Target workflow
          </p>

          <p className="text-sm text-slate-300 mt-1">
            CV score → tailored CV → saved application → follow-up reminder → recruiter tracking.
          </p>
        </div>
      </div>
    </section>
  </div>
</div>


);
};
