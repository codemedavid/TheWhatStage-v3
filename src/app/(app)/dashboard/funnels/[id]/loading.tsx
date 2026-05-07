export default function Loading() {
  return (
    <div className="flex h-full w-full animate-pulse">
      <div className="w-64 border-r border-[#E5E7EB] bg-white p-4 space-y-3">
        <div className="h-5 w-32 rounded bg-[#EEF0F3]" />
        <div className="h-3 w-48 rounded bg-[#F3F4F6]" />
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 rounded-md bg-[#F3F4F6]" />
          ))}
        </div>
      </div>
      <div className="flex-1 bg-[#F9FAFB] p-6">
        <div className="mx-auto max-w-xl space-y-4">
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <div className="h-3 w-24 rounded bg-[#EEF0F3]" />
                <div className="mt-2 h-10 w-full rounded-md bg-[#F3F4F6]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
