'use client';

import dynamic from 'next/dynamic';

/**
 * The app reads the address bar, location and storage, so it renders in the browser only.
 * The server sends this light shell first.
 */
const CampusApp = dynamic(() => import('./CampusApp'), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh place-items-center bg-background">
      <p role="status" className="text-sm text-muted">Loading campus map…</p>
    </div>
  ),
});

export default function ClientApp() {
  return <CampusApp />;
}
