import { useEffect, useState } from 'react';

interface InstallPrompt extends Event {
  prompt(): Promise<unknown>;
}

export function useDesktopInstall(): (() => void) | undefined {
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    function prepareInstall(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    }

    function clearInstall() {
      setInstallPrompt(null);
    }

    window.addEventListener('beforeinstallprompt', prepareInstall);
    window.addEventListener('appinstalled', clearInstall);
    return () => {
      window.removeEventListener('beforeinstallprompt', prepareInstall);
      window.removeEventListener('appinstalled', clearInstall);
    };
  }, []);

  if (!installPrompt) return undefined;
  return () => {
    setInstallPrompt(null);
    void installPrompt.prompt().catch(() => {
      // The browser may invalidate a prompt after it has been offered.
    });
  };
}
