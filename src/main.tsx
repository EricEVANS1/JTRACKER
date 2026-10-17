import React from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StartupError } from './components/StartupError';
import { getMissingConfig } from './lib/config';
import { clearLegacyResumeImport } from './lib/resumeDraft';
import './index.css';

clearLegacyResumeImport();

const root = ReactDOM.createRoot(document.getElementById('root')!);
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const missingConfig = getMissingConfig();

if (missingConfig.length) {
  // The Supabase client can't be created without these, so show what's missing
  // instead of a blank page.
  root.render(<StartupError missingConfig={missingConfig} />);
} else {
  import('./App')
    .then(({ default: App }) =>
      root.render(
        <React.StrictMode>
          <ErrorBoundary variant="app">
            <GoogleOAuthProvider clientId={clientId}>
              <App />
            </GoogleOAuthProvider>
          </ErrorBoundary>
        </React.StrictMode>,
      ),
    )
    .catch(() => root.render(<StartupError />));
}
