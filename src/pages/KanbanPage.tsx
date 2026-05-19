import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  Briefcase,
  ExternalLink,
  GripVertical,
  Layers3,
  RefreshCw,
  X,
} from 'lucide-react';

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';

import type { DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface CompanySummary {
  name: string;
}

interface RawKanbanApplication {
  id: string;
  role_title: string;
  status: string;
  source: string | null;
  date_applied: string | null;
  application_link: string | null;
  companies?: CompanySummary | CompanySummary[] | null;
}

interface KanbanApplication {
  id: string;
  role_title: string;
  status: string;
  source: string | null;
  date_applied: string | null;
  application_link: string | null;
  companies?: CompanySummary | null;
}

const firstOrNull = <T,>(value: T | T[] | null | undefined): T | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

const columns = [
  { status: 'wishlist', label: 'Wishlist' },
  { status: 'applied', label: 'Applied' },
  { status: 'confirmation_received', label: 'Confirmed' },
  { status: 'assessment', label: 'Assessment' },
  { status: 'interview', label: 'Interview' },
  { status: 'final_interview', label: 'Final Interview' },
  { status: 'offer', label: 'Offer' },
  { status: 'rejected', label: 'Rejected' },
];

export const KanbanPage: React.FC = () => {
  const { user } = useAuth();

  const [applications, setApplications] = useState<KanbanApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [updatingId, setUpdatingId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const fetchApplications = async () => {
    if (!user) {
      setApplications([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    const { data, error } = await supabase
      .from('applications')
      .select(`
        id,
        role_title,
        status,
        source,
        date_applied,
        application_link,
        companies (
          name
        )
      `)
      .eq('user_id', user.id)
      .eq('archived', false)
      .order('created_at', { ascending: false });

    if (error) {
      setError(error.message);
      setApplications([]);
    } else {
      const normalized = ((data || []) as RawKanbanApplication[]).map((app) => ({
        ...app,
        companies: firstOrNull(app.companies),
      }));

      setApplications(normalized);
    }

    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchApplications();
    setRefreshing(false);
  };

  useEffect(() => {
    fetchApplications();
  }, [user]);

  const groupedApplications = useMemo(() => {
    return columns.map((column) => ({
      ...column,
      applications: applications.filter((app) => app.status === column.status),
    }));
  }, [applications]);

  const totalApplications = applications.length;

  const updateApplicationStatus = async (
    application: KanbanApplication,
    newStatus: string
  ) => {
    if (!user || application.status === newStatus) return;

    setUpdatingId(application.id);
    setError('');
    setMessage('');

    const oldStatus = application.status;

    setApplications((prev) =>
      prev.map((app) =>
        app.id === application.id ? { ...app, status: newStatus } : app
      )
    );

    const { error: updateError } = await supabase
      .from('applications')
      .update({ status: newStatus })
      .eq('id', application.id)
      .eq('user_id', user.id);

    if (updateError) {
      setError(updateError.message);
      await fetchApplications();
      setUpdatingId('');
      return;
    }

    const { error: eventError } = await supabase
      .from('application_events')
      .insert({
        user_id: user.id,
        application_id: application.id,
        event_type: 'kanban_status_changed',
        title: 'Pipeline status updated',
        description: `Moved from ${oldStatus.replaceAll(
          '_',
          ' '
        )} to ${newStatus.replaceAll('_', ' ')}.`,
      });

    if (eventError) {
      setError(eventError.message);
    } else {
      setMessage('Application moved successfully.');
    }

    setUpdatingId('');
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) return;

    const applicationId = String(active.id);
    const newStatus = String(over.id);

    const application = applications.find((app) => app.id === applicationId);

    if (!application) return;

    updateApplicationStatus(application, newStatus);
  };

  if (loading) {
    return <KanbanSkeleton />;
  }

  return (
    <div className="w-full max-w-full overflow-hidden">
      <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6 mb-8">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <Layers3 size={30} className="text-slate-700 shrink-0" />

            <h2 className="text-2xl sm:text-3xl font-bold break-words">
              Application Pipeline
            </h2>
          </div>

          <p className="text-slate-500 text-sm sm:text-base max-w-2xl break-words">
            Drag applications through your hiring pipeline and visually track
            your job-search progress.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 w-full xl:w-auto xl:min-w-[240px]">
          <p className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
            Active Applications
          </p>

          <p className="text-3xl font-bold mt-2">{totalApplications}</p>

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="mt-4 w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            <RefreshCw
              size={15}
              className={refreshing ? 'animate-spin' : ''}
            />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <AlertBox
          type="error"
          message={error}
          onClose={() => setError('')}
        />
      )}

      {message && (
        <AlertBox
          type="success"
          message={message}
          onClose={() => setMessage('')}
        />
      )}

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-4 min-w-max">
            {groupedApplications.map((column) => (
              <KanbanColumn
                key={column.status}
                id={column.status}
                label={column.label}
                applications={column.applications}
                updatingId={updatingId}
              />
            ))}
          </div>
        </div>
      </DndContext>
    </div>
  );
};

interface KanbanColumnProps {
  id: string;
  label: string;
  applications: KanbanApplication[];
  updatingId: string;
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({
  id,
  label,
  applications,
  updatingId,
}) => {
  return (
    <DroppableColumn id={id}>
      <div className="w-[300px] sm:w-[320px] bg-slate-50 border border-slate-200 rounded-2xl p-4 min-h-[500px] overflow-hidden">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="font-semibold break-words">{label}</h3>

          <span className="bg-white border border-slate-200 text-slate-600 text-xs px-2 py-1 rounded-full shrink-0">
            {applications.length}
          </span>
        </div>

        <div className="space-y-3">
          {applications.length === 0 ? (
            <div className="border border-dashed border-slate-300 rounded-xl p-4 text-sm text-slate-400 text-center">
              Drop applications here
            </div>
          ) : (
            applications.map((application) => (
              <DraggableApplicationCard
                key={application.id}
                application={application}
                updating={updatingId === application.id}
              />
            ))
          )}
        </div>
      </div>
    </DroppableColumn>
  );
};

interface DroppableColumnProps {
  id: string;
  children: React.ReactNode;
}

const DroppableColumn: React.FC<DroppableColumnProps> = ({
  id,
  children,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id,
  });

  return (
    <div
      ref={setNodeRef}
      className={isOver ? 'ring-2 ring-slate-400 rounded-2xl' : ''}
    >
      {children}
    </div>
  );
};

interface DraggableApplicationCardProps {
  application: KanbanApplication;
  updating: boolean;
}

const DraggableApplicationCard: React.FC<DraggableApplicationCardProps> = ({
  application,
  updating,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: application.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`bg-white border border-slate-200 rounded-xl p-4 shadow-sm cursor-grab active:cursor-grabbing overflow-hidden ${
        updating ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold mb-1 break-words">
            {application.role_title}
          </h4>

          <p className="text-sm text-slate-500 break-words">
            {application.companies?.name || 'Unknown Company'}
          </p>
        </div>

        <GripVertical
          size={18}
          className="text-slate-400 shrink-0 mt-1"
        />
      </div>

      <div className="flex flex-wrap gap-2 mt-4">
        {application.source && (
          <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-full text-xs break-words">
            {application.source}
          </span>
        )}

        {application.date_applied && (
          <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-full text-xs break-words">
            {application.date_applied}
          </span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-5 text-sm">
        <Link
          to={`/applications/${application.id}`}
          className="w-full sm:w-auto text-center sm:text-left text-slate-900 underline"
          onPointerDown={(e) => e.stopPropagation()}
        >
          View
        </Link>

        {application.application_link && (
          <a
            href={application.application_link}
            target="_blank"
            rel="noreferrer"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-1 text-slate-500 hover:text-slate-900"
            onPointerDown={(e) => e.stopPropagation()}
          >
            Job
            <ExternalLink size={14} />
          </a>
        )}
      </div>
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
      <Briefcase size={16} className="shrink-0 mt-0.5" />
    )}

    <span className="text-sm flex-1 break-words">{message}</span>

    <button
      onClick={onClose}
      className="opacity-70 hover:opacity-100 shrink-0"
    >
      <X size={16} />
    </button>
  </div>
);

const KanbanSkeleton = () => (
  <div className="w-full max-w-full overflow-hidden">
    <div className="mb-8">
      <div className="h-8 w-64 bg-slate-200 rounded-lg animate-pulse mb-2" />
      <div className="h-4 w-full max-w-96 bg-slate-100 rounded-lg animate-pulse" />
    </div>

    <div className="overflow-x-auto">
      <div className="flex gap-4 min-w-max">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="w-[320px] h-[600px] bg-white border border-slate-200 rounded-2xl animate-pulse"
          />
        ))}
      </div>
    </div>
  </div>
);