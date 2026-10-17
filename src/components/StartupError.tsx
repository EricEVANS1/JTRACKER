import React from 'react';

interface Props {
  // Required settings that are missing from this build, if that is the cause.
  missingConfig?: readonly string[];
}

// Shown instead of a blank page when the app cannot start. Uses no app
// modules, so it renders even when the Supabase client cannot be created.
export const StartupError: React.FC<Props> = ({ missingConfig = [] }) => (
  <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
    <div role="alert" className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="mb-2 text-xl font-bold text-slate-900">
        {missingConfig.length ? 'JTracker is not configured' : 'JTracker could not start'}
      </h1>

      {missingConfig.length ? (
        <>
          <p className="mb-4 text-sm text-slate-500">
            This deployment is missing settings it needs to connect to its database:
          </p>
          <ul className="mb-4 list-disc space-y-1 pl-5 text-sm">
            {missingConfig.map((name) => (
              <li key={name}>
                <code className="font-mono text-slate-800">{name}</code>
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-500">
            Add them to the hosting environment variables (for example in Vercel, Settings → Environment Variables) and
            redeploy.
          </p>
        </>
      ) : (
        <>
          <p className="mb-6 text-sm text-slate-500">
            Check your connection and reload the page. If this keeps happening, the latest version may still be
            deploying.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition"
          >
            Reload page
          </button>
        </>
      )}
    </div>
  </div>
);
