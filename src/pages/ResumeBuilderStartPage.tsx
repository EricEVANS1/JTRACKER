// src/pages/ResumeBuilderStartPage.tsx

import React from 'react';
import { Link } from 'react-router-dom';

export const ResumeBuilderStartPage: React.FC = () => {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-2">Resume Builder</h1>
      <p className="text-slate-600 mb-6">
        Start from a CV analysis first, then generate a tailored resume.
      </p>

      <Link
        to="/cv-manager"
        className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        Go to CV Manager
      </Link>
    </div>
  );
};