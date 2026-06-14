import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/AppLayout';

import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { ApplicationDetailsPage } from './pages/ApplicationDetailsPage';
import { CVManagerPage } from './pages/CVManagerPage';
import { CompaniesPage } from './pages/CompaniesPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { FollowUpsPage } from './pages/FollowUpsPage';
import { ArchivedApplicationsPage } from './pages/ArchivedApplicationsPage';
import { RecruitersPage } from './pages/RecruitersPage';
import { KanbanPage } from './pages/KanbanPage';
import { RecruiterDetailsPage } from './pages/RecruiterDetailsPage';
import { SharedOpportunitiesPage } from './pages/SharedWithMePage';
import { PublicSharePage } from './pages/PublicSharePage';
import { ResumeBuilderPage } from './pages/ResumeBuilderPage';
import { ResumeBuilderStartPage } from './pages/ResumeBuilderStartPage';
import { TailoredDocumentsHistoryPage } from './pages/TailoredDocumentsHistoryPage';

const App: React.FC = () => {
return ( <BrowserRouter> <AuthProvider> <Routes>
<Route path="/auth" element={<AuthPage />} />

      <Route path="/share/:publicShareId" element={<PublicSharePage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/applications" element={<ApplicationsPage />} />
        <Route path="/applications/:id" element={<ApplicationDetailsPage />} />
        <Route path="/cv-manager" element={<CVManagerPage />} />
        <Route path="/companies" element={<CompaniesPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/settings" element={<SettingsPage />} />

        <Route
          path="/notifications"
          element={<Navigate to="/settings?tab=notifications" replace />}
        />

        <Route path="/shared" element={<SharedOpportunitiesPage />} />
        <Route path="/shared-with-me" element={<Navigate to="/shared" replace />} />

        <Route path="/follow-ups" element={<FollowUpsPage />} />
        <Route path="/archived" element={<ArchivedApplicationsPage />} />

        <Route
          path="/archived-applications"
          element={<ArchivedApplicationsPage />}
        />

        <Route path="/recruiters" element={<RecruitersPage />} />
        <Route path="/recruiters/:id" element={<RecruiterDetailsPage />} />
        <Route path="/kanban" element={<KanbanPage />} />

        <Route
          path="/email-sync"
          element={<Navigate to="/settings?tab=emailSync" replace />}
        />

        <Route
          path="/email-events"
          element={<Navigate to="/settings?tab=emailEvents" replace />}
        />

        <Route path="/resume-builder" element={<ResumeBuilderStartPage />} />
        <Route path="/resume-builder/history" element={<TailoredDocumentsHistoryPage />} />
        <Route path="/resume-builder/:analysisId" element={<ResumeBuilderPage />} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  </AuthProvider>
</BrowserRouter>


);
};

export default App;

