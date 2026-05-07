export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-6 w-24 rounded bg-[#E5E7EB]" />
        <div className="mt-2 h-4 w-56 rounded bg-[#EEF0F3]" />
      </div>
      <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="flex items-center gap-4 px-5 py-3 border-b border-[#F3F4F6]">
          {['w-24', 'w-32', 'w-20', 'w-16', 'w-20'].map((w, i) => (
            <div key={i} className={`h-3 ${w} rounded bg-[#EEF0F3]`} />
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-[#F9FAFB]">
            <div className="h-4 w-24 rounded bg-[#F3F4F6]" />
            <div className="h-3 w-32 rounded bg-[#F3F4F6]" />
            <div className="h-3 w-20 rounded bg-[#F3F4F6]" />
            <div className="h-5 w-16 rounded-full bg-[#EEF0F3]" />
            <div className="ml-auto h-3 w-16 rounded bg-[#F3F4F6]" />
          </div>
        ))}
      </div>
    </div>
  )
}
