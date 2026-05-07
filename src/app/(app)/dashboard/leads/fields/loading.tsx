export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-start justify-between">
        <div>
          <div className="h-6 w-28 rounded bg-[#E5E7EB]" />
          <div className="mt-2 h-4 w-56 rounded bg-[#EEF0F3]" />
        </div>
        <div className="h-9 w-28 rounded-md bg-[#E5E7EB]" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-xl border border-[#E5E7EB] bg-white px-5 py-4">
            <div className="h-4 w-36 rounded bg-[#EEF0F3]" />
            <div className="h-5 w-16 rounded-full bg-[#F3F4F6]" />
            <div className="ml-auto flex gap-2">
              <div className="h-7 w-16 rounded-md bg-[#F3F4F6]" />
              <div className="h-7 w-16 rounded-md bg-[#F3F4F6]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
