/**
 * Loads MazeMap's official JS map from api.mazemap.com (no copy is kept in this repo).
 * Version 2.2.1 is the version the earlier Stirling prototype uses successfully with campus 2058.
 * Docs: https://api.mazemap.com/js/latest/docs/
 */

export const MAZEMAP_SDK_VERSION = '2.2.1';

/** The parts of MazeMap's map (a Mapbox GL v1 map with floor support) this app uses. */
export interface MazemapMapInstance {
  on(event: string, cb: (e?: unknown) => void): void;
  on(event: string, layer: string, cb: (e?: unknown) => void): void;
  getZLevel(): number;
  setZLevel(z: number): void;
}

export interface MazemapGlobal {
  Map: new (options: Record<string, unknown>) => MazemapMapInstance;
  mapboxgl: { NavigationControl: new (options?: Record<string, unknown>) => unknown };
  Config: {
    setMazemapViewToken?(token: string): void;
    setMazemapAuthToken?(token: string): void;
  };
}

declare global {
  interface Window {
    Mazemap?: MazemapGlobal;
  }
}

let loading: Promise<MazemapGlobal> | undefined;

export function loadMazemapSdk(opts: { viewToken?: string; authToken?: string; version?: string } = {}): Promise<MazemapGlobal> {
  if (typeof window === 'undefined') return Promise.reject(new Error('MazeMap runs in the browser only.'));
  loading ??= new Promise<MazemapGlobal>((resolve, reject) => {
    const v = opts.version ?? MAZEMAP_SDK_VERSION;
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `https://api.mazemap.com/js/v${v}/mazemap.min.css`;
    document.head.appendChild(css);
    const script = document.createElement('script');
    script.src = `https://api.mazemap.com/js/v${v}/mazemap.min.js`;
    script.async = true;
    const fail = (msg: string) => {
      loading = undefined;
      reject(new Error(msg));
    };
    const timer = setTimeout(() => fail('The University campus map (MazeMap) took too long to load.'), 20_000);
    script.onload = () => {
      clearTimeout(timer);
      const mm = window.Mazemap;
      if (!mm?.Map) return fail('The University campus map (MazeMap) did not load.');
      if (opts.viewToken) mm.Config?.setMazemapViewToken?.(opts.viewToken);
      if (opts.authToken) mm.Config?.setMazemapAuthToken?.(opts.authToken);
      resolve(mm);
    };
    script.onerror = () => {
      clearTimeout(timer);
      fail("Couldn't reach the University campus map (api.mazemap.com).");
    };
    document.head.appendChild(script);
  });
  return loading;
}
