/**
 * Loads MazeMap's official JS API from api.mazemap.com (no copy is kept in this repo)
 * and applies the campus tokens. Docs: https://api.mazemap.com/js/latest/docs/
 *
 * Only the small part of the API this app uses is typed here.
 */

export const MAZEMAP_SDK_VERSION = '3.0.9';

export interface MazemapInstructionStep {
  instruction: string;
  geometry?: GeoJSON.LineString | null;
  zLevel?: number | null;
  buildingName?: string | null;
}

export interface MazemapTrip {
  getInstructionsSteps(): MazemapInstructionStep[];
}

export interface MazemapSearchController {
  search(query: string): Promise<{ results: GeoJSON.FeatureCollection }>;
}

export interface MazemapGlobal {
  Config: {
    setMazemapViewToken(token: string): void;
    setMazemapAuthToken(token: string): void;
  };
  Search: { SearchController: new (options: Record<string, unknown>) => MazemapSearchController };
  Data: {
    getPoi(id: number): Promise<GeoJSON.Feature>;
    getBuildingsByCampusId(campusId: number): Promise<unknown[]>;
    getFloorsByCampusId(campusId: number): Promise<unknown[]>;
    getAtoBTrip(params: Record<string, unknown>): Promise<MazemapTrip>;
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
    script.onload = () => {
      const mm = window.Mazemap;
      if (!mm) return reject(new Error('MazeMap JS API did not load.'));
      if (opts.viewToken) mm.Config.setMazemapViewToken(opts.viewToken);
      if (opts.authToken) mm.Config.setMazemapAuthToken(opts.authToken);
      resolve(mm);
    };
    script.onerror = () => {
      loading = undefined;
      reject(new Error('Could not reach api.mazemap.com.'));
    };
    document.head.appendChild(script);
  });
  return loading;
}
