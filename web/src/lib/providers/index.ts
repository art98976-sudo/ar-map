import { createFetchDataSource, type DataSource } from '../data/dataSource';
import { LocalProvider } from './local/LocalProvider';
import type { MapProvider } from './MapProvider';
import { MazeMapProvider, type MazeMapConfig } from './mazemap/MazeMapProvider';

export type { MapOverlay, MapProvider, ProviderId } from './MapProvider';
export { LocalProvider } from './local/LocalProvider';
export { MazeMapProvider } from './mazemap/MazeMapProvider';
export * from './errors';

export interface ProviderConfig {
  /** Value of MAP_PROVIDER: "local" (default) or "mazemap". */
  provider?: string;
  mazemap?: MazeMapConfig;
  dataSource?: DataSource;
}

export interface ProviderChoice {
  provider: MapProvider;
  /** Set when the requested provider could not be used and local sample data was chosen instead. */
  warning?: string;
}

/**
 * Picks the provider named by MAP_PROVIDER ("local" by default).
 * If MazeMap is requested but not configured, falls back to local sample data with a warning,
 * so the app always runs.
 */
export function createMapProvider(config: ProviderConfig = {}): ProviderChoice {
  const requested = (config.provider || 'local').trim().toLowerCase();
  const local = () => new LocalProvider(config.dataSource ?? createFetchDataSource());

  if (requested === 'mazemap') {
    const mazemap = config.mazemap ?? {};
    if (MazeMapProvider.isConfigured(mazemap)) return { provider: new MazeMapProvider(mazemap) };
    return {
      provider: local(),
      warning: 'MAP_PROVIDER is "mazemap" but MAZEMAP_CAMPUS_ID is not set. Using local sample data.',
    };
  }
  if (requested !== 'local') {
    return { provider: local(), warning: `Unknown MAP_PROVIDER "${config.provider}". Using local sample data.` };
  }
  return { provider: local() };
}

let shared: ProviderChoice | undefined;

/** The app-wide provider, configured from environment variables at build time (see next.config.ts). */
export function getMapProvider(): ProviderChoice {
  shared ??= createMapProvider({
    provider: process.env.NEXT_PUBLIC_MAP_PROVIDER,
    mazemap: { campusId: process.env.NEXT_PUBLIC_MAZEMAP_CAMPUS_ID },
  });
  return shared;
}
