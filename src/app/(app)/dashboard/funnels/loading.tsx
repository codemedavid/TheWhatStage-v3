export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-start justify-between">
        <div>
          <div className="h-6 w-28 rounded bg-[#E5E7EB]" />
          <div className="mt-2 h-4 w-64 rounded bg-[#EEF0F3]" />
        </div>
        <div className="h-9 w-32 rounded-md bg-[#E5E7EB]" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-3">
            <div className="h-5 w-40 rounded bg-[#EEF0F3]" />
            <div className="h-3 w-56 rounded bg-[#F3F4F6]" />
            <div className="flex items-center gap-2 pt-1">
              <div className="h-5 w-16 rounded-full bg-[#F3F4F6]" />
              <div className="h-3 w-24 rounded bg-[#F3F4F6]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
