import CampusMap from "@/components/map/CampusMap";

export default function Home() {
  return (
    <>
      <header className="flex min-h-14 items-center gap-3 border-b border-border bg-surface px-4">
        <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-teal font-bold text-on-accent">
          S
        </span>
        <div className="leading-tight">
          <h1 className="text-base font-semibold">Stirling Campus Map</h1>
          <p className="text-xs text-muted">Step 1 preview: sample data on a plain map</p>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <CampusMap />
      </main>

      <footer className="border-t border-border bg-surface-muted px-4 py-2 text-xs text-muted">
        <strong className="font-semibold text-foreground">Sample data.</strong> Positions are approximate and
        hand-placed for development. This is not official University of Stirling or MazeMap data. Student project,
        not an official University service.
      </footer>
    </>
  );
}
