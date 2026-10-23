import Link from "next/link";

/** Any address that is not part of the app: point people back to the map instead of a bare 404. */
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-center">
      <div className="max-w-sm space-y-4">
        <span aria-hidden className="mx-auto grid size-12 place-items-center rounded-xl bg-teal text-xl font-bold text-on-accent">
          S
        </span>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="text-sm text-muted">
          The Stirling Campus Map lives on its home page. Use the links below to open the map or AR navigation.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/" className="inline-flex min-h-11 items-center rounded-full bg-teal px-5 text-sm font-semibold text-on-accent">
            Open the campus map
          </Link>
          <Link href="/?tab=ar" className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-semibold">
            AR navigation
          </Link>
        </div>
      </div>
    </main>
  );
}
