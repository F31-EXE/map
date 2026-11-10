/**
 * Makes the web version an installable app (Chrome / Edge: «Установить GrimMap») that
 * opens without internet: links the manifest and registers public/sw.js.
 */
export function setupPwa(): void {
  if (typeof document === 'undefined') return;
  const base = (process.env.EXPO_BASE_URL ?? '').replace(/\/$/, '');
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = `${base}/manifest.webmanifest`;
    document.head.appendChild(link);
    const theme = document.createElement('meta');
    theme.name = 'theme-color';
    theme.content = '#0B0F0C';
    document.head.appendChild(theme);
  }
  // Local development (expo start) stays uncached.
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    navigator.serviceWorker
      .register(`${base}/sw.js`, { scope: `${base}/` })
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        // Everything this page loaded so far (scripts, fonts, icons): kept for offline.
        const urls = performance
          .getEntriesByType('resource')
          .map((r) => r.name)
          .filter((u) => u.startsWith(location.origin));
        reg.active?.postMessage({ type: 'cache', urls });
      })
      .catch(() => {});
  }
}
