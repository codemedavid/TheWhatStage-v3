export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-3 w-20 rounded bg-[#F3F4F6]" />
        <div className="mt-2 h-6 w-48 rounded bg-[#E5E7EB]" />
        <div className="mt-1 h-4 w-64 rounded bg-[#EEF0F3]" />
      </div>
      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="flex items-center gap-4 px-5 py-3 border-b border-[#F3F4F6]">
          {['w-28', 'w-32', 'w-20', 'w-24'].map((w, i) => (
            <div key={i} className={`h-3 ${w} rounded bg-[#EEF0F3]`} />
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-[#F9FAFB]">
            <div className="h-3 w-28 rounded bg-[#F3F4F6]" />
            <div className="h-3 w-32 rounded bg-[#F3F4F6]" />
            <div className="h-3 w-20 rounded bg-[#F3F4F6]" />
            <div className="ml-auto h-3 w-24 rounded bg-[#F3F4F6]" />
          </div>
        ))}
      </div>
    </div>
  )
}
