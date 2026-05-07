export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-start justify-between">
        <div>
          <div className="h-6 w-32 rounded bg-[#E5E7EB]" />
          <div className="mt-2 h-4 w-72 rounded bg-[#EEF0F3]" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-28 rounded-md bg-[#EEF0F3]" />
          <div className="h-9 w-32 rounded-md bg-[#E5E7EB]" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-[#E5E7EB] bg-white p-5 min-h-[120px]">
            <div className="h-4 w-20 rounded bg-[#EEF0F3]" />
            <div className="mt-3 h-7 w-16 rounded bg-[#F3F4F6]" />
            <div className="mt-2 h-3 w-32 rounded bg-[#F3F4F6]" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-3">
          <div className="h-5 w-28 rounded bg-[#EEF0F3]" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-[#F3F4F6]">
              <div className="h-10 w-10 rounded-md bg-[#F3F4F6]" />
              <div className="flex-1">
                <div className="h-3 w-32 rounded bg-[#EEF0F3]" />
                <div className="mt-1 h-3 w-16 rounded bg-[#F3F4F6]" />
              </div>
              <div className="h-5 w-14 rounded-full bg-[#F3F4F6]" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-3">
          <div className="h-5 w-28 rounded bg-[#EEF0F3]" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 py-2 border-b border-[#F3F4F6]">
              <div className="flex-1">
                <div className="h-3 w-40 rounded bg-[#EEF0F3]" />
                <div className="mt-1 h-3 w-24 rounded bg-[#F3F4F6]" />
              </div>
              <div className="h-5 w-16 rounded-full bg-[#F3F4F6]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
