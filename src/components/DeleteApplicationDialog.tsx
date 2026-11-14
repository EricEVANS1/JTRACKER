import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from './Modal';

interface DeleteApplicationDialogProps {
  role: string;
  company?: string | null;
  onCancel: () => void;
  onDelete: () => Promise<void>;
}

export function DeleteApplicationDialog({ role, company, onCancel, onDelete }: DeleteApplicationDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function confirmDelete() {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the application. Please try again.');
      setPending(false);
    }
  }

  return (
    <Modal
      initialFocus={cancelRef}
      labelledBy="delete-application-title"
      describedBy="delete-application-description"
      onClose={() => { if (!pending) onCancel(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-950/50"
    >
      <div className="mb-4 grid size-10 place-items-center rounded-xl bg-red-50 text-red-700">
        <Trash2 size={19} aria-hidden="true" />
      </div>
      <h2 id="delete-application-title" className="text-lg font-semibold">Delete application?</h2>
      <p id="delete-application-description" className="mt-2 break-words text-sm leading-6 text-slate-600">
        <strong className="font-semibold text-slate-900">{role}{company ? ` at ${company}` : ''}</strong>{' '}
        will be permanently deleted. You can’t undo this.
      </p>
      {error && <p role="alert" className="mt-4 break-words text-sm text-red-700">{error}</p>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void confirmDelete()}
          className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
        >
          {pending ? 'Deleting…' : 'Delete application'}
        </button>
      </div>
    </Modal>
  );
}
