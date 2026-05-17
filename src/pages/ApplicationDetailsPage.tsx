import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  MessageSquarePlus,
  RefreshCw,
  Save,
  Share2,
  UserRound,
  X,
} from 'lucide-react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Application } from '../types/application';

type ApplicationStatus =
  | 'wishlist'
  | 'applied'
  | 'confirmation_received'
  | 'assessment'
  | 'interview'
  | 'final_interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'
  | 'ghosted'
  | 'archived';

interface CompanyJoin {
  name: string;
  website?: string | null;
  location?: string | null;
}

interface CVVersionJoin {
  name: string;
  target_role?: string | null;
  file_url?: string | null;
}

interface RecruiterJoin {
  id: string;
  name: string;
  email: string | null;
}

interface RawApplication extends Omit<Application, 'companies' | 'cv_versions' | 'recruiters'> {
  companies?: CompanyJoin | CompanyJoin[] | null;
  cv_versions?: CVVersionJoin | CVVersionJoin[] | null;
  recruiters?: RecruiterJoin | RecruiterJoin[] | null;

  recruiter_id?: string | null;
  follow_up_date?: string | null;
  last_status_changed_at?: string | null;

  response_received_at?: string | null;
  assessment_received_at?: string | null;
  interview_started_at?: string | null;
  final_interview_started_at?: string | null;
  offer_received_at?: string | null;
  rejected_at?: string | null;
  withdrawn_at?: string | null;
  ghosted_at?: string | null;
}

interface DetailedApplication extends Omit<RawApplication, 'companies' | 'cv_versions' | 'recruiters'> {
  companies: CompanyJoin | null;
  cv_versions: CVVersionJoin | null;
  recruiters: RecruiterJoin | null;
}

interface ApplicationEvent {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  event_type: string;
}

interface InterviewNote {
  id: string;
  interview_stage: string | null;
  interview_date: string | null;
  notes: string | null;
  questions: string[] | null;
}

interface EmailEvent {
  id: string;
  sender: string | null;
  subject: string | null;
  snippet: string | null;
  detected_status: string | null;
  received_at: string | null;
}

interface RecruiterOption {
  id: string;
  name: string;
  email: string | null;
}

