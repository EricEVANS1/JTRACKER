import { createContext, useContext } from 'react';

export interface Confirmation {
  title: string;
  description: string;
  action: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export const ConfirmationContext = createContext<((options: Confirmation) => Promise<boolean>) | null>(null);

export function useConfirmation() {
  const confirm = useContext(ConfirmationContext);
  if (!confirm) throw new Error('ConfirmationProvider is required.');
  return confirm;
}
