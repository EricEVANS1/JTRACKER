import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  initialFocus?: React.RefObject<HTMLElement | null>;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  className: string;
  onClose: () => void;
  dismissOnBackdrop?: boolean;
  children: ReactNode;
}

export function Modal({ initialFocus, label, labelledBy, describedBy, className, onClose, dismissOnBackdrop, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    initialFocus?.current?.focus();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [initialFocus]);

  return (
    <dialog
      ref={ref}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={className}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (dismissOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
