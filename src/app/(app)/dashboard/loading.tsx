export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-6 w-40 rounded bg-[#E5E7EB]" />
        <div className="mt-2 h-4 w-64 rounded bg-[#EEF0F3]" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-[#E5E7EB] bg-white p-5 min-h-40"
          >
            <div className="h-4 w-20 rounded bg-[#EEF0F3]" />
            <div className="mt-3 h-3 w-32 rounded bg-[#F3F4F6]" />
          </div>
        ))}
      </div>
    </div>
  )
}
