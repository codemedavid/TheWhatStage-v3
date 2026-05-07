export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-pulse">
      <div>
        <div className="h-3 w-16 rounded bg-[#F3F4F6]" />
        <div className="mt-2 h-6 w-48 rounded bg-[#E5E7EB]" />
      </div>
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 space-y-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i}>
            <div className="h-3 w-20 rounded bg-[#EEF0F3]" />
            <div className="mt-2 h-10 w-full rounded-md bg-[#F3F4F6]" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6">
        <div className="h-4 w-24 rounded bg-[#EEF0F3]" />
        <div className="mt-3 h-40 rounded-md bg-[#F3F4F6]" />
      </div>
      <div className="flex justify-end gap-3">
        <div className="h-9 w-20 rounded-md bg-[#EEF0F3]" />
        <div className="h-9 w-28 rounded-md bg-[#E5E7EB]" />
      </div>
    </div>
  )
}
