export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-pulse">
      <div>
        <div className="h-3 w-16 rounded bg-[#F3F4F6]" />
        <div className="mt-2 h-6 w-48 rounded bg-[#E5E7EB]" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-3">
          <div className="h-4 w-28 rounded bg-[#EEF0F3]" />
          <div className="h-3 w-40 rounded bg-[#F3F4F6]" />
          <div className="h-3 w-32 rounded bg-[#F3F4F6]" />
        </div>
        <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-3">
          <div className="h-4 w-24 rounded bg-[#EEF0F3]" />
          <div className="h-5 w-16 rounded-full bg-[#F3F4F6]" />
        </div>
      </div>
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-3">
        <div className="h-4 w-24 rounded bg-[#EEF0F3]" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-4 py-3 border-b border-[#F3F4F6]">
            <div className="h-12 w-12 rounded-md bg-[#F3F4F6]" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-40 rounded bg-[#EEF0F3]" />
              <div className="h-3 w-24 rounded bg-[#F3F4F6]" />
            </div>
            <div className="h-4 w-16 rounded bg-[#EEF0F3]" />
          </div>
        ))}
        <div className="flex justify-end pt-2">
          <div className="h-5 w-24 rounded bg-[#EEF0F3]" />
        </div>
      </div>
    </div>
  )
}