const statuses: { value: ApplicationStatus; label: string }[] = [
  { value: 'wishlist', label: 'Wishlist' },
  { value: 'applied', label: 'Applied' },
  { value: 'confirmation_received', label: 'Confirmation Received' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'interview', label: 'Interview' },
  { value: 'final_interview', label: 'Final Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'ghosted', label: 'Ghosted' },
  { value: 'archived', label: 'Archived' },
];

const statusClasses: Record<string, string> = {
  wishlist: 'bg-slate-100 text-slate-700',
  applied: 'bg-blue-100 text-blue-700',
  confirmation_received: 'bg-cyan-100 text-cyan-700',
  assessment: 'bg-purple-100 text-purple-700',
  interview: 'bg-amber-100 text-amber-700',
  final_interview: 'bg-orange-100 text-orange-700',
  offer: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  withdrawn: 'bg-zinc-100 text-zinc-700',
  ghosted: 'bg-gray-200 text-gray-700',
  archived: 'bg-slate-200 text-slate-600',
};

const inputCls =
  'border border-slate-300 rounded-lg px-3 py-2 text-sm w-full bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

const firstOrNull = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const formatStatus = (status: string) =>
  status.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const formatDate = (date?: string | null) => {
  if (!date) return 'Not set';

  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const formatDateTime = (date?: string | null) => {
  if (!date) return 'Not set';

  return new Date(date).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getLifecycleUpdate = (status: ApplicationStatus) => {
  const now = new Date().toISOString();

  const update: Record<string, string | boolean | null> = {
    status,
    last_status_changed_at: now,
  };

  if (status === 'archived') {
    update.archived = true;
    update.archived_at = now;
  } else {
    update.archived = false;
    update.archived_at = null;
  }

  if (status === 'confirmation_received') update.response_received_at = now;

  if (status === 'assessment') {
    update.response_received_at = now;
    update.assessment_received_at = now;
  }

  if (status === 'interview') {
    update.response_received_at = now;
    update.interview_started_at = now;
  }

  if (status === 'final_interview') {
    update.response_received_at = now;
    update.interview_started_at = now;
    update.final_interview_started_at = now;
  }

  if (status === 'offer') {
    update.response_received_at = now;
    update.offer_received_at = now;
  }

  if (status === 'rejected') {
    update.response_received_at = now;
    update.rejected_at = now;
  }

  if (status === 'withdrawn') update.withdrawn_at = now;

  if (status === 'ghosted') {
    update.response_received_at = now;
    update.ghosted_at = now;
  }

  return update;
};

export const ApplicationDetailsPage: React.FC = () => {
  const { id } = useParams();
  const { user } = useAuth();

  const [application, setApplication] = useState<DetailedApplication | null>(null);
  const [events, setEvents] = useState<ApplicationEvent[]>([]);
  const [emailEvents, setEmailEvents] = useState<EmailEvent[]>([]);
  const [recruiters, setRecruiters] = useState<RecruiterOption[]>([]);
  const [interviewNote, setInterviewNote] = useState<InterviewNote | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [selectedStatus, setSelectedStatus] = useState<ApplicationStatus>('applied');
  const [savingStatus, setSavingStatus] = useState(false);

  const [editingDetails, setEditingDetails] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);

  const [editRoleTitle, setEditRoleTitle] = useState('');
  const [editApplicationLink, setEditApplicationLink] = useState('');
  const [editSource, setEditSource] = useState('');
  const [editDateApplied, setEditDateApplied] = useState('');
  const [editEmailUsed, setEditEmailUsed] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editJobType, setEditJobType] = useState('');
  const [editSalaryRange, setEditSalaryRange] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editRecruiterId, setEditRecruiterId] = useState('');
  const [editFollowUpDate, setEditFollowUpDate] = useState('');

  const [interviewStage, setInterviewStage] = useState('');
  const [interviewDate, setInterviewDate] = useState('');
  const [interviewNotes, setInterviewNotes] = useState('');
  const [interviewQuestions, setInterviewQuestions] = useState('');
  const [savingInterview, setSavingInterview] = useState(false);

  const [activityTitle, setActivityTitle] = useState('');
  const [activityDescription, setActivityDescription] = useState('');
  const [activityType, setActivityType] = useState('note');
  const [savingActivity, setSavingActivity] = useState(false);

  const [followUpMessage, setFollowUpMessage] = useState('');
  const [copiedFollowUp, setCopiedFollowUp] = useState(false);

  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [sharing, setSharing] = useState(false);
  const [includeStatus, setIncludeStatus] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [includeExperience, setIncludeExperience] = useState(false);

  const fetchApplicationDetails = async () => {
    if (!user || !id) return;

    setError('');

    const { data: applicationData, error: applicationError } = await supabase
      .from('applications')
      .select(`
        *,
        companies (
          name,
          website,
          location
        ),
        cv_versions (
          name,
          target_role,
          file_url
        ),
        recruiters (
          id,
          name,
          email
        )
      `)
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (applicationError) {
      setError(applicationError.message);
      setLoading(false);
      return;
    }

    const normalizedApplication: DetailedApplication = {
      ...(applicationData as RawApplication),
      companies: firstOrNull((applicationData as RawApplication).companies),
      cv_versions: firstOrNull((applicationData as RawApplication).cv_versions),
      recruiters: firstOrNull((applicationData as RawApplication).recruiters),
    };

    const [eventResult, emailEventResult, interviewResult, recruiterResult] =
      await Promise.all([
        supabase
          .from('application_events')
          .select('*')
          .eq('application_id', id)
          .eq('user_id', user.id)
          .order('event_date', { ascending: false }),

        supabase
          .from('email_events')
          .select('id, sender, subject, snippet, detected_status, received_at')
          .eq('application_id', id)
          .eq('user_id', user.id)
          .order('received_at', { ascending: false }),

        supabase
          .from('interview_notes')
          .select('*')
          .eq('application_id', id)
          .eq('user_id', user.id)
          .maybeSingle(),

        supabase
          .from('recruiters')
          .select('id, name, email')
          .eq('user_id', user.id)
          .order('name', { ascending: true }),
      ]);

    if (eventResult.error) setError(eventResult.error.message);
    if (emailEventResult.error) setError(emailEventResult.error.message);
    if (interviewResult.error) setError(interviewResult.error.message);
    if (recruiterResult.error) setError(recruiterResult.error.message);

    setApplication(normalizedApplication);
    setSelectedStatus(normalizedApplication.status as ApplicationStatus);
    setEvents(eventResult.data || []);
    setEmailEvents(emailEventResult.data || []);
    setRecruiters(recruiterResult.data || []);

    setEditRoleTitle(normalizedApplication.role_title || '');
    setEditApplicationLink(normalizedApplication.application_link || '');
    setEditSource(normalizedApplication.source || '');
    setEditDateApplied(normalizedApplication.date_applied || '');
    setEditEmailUsed(normalizedApplication.email_used || user.email || '');
    setEditLocation(normalizedApplication.location || '');
    setEditJobType(normalizedApplication.job_type || '');
    setEditSalaryRange(normalizedApplication.salary_range || '');
    setEditNotes(normalizedApplication.notes || '');
    setEditRecruiterId(normalizedApplication.recruiter_id || '');
    setEditFollowUpDate(
      normalizedApplication.follow_up_date
        ? normalizedApplication.follow_up_date.slice(0, 16)
        : ''
    );

    if (interviewResult.data) {
      const data = interviewResult.data as InterviewNote;
      setInterviewNote(data);
      setInterviewStage(data.interview_stage || '');
      setInterviewDate(data.interview_date ? data.interview_date.slice(0, 16) : '');
      setInterviewNotes(data.notes || '');
      setInterviewQuestions(
        Array.isArray(data.questions) ? data.questions.join('\n') : ''
      );
    }

    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchApplicationDetails();
    setRefreshing(false);
  };

  useEffect(() => {
    setLoading(true);
    fetchApplicationDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, id]);

  const lifecycleItems = useMemo(() => {
    if (!application) return [];

    return [
      { label: 'Applied', value: application.date_applied || application.created_at },
      { label: 'Response', value: application.response_received_at },
      { label: 'Assessment', value: application.assessment_received_at },
      { label: 'Interview', value: application.interview_started_at },
      { label: 'Final Interview', value: application.final_interview_started_at },
      { label: 'Offer', value: application.offer_received_at },
      { label: 'Rejected', value: application.rejected_at },
      { label: 'Withdrawn', value: application.withdrawn_at },
      { label: 'Ghosted', value: application.ghosted_at },
    ];
  }, [application]);

  const handleUpdateStatus = async () => {
    if (!user || !id || !application) return;
    if (selectedStatus === application.status) return;

    setSavingStatus(true);
    setError('');
    setMessage('');

    const oldStatus = application.status;
    const updatePayload = getLifecycleUpdate(selectedStatus);

    const { error: updateError } = await supabase
      .from('applications')
      .update(updatePayload)
      .eq('id', id)
      .eq('user_id', user.id);

    if (updateError) {
      setError(updateError.message);
      setSavingStatus(false);
      return;
    }

    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: id,
      event_type: 'status_changed',
      title: `Status changed to ${formatStatus(selectedStatus)}`,
      description: `Status changed from ${formatStatus(oldStatus)} to ${formatStatus(
        selectedStatus
      )}.`,
      event_date: new Date().toISOString(),
    });

    setMessage('Status updated.');
    await fetchApplicationDetails();
    setSavingStatus(false);
  };

  const handleSaveApplicationDetails = async () => {
    if (!user || !id) return;

    setSavingDetails(true);
    setError('');
    setMessage('');

    const { error: updateError } = await supabase
      .from('applications')
      .update({
        role_title: editRoleTitle,
        application_link: editApplicationLink || null,
        source: editSource || null,
        date_applied: editDateApplied || null,
        email_used: editEmailUsed || user.email || null,
        location: editLocation || null,
        job_type: editJobType || null,
        salary_range: editSalaryRange || null,
        notes: editNotes || null,
        recruiter_id: editRecruiterId || null,
        follow_up_date: editFollowUpDate ? new Date(editFollowUpDate).toISOString() : null,
      })
      .eq('id', id)
      .eq('user_id', user.id);

    if (updateError) {
      setError(updateError.message);
      setSavingDetails(false);
      return;
    }

    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: id,
      event_type: 'application_updated',
      title: 'Application details updated',
      description: 'Application information was updated.',
      event_date: new Date().toISOString(),
    });

    setMessage('Application details saved.');
    await fetchApplicationDetails();
    setEditingDetails(false);
    setSavingDetails(false);
  };

  const handleSaveInterviewPrep = async () => {
    if (!user || !id) return;

    setSavingInterview(true);
    setError('');
    setMessage('');

    const questionsArray = interviewQuestions
      .split('\n')
      .map((q) => q.trim())
      .filter(Boolean);

    const payload = {
      user_id: user.id,
      application_id: id,
      interview_stage: interviewStage || null,
      interview_date: interviewDate ? new Date(interviewDate).toISOString() : null,
      notes: interviewNotes || null,
      questions: questionsArray,
    };

    if (interviewNote) {
      const { error } = await supabase
        .from('interview_notes')
        .update(payload)
        .eq('id', interviewNote.id)
        .eq('user_id', user.id);

      if (error) {
        setError(error.message);
        setSavingInterview(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from('interview_notes')
        .insert(payload)
        .select('*')
        .single();

      if (error) {
        setError(error.message);
        setSavingInterview(false);
        return;
      }

      setInterviewNote(data);
    }

    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: id,
      event_type: 'interview_prep_updated',
      title: 'Interview prep updated',
      description: interviewStage
        ? `Updated interview prep for ${interviewStage}.`
        : 'Updated interview preparation notes.',
      event_date: new Date().toISOString(),
    });

    setMessage('Interview prep saved.');
    await fetchApplicationDetails();
    setSavingInterview(false);
  };

  const handleGenerateFollowUp = async () => {
    if (!user || !id || !application) return;

    const companyName = application.companies?.name || 'your company';

    const generatedMessage = `Hello,

I hope you are doing well.

I wanted to kindly follow up on my application for the ${application.role_title} position at ${companyName}. I remain very interested in the opportunity and would appreciate any updates regarding the next steps in the recruitment process.

Thank you for your time and consideration.

Best regards,`;

    setFollowUpMessage(generatedMessage);
    setCopiedFollowUp(false);

    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: id,
      event_type: 'follow_up_generated',
      title: 'Follow-up message generated',
      description: 'A follow-up email template was generated for this application.',
      event_date: new Date().toISOString(),
    });

    await fetchApplicationDetails();
  };

  const handleCopyFollowUp = async () => {
    if (!followUpMessage) return;

    await navigator.clipboard.writeText(followUpMessage);
    setCopiedFollowUp(true);
  };

  const handleAddActivity = async () => {
    if (!user || !id || !activityTitle.trim()) return;

    setSavingActivity(true);
    setError('');
    setMessage('');

    const { error } = await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: id,
      event_type: activityType,
      title: activityTitle.trim(),
      description: activityDescription || null,
      event_date: new Date().toISOString(),
    });

    if (error) {
      setError(error.message);
      setSavingActivity(false);
      return;
    }

    setActivityTitle('');
    setActivityDescription('');
    setActivityType('note');

    setMessage('Activity added.');
    await fetchApplicationDetails();
    setSavingActivity(false);
  };

  const handleShareOpportunity = async () => {
    if (!user || !application) return;

    if (!recipientEmail.trim()) {
      setError('Please enter the recipient email.');
      return;
    }

    setSharing(true);
    setError('');
    setMessage('');

    const { data: recipientProfile, error: recipientError } = await supabase
      .from('profiles')
      .select('id, email')
      .ilike('email', recipientEmail.trim())
      .maybeSingle();

    if (recipientError) {
      setError(recipientError.message);
      setSharing(false);
      return;
    }

    if (!recipientProfile) {
      setError('No JTracker user found with that email.');
      setSharing(false);
      return;
    }

    if (recipientProfile.id === user.id) {
      setError('You cannot share an opportunity with yourself.');
      setSharing(false);
      return;
    }

    const publicShareId = crypto.randomUUID();

    const { error: shareError } = await supabase.from('shared_opportunities').insert({
      sender_user_id: user.id,
      recipient_user_id: recipientProfile.id,
      application_id: application.id,

      public_share_id: publicShareId,

      role_title: application.role_title,
      company_name: application.companies?.name || null,
      location: application.location || application.companies?.location || null,
      job_link: application.application_link || null,
      note: shareNote || null,

      include_status: includeStatus,
      include_notes: includeNotes,
      include_experience: includeExperience,

      status_snapshot: includeStatus ? application.status : null,
      notes_snapshot: includeNotes ? application.notes : null,
      experience_snapshot: includeExperience
        ? `Shared from JTracker by ${user.email || 'a JTracker user'}`
        : null,
    });

    if (shareError) {
      setError(shareError.message);
      setSharing(false);
      return;
    }

    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: application.id,
      event_type: 'opportunity_shared',
      title: 'Opportunity shared',
      description: `Shared with ${recipientEmail.trim()}.`,
      event_date: new Date().toISOString(),
    });

    setMessage('Opportunity shared successfully.');
    setShareModalOpen(false);
    setRecipientEmail('');
    setShareNote('');
    setIncludeStatus(false);
    setIncludeNotes(false);
    setIncludeExperience(false);

    await fetchApplicationDetails();
    setSharing(false);
  };

  if (loading) return <ApplicationDetailsSkeleton />;

  if (!application) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8">
        <p className="text-slate-500">Application not found.</p>
      </div>
    );
  }

  return (
    <div>
      <Link
        to="/applications"
        className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-6"
      >
        <ArrowLeft size={16} />
        Back to Applications
      </Link>

      {error && <AlertBox type="error" message={error} onClose={() => setError('')} />}
      {message && (
        <AlertBox type="success" message={message} onClose={() => setMessage('')} />
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">{application.role_title}</h1>

            <div className="flex items-center gap-2 text-slate-600 mb-4">
              <Building2 size={18} />
              <span>{application.companies?.name || 'Unknown Company'}</span>
            </div>

            <span
              className={`px-3 py-1 rounded-full text-sm font-medium ${
                statusClasses[application.status] || statusClasses.applied
              }`}
            >
              {formatStatus(application.status)}
            </span>

            <div className="mt-6 flex flex-col sm:flex-row gap-3 max-w-md">
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value as ApplicationStatus)}
                className={inputCls}
              >
                {statuses.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>

              <button
                onClick={handleUpdateStatus}
                disabled={savingStatus || selectedStatus === application.status}
                className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 whitespace-nowrap"
              >
                {savingStatus ? 'Updating...' : 'Update Status'}
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center justify-center gap-2 border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>

            <button
              onClick={() => setEditingDetails((prev) => !prev)}
              className="inline-flex items-center justify-center border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm"
            >
              {editingDetails ? 'Cancel Edit' : 'Edit Details'}
            </button>

            <button
              onClick={() => setShareModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm"
            >
              <Share2 size={16} />
              Share Opportunity
            </button>

            {application.application_link && (
              <a
                href={application.application_link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm"
              >
                Open Job Posting
                <ExternalLink size={16} />
              </a>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4 mt-8">
          <InfoCard icon={<CalendarDays size={16} />} label="Date Applied" value={formatDate(application.date_applied)} />
          <InfoCard icon={<Mail size={16} />} label="Email Used" value={application.email_used || 'Not specified'} />
          <InfoCard icon={<MapPin size={16} />} label="Location" value={application.location || 'Not specified'} />
          <InfoCard icon={<Building2 size={16} />} label="Source" value={application.source || 'Not specified'} />
          <InfoCard icon={<CalendarDays size={16} />} label="Follow-up" value={formatDateTime(application.follow_up_date)} />
          <InfoCard icon={<CalendarDays size={16} />} label="Last Update" value={formatDateTime(application.last_status_changed_at)} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <InfoCard
            icon={<FileText size={16} />}
            label="CV Version"
            value={
              application.cv_versions?.target_role
                ? `${application.cv_versions.name} · ${application.cv_versions.target_role}`
                : application.cv_versions?.name || 'No CV selected'
            }
          />

          <InfoCard
            icon={<UserRound size={16} />}
            label="Recruiter"
            value={
              application.recruiters?.email
                ? `${application.recruiters.name} · ${application.recruiters.email}`
                : application.recruiters?.name || 'No recruiter selected'
            }
          />
        </div>

        <div className="mt-8 border border-slate-200 rounded-2xl p-5 bg-slate-50">
          <h2 className="text-lg font-semibold mb-4">Lifecycle Timeline</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-3">
            {lifecycleItems.map((item) => (
              <LifecycleItem
                key={item.label}
                label={item.label}
                value={formatDateTime(item.value)}
                complete={Boolean(item.value)}
              />
            ))}
          </div>
        </div>

        {application.notes && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold mb-3">Notes</h2>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 whitespace-pre-wrap text-sm text-slate-700">
              {application.notes}
            </div>
          </div>
        )}
      </div>

      {editingDetails && (
        <Section title="Edit Application Details" description="Update the application information and linked recruiter.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Role Title">
              <input value={editRoleTitle} onChange={(e) => setEditRoleTitle(e.target.value)} className={inputCls} />
            </Field>

            <Field label="Application Link">
              <input value={editApplicationLink} onChange={(e) => setEditApplicationLink(e.target.value)} className={inputCls} />
            </Field>

            <Field label="Source">
              <select value={editSource} onChange={(e) => setEditSource(e.target.value)} className={inputCls}>
                <option value="">Select source</option>
                <option value="LinkedIn">LinkedIn</option>
                <option value="Indeed">Indeed</option>
                <option value="Glassdoor">Glassdoor</option>
                <option value="Company Website">Company Website</option>
                <option value="Recruiter">Recruiter</option>
                <option value="Referral">Referral</option>
                <option value="Gmail Sync">Gmail Sync</option>
                <option value="Pracuj.pl">Pracuj.pl</option>
                <option value="No Fluff Jobs">No Fluff Jobs</option>
                <option value="Just Join IT">Just Join IT</option>
                <option value="Other">Other</option>
              </select>
            </Field>

            <Field label="Date Applied">
              <input value={editDateApplied} onChange={(e) => setEditDateApplied(e.target.value)} type="date" className={inputCls} />
            </Field>

            <Field label="Email Used">
              <input value={editEmailUsed} onChange={(e) => setEditEmailUsed(e.target.value)} className={inputCls} />
            </Field>

            <Field label="Location">
              <input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} className={inputCls} />
            </Field>

            <Field label="Job Type">
              <select value={editJobType} onChange={(e) => setEditJobType(e.target.value)} className={inputCls}>
                <option value="">Select job type</option>
                <option value="Full-time">Full-time</option>
                <option value="Part-time">Part-time</option>
                <option value="Internship">Internship</option>
                <option value="Contract">Contract</option>
                <option value="Temporary">Temporary</option>
                <option value="Freelance">Freelance</option>
                <option value="Remote">Remote</option>
                <option value="Hybrid">Hybrid</option>
                <option value="On-site">On-site</option>
              </select>
            </Field>

            <Field label="Salary Range">
              <input value={editSalaryRange} onChange={(e) => setEditSalaryRange(e.target.value)} className={inputCls} />
            </Field>

            <Field label="Recruiter">
              <select value={editRecruiterId} onChange={(e) => setEditRecruiterId(e.target.value)} className={inputCls}>
                <option value="">No recruiter selected</option>
                {recruiters.map((recruiter) => (
                  <option key={recruiter.id} value={recruiter.id}>
                    {recruiter.name}
                    {recruiter.email ? ` - ${recruiter.email}` : ''}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Follow-up Date">
              <input type="datetime-local" value={editFollowUpDate} onChange={(e) => setEditFollowUpDate(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <div className="mt-4">
            <Field label="Notes">
              <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className={`${inputCls} min-h-28`} />
            </Field>
          </div>

          <div className="flex justify-end mt-4">
            <button onClick={handleSaveApplicationDetails} disabled={savingDetails} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 inline-flex items-center gap-2">
              <Save size={15} />
              {savingDetails ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </Section>
      )}

      <Section title="Interview Preparation" description="Store preparation notes, interview stage, and questions for this application.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <input value={interviewStage} onChange={(e) => setInterviewStage(e.target.value)} placeholder="Interview stage e.g. HR Screen" className={inputCls} />
          <input value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} type="datetime-local" className={inputCls} />
        </div>

        <textarea value={interviewNotes} onChange={(e) => setInterviewNotes(e.target.value)} placeholder="Preparation notes..." className={`${inputCls} min-h-28 mb-4`} />
        <textarea value={interviewQuestions} onChange={(e) => setInterviewQuestions(e.target.value)} placeholder="Questions to prepare, one per line..." className={`${inputCls} min-h-28`} />

        <div className="flex justify-end mt-4">
          <button onClick={handleSaveInterviewPrep} disabled={savingInterview} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
            {savingInterview ? 'Saving...' : 'Save Interview Prep'}
          </button>
        </div>
      </Section>

      <Section title="Follow-up Email Generator" description="Generate a professional follow-up message for this application.">
        <button onClick={handleGenerateFollowUp} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm mb-4">
          Generate Follow-up Message
        </button>

        {followUpMessage && (
          <div>
            <textarea value={followUpMessage} onChange={(e) => setFollowUpMessage(e.target.value)} className={`${inputCls} min-h-48`} />

            <div className="flex justify-end mt-4">
              <button onClick={handleCopyFollowUp} className="border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm inline-flex items-center gap-2">
                <Clipboard size={15} />
                {copiedFollowUp ? 'Copied' : 'Copy Message'}
              </button>
            </div>
          </div>
        )}
      </Section>

      <Section title="Email History" description="Job-related emails linked to this application.">
        {emailEvents.length === 0 ? (
          <p className="text-slate-500">No linked email events yet.</p>
        ) : (
          <div className="space-y-4">
            {emailEvents.map((email) => (
              <div key={email.id} className="border border-slate-200 rounded-xl p-4">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{email.subject || 'No subject'}</h3>
                    <p className="text-sm text-slate-500">From: {email.sender || 'Unknown sender'}</p>
                  </div>
                  <span className="text-xs text-slate-500">
                    {formatDateTime(email.received_at)}
                  </span>
                </div>

                {email.snippet && <p className="text-sm text-slate-600 mt-3">{email.snippet}</p>}

                {email.detected_status && (
                  <span className="inline-block mt-3 bg-slate-100 text-slate-700 px-2 py-1 rounded-full text-xs">
                    {formatStatus(email.detected_status)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Add Activity" description="Log recruiter replies, follow-ups, calls, notes, or other updates.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <input value={activityTitle} onChange={(e) => setActivityTitle(e.target.value)} placeholder="Activity title e.g. Sent follow-up email" className={inputCls} />

          <select value={activityType} onChange={(e) => setActivityType(e.target.value)} className={inputCls}>
            <option value="note">Note</option>
            <option value="follow_up">Follow-up</option>
            <option value="recruiter_reply">Recruiter Reply</option>
            <option value="phone_call">Phone Call</option>
            <option value="email_sent">Email Sent</option>
            <option value="assessment">Assessment</option>
            <option value="interview">Interview</option>
          </select>
        </div>

        <textarea value={activityDescription} onChange={(e) => setActivityDescription(e.target.value)} placeholder="Details..." className={`${inputCls} min-h-24`} />

        <div className="flex justify-end mt-4">
          <button onClick={handleAddActivity} disabled={savingActivity || !activityTitle.trim()} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 inline-flex items-center gap-2">
            <MessageSquarePlus size={15} />
            {savingActivity ? 'Saving...' : 'Add Activity'}
          </button>
        </div>
      </Section>

      <Section title="Application Timeline">
        {events.length === 0 ? (
          <p className="text-slate-500">No timeline events yet.</p>
        ) : (
          <div className="space-y-4">
            {events.map((event) => (
              <div key={event.id} className="border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between gap-4 mb-2">
                  <h3 className="font-semibold">{event.title}</h3>
                  <span className="text-sm text-slate-500">
                    {formatDateTime(event.event_date)}
                  </span>
                </div>

                {event.description && (
                  <p className="text-slate-600 text-sm">{event.description}</p>
                )}

                <span className="inline-block mt-3 bg-slate-100 text-slate-500 px-2 py-1 rounded-full text-xs">
                  {formatStatus(event.event_type)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {shareModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="text-xl font-bold">Share Opportunity</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Share a safe snapshot of this role with another JTracker user.
                </p>
              </div>

              <button
                onClick={() => setShareModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <Field label="Recipient Email">
                <input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="friend@example.com"
                  className={inputCls}
                />
              </Field>

              <Field label="Optional Message">
                <textarea
                  value={shareNote}
                  onChange={(e) => setShareNote(e.target.value)}
                  placeholder="Thought this role might interest you..."
                  className={`${inputCls} min-h-24`}
                />
              </Field>

              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                <p className="text-sm font-semibold mb-3">Privacy Options</p>

                <div className="space-y-2 text-sm text-slate-700">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={includeStatus}
                      onChange={(e) => setIncludeStatus(e.target.checked)}
                    />
                    Include application status
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={includeNotes}
                      onChange={(e) => setIncludeNotes(e.target.checked)}
                    />
                    Include private notes
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={includeExperience}
                      onChange={(e) => setIncludeExperience(e.target.checked)}
                    />
                    Include shared experience note
                  </label>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-xs text-slate-500 mb-1">Preview</p>
                <p className="font-semibold">{application.role_title}</p>
                <p className="text-sm text-slate-600">
                  {application.companies?.name || 'Unknown Company'}
                  {application.location ? ` — ${application.location}` : ''}
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShareModalOpen(false)}
                  className="border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm"
                >
                  Cancel
                </button>

                <button
                  onClick={handleShareOpportunity}
                  disabled={sharing}
                  className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                >
                  {sharing ? 'Sharing...' : 'Share Opportunity'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const AlertBox = ({
  type,
  message,
  onClose,
}: {
  type: 'error' | 'success';
  message: string;
  onClose: () => void;
}) => (
  <div
    className={`rounded-xl p-4 mb-6 flex items-start gap-3 border ${
      type === 'error'
        ? 'bg-red-50 border-red-200 text-red-700'
        : 'bg-emerald-50 border-emerald-200 text-emerald-700'
    }`}
  >
    {type === 'error' ? (
      <AlertCircle size={16} className="shrink-0 mt-0.5" />
    ) : (
      <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
    )}

    <span className="text-sm flex-1">{message}</span>

    <button onClick={onClose} className="opacity-70 hover:opacity-100">
      <X size={16} />
    </button>
  </div>
);

const InfoCard = ({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) => (
  <div className="border border-slate-200 rounded-xl p-4">
    <div className="flex items-center gap-2 text-slate-500 mb-2">
      {icon}
      <span className="text-sm">{label}</span>
    </div>
    <p className="font-medium break-words">{value}</p>
  </div>
);

const LifecycleItem = ({
  label,
  value,
  complete,
}: {
  label: string;
  value: string;
  complete: boolean;
}) => (
  <div className="bg-white border border-slate-200 rounded-xl p-3">
    <div className="flex items-center gap-2 mb-1">
      <span
        className={`w-2.5 h-2.5 rounded-full ${
          complete ? 'bg-slate-900' : 'bg-slate-300'
        }`}
      />
      <p className="text-xs text-slate-500">{label}</p>
    </div>
    <p className="text-sm font-medium text-slate-700">{value}</p>
  </div>
);

const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label className="block">
    <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
      {label}
    </span>
    {children}
  </label>
);

const Section = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 mb-6">
    <h2 className="text-xl font-semibold mb-2">{title}</h2>
    {description && <p className="text-slate-500 mb-6">{description}</p>}
    {children}
  </div>
);

const ApplicationDetailsSkeleton = () => (
  <div>
    <div className="h-5 w-40 bg-slate-100 rounded-lg animate-pulse mb-6" />
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 mb-6">
      <div className="h-8 w-72 bg-slate-200 rounded-lg animate-pulse mb-3" />
      <div className="h-4 w-48 bg-slate-100 rounded-lg animate-pulse mb-6" />
      <div className="h-8 w-28 bg-slate-100 rounded-full animate-pulse mb-8" />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-24 bg-slate-100 rounded-xl animate-pulse" />
        ))}
      </div>
    </div>

    <div className="h-64 bg-white border border-slate-200 rounded-2xl animate-pulse" />
  </div>
);