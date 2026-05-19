import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  Copy,
  ExternalLink,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

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
  id: string;
  name: string;
}

interface CVVersionJoin {
  id: string;
  name: string;
}

interface RecruiterJoin {
  id: string;
  name: string;
  email: string | null;
}

interface RawApplication {
  id: string;
  user_id: string;
  company_id: string | null;
  cv_version_id: string | null;
  recruiter_id: string | null;
  role_title: string;
  application_link: string | null;
  source: string | null;
  status: ApplicationStatus;
  date_applied: string | null;
  email_used: string | null;
  referral: boolean | null;
  location: string | null;
  job_type: string | null;
  salary_range: string | null;
  notes: string | null;
  archived: boolean | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string | null;
  response_received_at?: string | null;
  assessment_received_at?: string | null;
  interview_started_at?: string | null;
  final_interview_started_at?: string | null;
  offer_received_at?: string | null;
  rejected_at?: string | null;
  withdrawn_at?: string | null;
  ghosted_at?: string | null;
  last_status_changed_at?: string | null;
  follow_up_date?: string | null;
  priority?: string | null;
  companies?: CompanyJoin | CompanyJoin[] | null;
  cv_versions?: CVVersionJoin | CVVersionJoin[] | null;
  recruiters?: RecruiterJoin | RecruiterJoin[] | null;
}

interface Application extends Omit<RawApplication, 'companies' | 'cv_versions' | 'recruiters'> {
  companies: CompanyJoin | null;
  cv_versions: CVVersionJoin | null;
  recruiters: RecruiterJoin | null;
}

