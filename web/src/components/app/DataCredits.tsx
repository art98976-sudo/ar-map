/** Where the map data comes from: a small note on phones. */

const noteClass = 'pointer-events-auto mx-auto w-fit rounded-full bg-surface px-3 py-1 text-center text-[11px] text-muted shadow-sm lg:hidden';

export function DataNote({ sample }: { sample: boolean }) {
  if (!sample) return <p className={noteClass}>University campus map by MazeMap · student project, not an official service</p>;
  return (
    <p className={noteClass}>
      Sample data · approximate, not official · Map{' '}
      <a className="underline" href="https://openfreemap.org" target="_blank" rel="noreferrer">
        © OpenFreeMap
      </a>{' '}
      <a className="underline" href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">
        © OpenMapTiles
      </a>{' '}
      <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap
      </a>
    </p>
  );
}
