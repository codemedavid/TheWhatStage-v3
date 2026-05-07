export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-6 w-32 rounded bg-[#E5E7EB]" />
        <div className="mt-2 h-4 w-72 rounded bg-[#EEF0F3]" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-4">
            <div className="h-5 w-32 rounded bg-[#EEF0F3]" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i}>
                <div className="h-3 w-24 rounded bg-[#EEF0F3]" />
                <div className="mt-2 h-10 w-full rounded-md bg-[#F3F4F6]" />
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 space-y-4">
            <div className="h-5 w-40 rounded bg-[#EEF0F3]" />
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-28 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB]" />
              ))}
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-[#E5E7EB] bg-white overflow-hidden flex flex-col min-h-[480px]">
          <div className="border-b border-[#E5E7EB] px-4 py-3">
            <div className="h-4 w-24 rounded bg-[#EEF0F3]" />
          </div>
          <div className="flex-1 p-4 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? '' : 'justify-end'}`}>
                <div className={`h-10 rounded-xl bg-[#F3F4F6] ${i % 2 === 0 ? 'w-48' : 'w-36'}`} />
              </div>
            ))}
          </div>
          <div className="border-t border-[#E5E7EB] p-3">
            <div className="h-10 w-full rounded-md bg-[#F3F4F6]" />
          </div>
        </div>
      </div>
    </div>
  )
}
