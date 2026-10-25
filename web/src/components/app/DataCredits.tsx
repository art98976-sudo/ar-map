/** Where the map data comes from: a small note on phones, the side panel footer on desktop. */

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

export function DataFooter({ sample }: { sample: boolean }) {
  return (
    <footer className="hidden border-t border-border px-4 py-3 text-xs text-muted lg:block">
      {sample ? (
        <>
          <strong className="font-semibold text-foreground">Sample data.</strong> Positions are approximate and hand-placed for development.
          Not official University of Stirling or MazeMap data. Student project, not an official University service. Base map © OpenFreeMap, ©
          OpenStreetMap contributors.
        </>
      ) : (
        <>
          <strong className="font-semibold text-foreground">University campus map by MazeMap.</strong> Buildings, rooms, floors and routes come
          from the University of Stirling&apos;s MazeMap campus. Student project, not an official University service.
        </>
      )}
    </footer>
  );
}
