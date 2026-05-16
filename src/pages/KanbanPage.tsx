import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
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
  const [updatingId, setUpdatingId] = useState('');
  const [error, setError] = useState('');

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

  useEffect(() => {
    fetchApplications();
  }, [user]);

  const groupedApplications = useMemo(() => {
    return columns.map((column) => ({
      ...column,
      applications: applications.filter((app) => app.status === column.status),
    }));
  }, [applications]);

  const updateApplicationStatus = async (
    application: KanbanApplication,
    newStatus: string
  ) => {
    if (!user || application.status === newStatus) return;

    setUpdatingId(application.id);
    setError('');

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

    const { error: eventError } = await supabase.from('application_events').insert({
      user_id: user.id,
      application_id: application.id,
      event_type: 'kanban_status_changed',
      title: 'Pipeline status updated',
      description: `Moved from ${oldStatus.replaceAll('_', ' ')} to ${newStatus.replaceAll(
        '_',
        ' '
      )}.`,
    });

    if (eventError) {
      setError(eventError.message);
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
    return <p className="text-slate-500">Loading pipeline...</p>;
  }

  return (
    <div>
      <h2 className="text-3xl font-bold mb-2">Application Pipeline</h2>

      <p className="text-slate-500 mb-8">
        Drag applications through your job search pipeline.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6">
          {error}
        </div>
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
      <div className="w-80 bg-slate-50 border border-slate-200 rounded-2xl p-4 min-h-[500px]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">{label}</h3>

          <span className="bg-white border border-slate-200 text-slate-600 text-xs px-2 py-1 rounded-full">
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

const DroppableColumn: React.FC<DroppableColumnProps> = ({ id, children }) => {
  const { setNodeRef, isOver } = useDroppable({
    id,
  });

  return (
    <div ref={setNodeRef} className={isOver ? 'ring-2 ring-slate-400 rounded-2xl' : ''}>
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
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
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
      className={`bg-white border border-slate-200 rounded-xl p-4 shadow-sm cursor-grab active:cursor-grabbing ${
        updating ? 'opacity-60' : ''
      }`}
    >
      <h4 className="font-semibold mb-1">{application.role_title}</h4>

      <p className="text-sm text-slate-500">
        {application.companies?.name || 'Unknown Company'}
      </p>

      <div className="flex flex-wrap gap-2 mt-3">
        {application.source && (
          <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-full text-xs">
            {application.source}
          </span>
        )}

        {application.date_applied && (
          <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-full text-xs">
            {application.date_applied}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between mt-4 text-sm">
        <Link
          to={`/applications/${application.id}`}
          className="text-slate-900 underline"
          onPointerDown={(e) => e.stopPropagation()}
        >
          View
        </Link>

        {application.application_link && (
          <a
            href={application.application_link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900"
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