const firstOrNull = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const statusOptions: { value: ApplicationStatus; label: string }[] = [
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

const statusStyle: Record<ApplicationStatus, string> = {
  wishlist: 'bg-slate-100 text-slate-700',
  applied: 'bg-blue-50 text-blue-700',
  confirmation_received: 'bg-cyan-50 text-cyan-700',
  assessment: 'bg-violet-50 text-violet-700',
  interview: 'bg-indigo-50 text-indigo-700',
  final_interview: 'bg-purple-50 text-purple-700',
  offer: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-red-50 text-red-700',
  withdrawn: 'bg-slate-100 text-slate-600',
  ghosted: 'bg-amber-50 text-amber-700',
  archived: 'bg-zinc-100 text-zinc-600',
};

const inputCls =
  'border border-slate-200 rounded-lg px-3 py-2 text-sm w-full bg-white focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition';

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

export const ApplicationsPage: React.FC = () => {
  const { user } = useAuth();

  const [applications, setApplications] = useState<Application[]>([]);
  const [cvVersions, setCvVersions] = useState<CVVersionJoin[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ApplicationStatus>('all');

  const [roleTitle, setRoleTitle] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [selectedCvId, setSelectedCvId] = useState('');
  const [status, setStatus] = useState<ApplicationStatus>('applied');
  const [source, setSource] = useState('');
  const [applicationLink, setApplicationLink] = useState('');
  const [dateApplied, setDateApplied] = useState('');
  const [location, setLocation] = useState('');
  const [jobType, setJobType] = useState('');
  const [salaryRange, setSalaryRange] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('medium');
  const [followUpDate, setFollowUpDate] = useState('');

  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [selectedShareApp, setSelectedShareApp] = useState<Application | null>(null);
  const [shareTab, setShareTab] = useState<'internal' | 'public' | 'whatsapp'>('internal');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [sharing, setSharing] = useState(false);
  const [publicShareLink, setPublicShareLink] = useState('');
  const [includeStatus, setIncludeStatus] = useState(false);
  const [includeNotes, setIncludeNotes] = useState(false);

  const fetchApplications = async () => {
    if (!user) return;

    setError('');

    const { data, error } = await supabase
      .from('applications')
      .select(`
        *,
        companies (
          id,
          name
        ),
        cv_versions (
          id,
          name
        ),
        recruiters (
          id,
          name,
          email
        )
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      setError(error.message);
      return;
    }

    const normalized: Application[] = ((data || []) as RawApplication[]).map((app) => ({
      ...app,
      companies: firstOrNull(app.companies),
      cv_versions: firstOrNull(app.cv_versions),
      recruiters: firstOrNull(app.recruiters),
    }));

    setApplications(normalized);
  };

  const fetchCVVersions = async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from('cv_versions')
      .select('id, name')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error) setCvVersions(data || []);
  };

  const loadPage = async () => {
    setLoading(true);
    await Promise.all([fetchApplications(), fetchCVVersions()]);
    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchApplications(), fetchCVVersions()]);
    setRefreshing(false);
  };

  useEffect(() => {
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const filteredApplications = useMemo(() => {
    return applications.filter((app) => {
      const term = search.toLowerCase();

      const matchesSearch =
        !search.trim() ||
        app.role_title.toLowerCase().includes(term) ||
        app.companies?.name.toLowerCase().includes(term) ||
        app.source?.toLowerCase().includes(term);

      const matchesStatus = statusFilter === 'all' || app.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [applications, search, statusFilter]);

  const getLifecycleUpdate = (newStatus: ApplicationStatus, app: Application) => {
    const now = new Date().toISOString();

    const update: Record<string, string | boolean | null> = {
      status: newStatus,
      last_status_changed_at: now,
    };

    if (newStatus === 'archived') {
      update.archived = true;
      update.archived_at = now;
    }

    if (newStatus !== 'archived' && app.archived) {
      update.archived = false;
      update.archived_at = null;
    }

    if (newStatus === 'confirmation_received' && !app.response_received_at) {
      update.response_received_at = now;
    }

    if (newStatus === 'assessment' && !app.assessment_received_at) {
      update.assessment_received_at = now;
      if (!app.response_received_at) update.response_received_at = now;
    }

    if (newStatus === 'interview' && !app.interview_started_at) {
      update.interview_started_at = now;
      if (!app.response_received_at) update.response_received_at = now;
    }

    if (newStatus === 'final_interview' && !app.final_interview_started_at) {
      update.final_interview_started_at = now;
      if (!app.interview_started_at) update.interview_started_at = now;
      if (!app.response_received_at) update.response_received_at = now;
    }

    if (newStatus === 'offer' && !app.offer_received_at) {
      update.offer_received_at = now;
      if (!app.response_received_at) update.response_received_at = now;
    }

    if (newStatus === 'rejected' && !app.rejected_at) {
      update.rejected_at = now;
      if (!app.response_received_at) update.response_received_at = now;
    }

    if (newStatus === 'withdrawn' && !app.withdrawn_at) {
      update.withdrawn_at = now;
    }

    if (newStatus === 'ghosted' && !app.ghosted_at) {
      update.ghosted_at = now;
      if (!app.response_received_at) update.response_received_at = now;
    }

    return update;
  };

  const handleStatusChange = async (applicationId: string, newStatus: ApplicationStatus) => {
    if (!user) return;

    const application = applications.find((app) => app.id === applicationId);
    if (!application || application.status === newStatus) return;

    setStatusUpdatingId(applicationId);
    setError('');
    setMessage('');

    const updatePayload = getLifecycleUpdate(newStatus, application);

    const { error } = await supabase
      .from('applications')
      .update(updatePayload)
      .eq('id', applicationId)
      .eq('user_id', user.id);

    if (error) {
      setError(error.message);
      setStatusUpdatingId(null);
      return;
    }

    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: applicationId,
      event_type: 'status_change',
      title: `Status changed to ${formatStatus(newStatus)}`,
      description: `Application moved from ${formatStatus(application.status)} to ${formatStatus(
        newStatus
      )}.`,
      event_date: new Date().toISOString(),
    });

    setApplications((prev) =>
      prev.map((app) => (app.id === applicationId ? { ...app, ...updatePayload } : app))
    );

    setMessage(`Status updated to ${formatStatus(newStatus)}.`);
    setStatusUpdatingId(null);
  };

  const handleDeleteApplication = async (applicationId: string) => {
    if (!user) return;

    const application = applications.find((app) => app.id === applicationId);

    const confirmed = window.confirm(
      `Delete "${application?.role_title || 'this application'}"? This cannot be undone.`
    );

    if (!confirmed) return;

    setError('');
    setMessage('');

    const { error } = await supabase
      .from('applications')
      .delete()
      .eq('id', applicationId)
      .eq('user_id', user.id);

    if (error) {
      setError(error.message);
      return;
    }

    setApplications((prev) => prev.filter((app) => app.id !== applicationId));
    setMessage('Application deleted successfully.');
  };

  const openShareModal = (
    app: Application,
    tab: 'internal' | 'public' | 'whatsapp' = 'internal'
  ) => {
    setSelectedShareApp(app);
    setShareTab(tab);
    setRecipientEmail('');
    setShareNote('');
    setPublicShareLink('');
    setIncludeStatus(false);
    setIncludeNotes(false);
    setError('');
    setMessage('');
    setShareModalOpen(true);
  };

  const buildShareSummary = (app: Application, link?: string) => {
    return `🚀 Opportunity Shared via JTracker

${app.role_title}
${app.companies?.name || 'Unknown Company'}${app.location ? ` — ${app.location}` : ''}

Application Link:
${app.application_link || link || 'No job link provided'}

${shareNote || 'Thought this role might interest you.'}`;
  };

  const createShareSnapshot = async (
    app: Application,
    recipientUserId: string | null = null
  ): Promise<{ id: string; publicShareId: string }> => {
    if (!user) throw new Error('You must be logged in to share.');

    const publicShareId = crypto.randomUUID();

    const { data, error } = await supabase
      .from('shared_opportunities')
      .insert({
        sender_user_id: user.id,
        recipient_user_id: recipientUserId,
        application_id: app.id,
        public_share_id: publicShareId,
        role_title: app.role_title,
        company_name: app.companies?.name || null,
        location: app.location || null,
        job_link: app.application_link || null,
        note: shareNote || null,
        include_status: includeStatus,
        include_notes: includeNotes,
        include_experience: false,
        status_snapshot: includeStatus ? app.status : null,
        notes_snapshot: includeNotes ? app.notes : null,
        experience_snapshot: null,
      })
      .select('id, public_share_id')
      .single();

    if (error) throw new Error(error.message);
    if (!data) throw new Error('Failed to create shared opportunity.');

    await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: app.id,
      event_type: recipientUserId
        ? 'opportunity_shared_internal'
        : 'opportunity_shared_public',
      title: recipientUserId ? 'Opportunity shared internally' : 'Public share link created',
      description: recipientUserId
        ? `Shared with ${recipientEmail.trim()}.`
        : 'A public share link was generated.',
      event_date: new Date().toISOString(),
    });

    return {
      id: data.id,
      publicShareId: data.public_share_id || publicShareId,
    };
  };

  const handleInternalShare = async () => {
    if (!selectedShareApp || !user) return;

    if (!recipientEmail.trim()) {
      setError('Please enter the recipient email.');
      return;
    }

    setSharing(true);
    setError('');
    setMessage('');

    try {
      const cleanEmail = recipientEmail.trim().toLowerCase();

      const { data: profiles, error: recipientError } = await supabase
        .from('profiles')
        .select('id, email')
        .ilike('email', cleanEmail);

      if (recipientError) throw new Error(recipientError.message);

      const recipientProfile = profiles?.[0];

      if (!recipientProfile) throw new Error('No JTracker user found with that email.');
      if (recipientProfile.id === user.id) throw new Error('You cannot share an opportunity with yourself.');

      const sharedOpportunity = await createShareSnapshot(selectedShareApp, recipientProfile.id);

      const { error: notificationError } = await supabase.from('notifications').insert({
        user_id: recipientProfile.id,
        actor_user_id: user.id,
        type: 'shared_opportunity',
        title: 'New shared opportunity',
        message: `${user.email || 'Someone'} shared ${selectedShareApp.role_title} with you.`,
        related_shared_opportunity_id: sharedOpportunity.id,
        read: false,
      });

      if (notificationError) throw new Error(notificationError.message);

      setMessage('Opportunity shared successfully.');
      setShareModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to share opportunity.');
    }

    setSharing(false);
  };

  const handleGeneratePublicLink = async () => {
    if (!selectedShareApp) return;

    setSharing(true);
    setError('');
    setMessage('');

    try {
      const sharedOpportunity = await createShareSnapshot(selectedShareApp, null);
      const link = `${window.location.origin}/share/${sharedOpportunity.publicShareId}`;

      setPublicShareLink(link);
      await navigator.clipboard.writeText(link);
      setMessage('Public share link generated and copied.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate public link.');
    }

    setSharing(false);
  };

  const handleCopySummary = async () => {
    if (!selectedShareApp) return;

    const summary = buildShareSummary(selectedShareApp, publicShareLink);
    await navigator.clipboard.writeText(summary.trim());
    setMessage('Share summary copied.');
  };

  const handleWhatsAppShare = async () => {
    if (!selectedShareApp) return;

    setSharing(true);
    setError('');

    try {
      let link = publicShareLink;

      if (!link) {
        const sharedOpportunity = await createShareSnapshot(selectedShareApp, null);
        link = `${window.location.origin}/share/${sharedOpportunity.publicShareId}`;
        setPublicShareLink(link);
      }

      const text = buildShareSummary(selectedShareApp, link);
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open WhatsApp share.');
    }

    setSharing(false);
  };

  const getOrCreateCompanyId = async (): Promise<string | null> => {
    if (!user || !companyName.trim()) return null;

    const cleanName = companyName.trim();

    const { data: existingCompany, error: findError } = await supabase
      .from('companies')
      .select('id')
      .eq('user_id', user.id)
      .ilike('name', cleanName)
      .maybeSingle();

    if (findError) throw new Error(findError.message);
    if (existingCompany) return existingCompany.id;

    const { data: newCompany, error: companyError } = await supabase
      .from('companies')
      .insert({ user_id: user.id, name: cleanName })
      .select('id')
      .single();

    if (companyError) throw new Error(companyError.message);

    return newCompany.id;
  };

  const handleCreateApplication = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user || !roleTitle.trim()) return;

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const companyId = await getOrCreateCompanyId();
      const now = new Date().toISOString();
      const lifecyclePayload = getInitialLifecyclePayload(status, now);

      const { data: insertedApplication, error } = await supabase
        .from('applications')
        .insert({
          user_id: user.id,
          company_id: companyId,
          cv_version_id: selectedCvId || null,
          role_title: roleTitle.trim(),
          source: source || null,
          application_link: applicationLink.trim() || null,
          date_applied: dateApplied || new Date().toISOString().slice(0, 10),
          location: location.trim() || null,
          job_type: jobType || null,
          salary_range: salaryRange.trim() || null,
          notes: notes.trim() || null,
          priority: priority || 'medium',
          follow_up_date: followUpDate ? new Date(followUpDate).toISOString() : null,
          status,
          last_status_changed_at: now,
          ...lifecyclePayload,
        })
        .select('id')
        .single();

      if (error) {
        setError(error.message);
        setSaving(false);
        return;
      }

      if (insertedApplication?.id) {
        await supabase.from('application_events').insert({
          user_id: user.id,
          application_id: insertedApplication.id,
          event_type: 'created',
          title: 'Application created',
          description: `Application added with status ${formatStatus(status)}.`,
          event_date: now,
        });
      }

      resetForm();
      setShowForm(false);
      await fetchApplications();

      setMessage('Application created successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create application.');
    }

    setSaving(false);
  };

  const resetForm = () => {
    setRoleTitle('');
    setCompanyName('');
    setSelectedCvId('');
    setStatus('applied');
    setSource('');
    setApplicationLink('');
    setDateApplied('');
    setLocation('');
    setJobType('');
    setSalaryRange('');
    setNotes('');
    setPriority('medium');
    setFollowUpDate('');
  };

  if (loading) return <ApplicationsSkeleton />;

  return (
    <div className="w-full max-w-full overflow-hidden">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold mb-1">Applications</h2>
          <p className="text-slate-500 text-sm sm:text-base">
            Track applications, CV versions, lifecycle dates, and job-search progress.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:flex-wrap w-full sm:w-auto gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="w-full sm:w-auto border border-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>

          <button
            type="button"
            onClick={() => {
              setShowForm((prev) => !prev);
              setError('');
              setMessage('');
            }}
            className="w-full sm:w-auto bg-slate-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-slate-700 transition inline-flex items-center justify-center gap-2"
          >
            {showForm ? <X size={15} /> : <Plus size={15} />}
            {showForm ? 'Close' : 'Add Application'}
          </button>
        </div>
      </div>

      {error && <AlertBox type="error" message={error} onClose={() => setError('')} />}
      {message && <AlertBox type="success" message={message} onClose={() => setMessage('')} />}

      {showForm && (
        <form
          onSubmit={handleCreateApplication}
          className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 mb-8 overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
            <div>
              <h3 className="text-lg font-semibold mb-1">Quick Add Application</h3>
              <p className="text-sm text-slate-500">
                Add the role fast. Attach the CV now so analytics stay accurate.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="self-start text-slate-400 hover:text-slate-700"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <Field label="Role Title *">
              <input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} className={inputCls} placeholder="Junior Software Engineer" required autoFocus />
            </Field>

            <Field label="Company Name">
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputCls} placeholder="Revolut, Google, Cognizant..." />
            </Field>

            <Field label="CV Version">
              <select value={selectedCvId} onChange={(e) => setSelectedCvId(e.target.value)} className={inputCls}>
                <option value="">No CV selected</option>
                {cvVersions.map((cv) => (
                  <option key={cv.id} value={cv.id}>{cv.name}</option>
                ))}
              </select>
            </Field>

            <Field label="Source">
              <select value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
                <option value="">Select source</option>
                <option value="linkedin">LinkedIn</option>
                <option value="company_website">Company Website</option>
                <option value="indeed">Indeed</option>
                <option value="pracuj">Pracuj.pl</option>
                <option value="referral">Referral</option>
                <option value="recruiter">Recruiter</option>
                <option value="gmail_sync">Gmail Sync</option>
                <option value="other">Other</option>
              </select>
            </Field>

            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus)} className={inputCls}>
                {statusOptions.filter((option) => option.value !== 'archived').map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Date Applied">
              <input type="date" value={dateApplied} onChange={(e) => setDateApplied(e.target.value)} className={inputCls} />
            </Field>

            <Field label="Application Link">
              <input value={applicationLink} onChange={(e) => setApplicationLink(e.target.value)} className={inputCls} placeholder="Paste job link" />
            </Field>
          </div>

          <details className="mt-5">
            <summary className="cursor-pointer text-sm font-medium text-slate-700 hover:text-slate-900">
              Add more details
            </summary>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
              <Field label="Location">
                <input value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls} placeholder="Warsaw, Remote, London..." />
              </Field>

              <Field label="Job Type">
                <select value={jobType} onChange={(e) => setJobType(e.target.value)} className={inputCls}>
                  <option value="">Select job type</option>
                  <option value="Full Time">Full Time</option>
                  <option value="Part Time">Part Time</option>
                  <option value="Internship">Internship</option>
                  <option value="Contract">Contract</option>
                  <option value="Remote">Remote</option>
                  <option value="Hybrid">Hybrid</option>
                </select>
              </Field>

              <Field label="Salary Range">
                <input value={salaryRange} onChange={(e) => setSalaryRange(e.target.value)} className={inputCls} placeholder="8,000–12,000 PLN" />
              </Field>

              <Field label="Priority">
                <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </Field>

              <Field label="Follow-up Date">
                <input type="datetime-local" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} className={inputCls} />
              </Field>
            </div>

            <div className="mt-4">
              <Field label="Notes">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={`${inputCls} resize-y`} placeholder="Extra notes..." />
              </Field>
            </div>
          </details>

          <div className="flex flex-col sm:flex-row sm:justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
              className="w-full sm:w-auto border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className="w-full sm:w-auto bg-slate-900 text-white px-5 py-2 rounded-lg text-sm hover:bg-slate-700 transition disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Add Application'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 mb-6">
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_220px] gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search role, company, or source..." className={`${inputCls} pl-9`} />
          </div>

          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | ApplicationStatus)} className={inputCls}>
            <option value="all">All statuses</option>
            {statusOptions.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </select>
        </div>
      </div>

      {filteredApplications.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-10 text-center">
          <Briefcase size={32} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-lg font-semibold mb-1">No applications found</h3>
          <p className="text-slate-500 text-sm">Add an application or adjust your search/filter.</p>

          <div className="mt-5">
            <button
              onClick={() => setShowForm(true)}
              className="bg-slate-900 text-white px-5 py-2 rounded-lg text-sm hover:bg-slate-700 transition"
            >
              Add Your First Application
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredApplications.map((app) => (
            <ApplicationCard
              key={app.id}
              app={app}
              updating={statusUpdatingId === app.id}
              onStatusChange={handleStatusChange}
              onShare={openShareModal}
              onDelete={handleDeleteApplication}
            />
          ))}
        </div>
      )}

      {shareModalOpen && selectedShareApp && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4 py-6">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="text-xl font-bold">Share Opportunity</h2>
                <p className="text-sm text-slate-500 mt-1">Share a safe snapshot of this role.</p>
              </div>

              <button onClick={() => setShareModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-5">
              {(['internal', 'public', 'whatsapp'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setShareTab(tab)}
                  className={`px-3 py-2 rounded-lg text-sm capitalize ${
                    shareTab === tab ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {tab === 'public' ? 'Public Link' : tab}
                </button>
              ))}
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
              <p className="font-semibold break-words">{selectedShareApp.role_title}</p>
              <p className="text-sm text-slate-600 break-words">
                {selectedShareApp.companies?.name || 'Unknown Company'}
                {selectedShareApp.location ? ` — ${selectedShareApp.location}` : ''}
              </p>
            </div>

            <Field label="Optional Message">
              <textarea value={shareNote} onChange={(e) => setShareNote(e.target.value)} placeholder="Thought this role might interest you..." className={`${inputCls} min-h-24`} />
            </Field>

            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 mt-4">
              <p className="text-sm font-semibold mb-3">Privacy Options</p>

              <div className="space-y-2 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={includeStatus} onChange={(e) => setIncludeStatus(e.target.checked)} />
                  Include application status
                </label>

                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} />
                  Include private notes
                </label>
              </div>
            </div>

            {shareTab === 'internal' && (
              <div className="mt-4">
                <Field label="Recipient Email">
                  <input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="friend@example.com" className={inputCls} />
                </Field>

                <button onClick={handleInternalShare} disabled={sharing} className="mt-4 w-full bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                  {sharing ? 'Sharing...' : 'Share Internally'}
                </button>
              </div>
            )}

            {shareTab === 'public' && (
              <div className="mt-4 space-y-3">
                {publicShareLink && <input value={publicShareLink} readOnly className={inputCls} />}

                <button onClick={handleGeneratePublicLink} disabled={sharing} className="w-full bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                  {sharing ? 'Generating...' : 'Generate & Copy Public Link'}
                </button>

                <button onClick={handleCopySummary} className="w-full border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm inline-flex items-center justify-center gap-2">
                  <Copy size={15} />
                  Copy Summary
                </button>
              </div>
            )}

            {shareTab === 'whatsapp' && (
              <div className="mt-4 space-y-3">
                <button onClick={handleWhatsAppShare} disabled={sharing} className="w-full bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50 inline-flex items-center justify-center gap-2">
                  <MessageCircle size={15} />
                  {sharing ? 'Preparing...' : 'Share on WhatsApp'}
                </button>

                <button onClick={handleCopySummary} className="w-full border border-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm inline-flex items-center justify-center gap-2">
                  <Copy size={15} />
                  Copy WhatsApp Text
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="sm:hidden fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-slate-900 text-white shadow-lg flex items-center justify-center"
          aria-label="Add application"
        >
          <Plus size={22} />
        </button>
      )}
    </div>
  );
};

