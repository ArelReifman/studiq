"use client";

/**
 * Presentational loading skeleton for the Learning Map.
 *
 * Mirrors the real <LearningMapView> chrome — topbar with stat chips, a
 * horizontal row of topic cards, the side panel, and the detail panel — so the
 * page shows structure immediately instead of a blank stage while
 * `GET /learning-map` is in flight. Purely visual: no data, no network, no
 * props. When the map resolves it is swapped for the real view.
 */
export function LearningMapSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex-1 min-h-0 flex flex-col animate-pulse"
    >
      {/* TOPBAR — role chip + title + stat chips */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3 px-4 sm:px-5 py-3 border-b border-gray-100 bg-gray-50/60">
        <div className="h-4 w-16 rounded bg-gray-200" />
        <div className="h-4 w-24 rounded bg-gray-200" />
        <span className="w-px h-4 bg-gray-200 hidden sm:inline-block" />
        <div className="h-4 w-32 rounded bg-gray-100" />
        <div className="flex-1" />
        <div className="flex items-center flex-wrap gap-2 w-full sm:w-auto">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-2 bg-white rounded-lg border border-gray-100 px-2.5 py-1.5"
            >
              <div className="flex flex-col items-end gap-1">
                <div className="h-4 w-6 rounded bg-gray-200" />
                <div className="h-2 w-10 rounded bg-gray-100" />
              </div>
              <div className="w-7 h-7 rounded-full bg-gray-100" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row flex-1 min-h-0">
        {/* SIDE PANEL */}
        <aside className="w-full lg:w-56 lg:flex-shrink-0 order-2 lg:order-none border-t lg:border-t-0 lg:border-s border-gray-100 flex flex-col p-3 gap-3">
          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3.5 flex flex-col gap-3">
            <div className="h-4 w-28 rounded bg-gray-200" />
            <div className="h-6 w-16 rounded bg-gray-200 mx-auto" />
            <div className="h-1.5 w-full rounded-full bg-gray-100" />
          </div>
          <div className="h-3 w-20 rounded bg-gray-100" />
          <div className="flex flex-col gap-0.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 h-8 px-2">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-200" />
                <div className="h-3 flex-1 rounded bg-gray-100" />
                <div className="h-3 w-7 rounded bg-gray-100" />
              </div>
            ))}
          </div>
        </aside>

        {/* MAIN */}
        <main className="flex-1 flex flex-col min-w-0 order-1 lg:order-none">
          {/* Card row */}
          <div className="px-4 sm:px-5 pt-4 overflow-hidden">
            <div className="flex gap-3 pb-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="w-[196px] h-[172px] flex-shrink-0 bg-white rounded-lg border border-gray-100 p-4 flex flex-col"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="h-2 w-12 rounded bg-gray-100" />
                    <div className="h-2 w-10 rounded bg-gray-100" />
                  </div>
                  <div className="flex items-center gap-2 flex-1">
                    <div className="flex-1 flex flex-col gap-2">
                      <div className="h-3 w-full rounded bg-gray-200" />
                      <div className="h-3 w-3/4 rounded bg-gray-200" />
                      <div className="h-2 w-1/2 rounded bg-gray-100 mt-1" />
                    </div>
                    <div className="w-[46px] h-[46px] rounded-full bg-gray-100 flex-shrink-0" />
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                    <div className="h-2 w-10 rounded bg-gray-100" />
                    <div className="h-2 w-8 rounded bg-gray-100" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Detail panel */}
          <div className="mx-4 sm:mx-5 mb-5 border border-gray-100 rounded-lg bg-gray-50/40 overflow-hidden flex-1 min-h-0 flex flex-col">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-white">
              <div className="h-4 w-40 rounded bg-gray-200 flex-1" />
              <div className="h-3 w-16 rounded bg-gray-100" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-gray-100">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-4 py-3 flex flex-col gap-2">
                  <div className="h-2 w-14 rounded bg-gray-100" />
                  <div className="h-4 w-10 rounded bg-gray-200" />
                </div>
              ))}
            </div>
            <div className="flex-1 min-h-0">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center h-10 px-4 gap-3 border-b border-gray-100 last:border-b-0"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-200" />
                  <div className="h-3 flex-1 rounded bg-gray-100" />
                  <div className="h-1 w-16 rounded-full bg-gray-100" />
                  <div className="h-3 w-7 rounded bg-gray-100" />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
