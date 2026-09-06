export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-6 w-28 rounded bg-[#E5E7EB]" />
        <div className="mt-2 h-4 w-56 rounded bg-[#EEF0F3]" />
      </div>
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 space-y-5">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-[#F3F4F6]" />
          <div className="h-9 w-28 rounded-md bg-[#EEF0F3]" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <div className="h-3 w-20 rounded bg-[#EEF0F3]" />
            <div className="mt-2 h-10 w-full rounded-md bg-[#F3F4F6]" />
          </div>
        ))}
        <div className="flex justify-end">
          <div className="h-9 w-28 rounded-md bg-[#E5E7EB]" />
        </div>
      </div>
    </div>
  )
}