const getInitialLifecyclePayload = (status: ApplicationStatus, now: string) => {
  const payload: Record<string, string> = {};

  if (status === 'confirmation_received') payload.response_received_at = now;

  if (status === 'assessment') {
    payload.response_received_at = now;
    payload.assessment_received_at = now;
  }

  if (status === 'interview') {
    payload.response_received_at = now;
    payload.interview_started_at = now;
  }

  if (status === 'final_interview') {
    payload.response_received_at = now;
    payload.interview_started_at = now;
    payload.final_interview_started_at = now;
  }

  if (status === 'offer') {
    payload.response_received_at = now;
    payload.offer_received_at = now;
  }

  if (status === 'rejected') {
    payload.response_received_at = now;
    payload.rejected_at = now;
  }

  if (status === 'withdrawn') payload.withdrawn_at = now;

  if (status === 'ghosted') {
    payload.response_received_at = now;
    payload.ghosted_at = now;
  }

  return payload;
};

const ApplicationCard = ({
  app,
  updating,
  onStatusChange,
  onShare,
  onDelete,
}: {
  app: Application;
  updating: boolean;
  onStatusChange: (applicationId: string, status: ApplicationStatus) => void;
  onShare: (app: Application, tab?: 'internal' | 'public' | 'whatsapp') => void;
  onDelete: (applicationId: string) => void;
}) => {
  const [showLifecycle, setShowLifecycle] = useState(false);
  const companyName = app.companies?.name || 'No company linked';

  const lifecycleSteps = [
    { label: 'Applied', date: app.date_applied || app.created_at },
    { label: 'Response', date: app.response_received_at },
    { label: 'Assessment', date: app.assessment_received_at },
    { label: 'Interview', date: app.interview_started_at },
    { label: 'Final', date: app.final_interview_started_at },
    { label: 'Offer', date: app.offer_received_at },
    { label: 'Rejected', date: app.rejected_at },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-5 hover:shadow-md transition overflow-hidden">
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
            <Briefcase size={18} className="text-slate-600" />
          </div>

          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-950 break-words">{app.role_title}</h3>

            <p className="text-sm text-slate-500 mt-0.5 break-words">
              {companyName}
              {app.location ? ` · ${app.location}` : ''}
            </p>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle[app.status]}`}>
                {formatStatus(app.status)}
              </span>

              {app.priority && <Badge>Priority: {formatStatus(app.priority)}</Badge>}
              {app.source && <Badge>{formatStatus(app.source)}</Badge>}
              {app.job_type && <Badge>{app.job_type}</Badge>}
              {app.cv_versions?.name && <Badge>CV: {app.cv_versions.name}</Badge>}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 w-full xl:min-w-[360px] xl:justify-end">
          <select
            value={app.status}
            disabled={updating}
            onChange={(e) => onStatusChange(app.id, e.target.value as ApplicationStatus)}
            className="w-full sm:w-auto border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 transition"
          >
            {statusOptions.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </select>

          <button onClick={() => onShare(app)} className="w-full sm:w-auto border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 transition inline-flex items-center justify-center gap-1.5">
            <Share2 size={14} />
            Share
          </button>

          {app.application_link && (
            <a href={app.application_link} target="_blank" rel="noreferrer" className="w-full sm:w-auto border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 transition inline-flex items-center justify-center gap-1.5">
              <ExternalLink size={14} />
              Open Role
            </a>
          )}

          <button onClick={() => onDelete(app.id)} className="w-full sm:w-auto border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 transition inline-flex items-center justify-center gap-1.5">
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <CompactMeta label="Applied" value={formatDate(app.date_applied)} />
        <CompactMeta label="Follow-up" value={formatDate(app.follow_up_date)} />
        <CompactMeta label="Last update" value={formatDate(app.last_status_changed_at)} />
        <CompactMeta label="Recruiter" value={app.recruiters?.name || 'None'} />
      </div>

      <div className="mt-5 border border-slate-200 rounded-xl bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <CalendarDays size={15} className="text-slate-500" />
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Lifecycle</p>
          </div>

          <button type="button" onClick={() => setShowLifecycle((prev) => !prev)} className="text-xs font-medium text-slate-600 hover:text-slate-900">
            {showLifecycle ? 'Hide details' : 'View details'}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          {lifecycleSteps.map((step) => {
            const complete = Boolean(step.date);

            return (
              <div key={step.label}>
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${complete ? 'bg-slate-900' : 'bg-slate-300'}`} />
                  <span className={`text-xs font-medium ${complete ? 'text-slate-800' : 'text-slate-400'}`}>
                    {step.label}
                  </span>
                </div>

                <p className="text-xs text-slate-500 mt-1 ml-4">{complete ? formatDate(step.date) : '—'}</p>
              </div>
            );
          })}
        </div>

        {showLifecycle && (
          <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            <CompactMeta label="Assessment" value={formatDate(app.assessment_received_at)} />
            <CompactMeta label="Final Interview" value={formatDate(app.final_interview_started_at)} />
            <CompactMeta label="Offer" value={formatDate(app.offer_received_at)} />
            <CompactMeta label="Rejected" value={formatDate(app.rejected_at)} />
            <CompactMeta label="Withdrawn" value={formatDate(app.withdrawn_at)} />
            <CompactMeta label="Ghosted" value={formatDate(app.ghosted_at)} />
            <CompactMeta label="Salary" value={app.salary_range || 'Not set'} />
            <CompactMeta label="CV Version" value={app.cv_versions?.name || 'No CV selected'} />
          </div>
        )}
      </div>

      {app.notes && (
        <div className="mt-5 bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-600 whitespace-pre-wrap leading-relaxed break-words">
          {app.notes}
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
    {type === 'error' ? <AlertCircle size={16} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={16} className="shrink-0 mt-0.5" />}
    <span className="text-sm flex-1 break-words">{message}</span>
    <button onClick={onClose} className="opacity-70 hover:opacity-100">
      <X size={16} />
    </button>
  </div>
);

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
      {label}
    </span>
    {children}
  </label>
);

const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-600 px-2.5 py-1 text-xs font-medium">
    {children}
  </span>
);

const CompactMeta = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 min-w-0">
    <p className="text-[11px] text-slate-400">{label}</p>
    <p className="text-sm font-medium text-slate-700 break-words">{value}</p>
  </div>
);

const ApplicationsSkeleton = () => (
  <div className="w-full max-w-full overflow-hidden">
    <div className="mb-8">
      <div className="h-8 w-52 bg-slate-200 rounded-lg animate-pulse mb-2" />
      <div className="h-4 w-full max-w-96 bg-slate-100 rounded-lg animate-pulse" />
    </div>

    <div className="h-16 bg-white border border-slate-200 rounded-2xl animate-pulse mb-6" />

    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-64 bg-white border border-slate-200 rounded-2xl animate-pulse" />
      ))}
    </div>
  </div>
);