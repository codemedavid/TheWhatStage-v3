export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-6 w-40 rounded bg-[#E5E7EB]" />
        <div className="mt-2 h-4 w-72 rounded bg-[#EEF0F3]" />
      </div>
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 space-y-4">
        <div className="h-5 w-32 rounded bg-[#EEF0F3]" />
        <div className="h-24 w-full rounded-md bg-[#F3F4F6]" />
        <div className="flex gap-3">
          <div className="h-10 w-36 rounded-md bg-[#EEF0F3]" />
          <div className="h-10 w-28 rounded-md bg-[#F3F4F6]" />
        </div>
      </div>
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 space-y-3">
        <div className="h-5 w-24 rounded bg-[#EEF0F3]" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 py-2 border-b border-[#F9FAFB]">
            <div className="h-8 w-8 rounded-full bg-[#F3F4F6]" />
            <div className="flex-1">
              <div className="h-3 w-48 rounded bg-[#EEF0F3]" />
              <div className="mt-1 h-3 w-32 rounded bg-[#F3F4F6]" />
            </div>
            <div className="h-5 w-16 rounded-full bg-[#F3F4F6]" />
          </div>
        ))}
      </div>
    </div>
  )
}
