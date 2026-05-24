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
import { NotificationsPage } from './pages/NotificationsPage';
import { FollowUpsPage } from './pages/FollowUpsPage';
import { ArchivedApplicationsPage } from './pages/ArchivedApplicationsPage';
import { RecruitersPage } from './pages/RecruitersPage';
import { KanbanPage } from './pages/KanbanPage';
import { RecruiterDetailsPage } from './pages/RecruiterDetailsPage';
import { SharedWithMePage } from './pages/SharedWithMePage';
import { PublicSharePage } from './pages/PublicSharePage';

/* ADD THESE */
import { GmailSyncPage } from './pages/GmailSyncPage';
import { EmailEventsPage } from './pages/EmailEventsPage';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
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

            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/shared-with-me" element={<SharedWithMePage />} />
            <Route path="/follow-ups" element={<FollowUpsPage />} />
            <Route path="/archived" element={<ArchivedApplicationsPage />} />
            <Route
              path="/archived-applications"
              element={<ArchivedApplicationsPage />}
            />

            <Route path="/recruiters" element={<RecruitersPage />} />
            <Route path="/recruiters/:id" element={<RecruiterDetailsPage />} />
            <Route path="/kanban" element={<KanbanPage />} />

            {/* NEW */}
            <Route path="/gmail-sync" element={<GmailSyncPage />} />
            <Route path="/email-events" element={<EmailEventsPage />} />
          </Route>

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;