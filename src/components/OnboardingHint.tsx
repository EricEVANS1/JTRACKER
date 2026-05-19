import React from 'react';

interface OnboardingHintProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const OnboardingHint: React.FC<OnboardingHintProps> = ({
  title,
  description,
  actionLabel,
  onAction,
}) => {
  return (
    <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 mb-6 overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">
            Getting Started
          </p>

          <h3 className="text-lg font-semibold break-words">{title}</h3>

          <p className="text-sm text-slate-300 mt-1 break-words">
            {description}
          </p>
        </div>

        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="w-full sm:w-auto bg-white text-slate-900 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-100 transition"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
};