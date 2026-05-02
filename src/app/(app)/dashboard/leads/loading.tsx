export default function Loading() {
  return (
    <div className="-mx-8 -my-6 px-8 py-6 animate-pulse">
      <div className="sticky top-0 -mx-8 px-8 py-4 border-b border-[#E5E7EB] bg-white/70 backdrop-blur">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="h-6 w-24 rounded bg-[#E5E7EB]" />
          <div className="h-3 w-40 rounded bg-[#EEF0F3]" />
          <div className="ml-auto flex items-center gap-2">
            <div className="h-8 w-32 rounded-full bg-[#EEF0F3]" />
            <div className="h-8 w-20 rounded-full bg-[#EEF0F3]" />
            <div className="h-8 w-24 rounded-full bg-[#E5E7EB]" />
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <div className="h-9 w-72 rounded-md bg-[#EEF0F3]" />
        <div className="h-9 w-32 rounded-md bg-[#EEF0F3]" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-xl border border-[#E5E7EB] bg-white p-3 min-h-[320px] space-y-2"
          >
            <div className="h-4 w-24 rounded bg-[#E5E7EB]" />
            <div className="h-16 rounded bg-[#F3F4F6]" />
            <div className="h-16 rounded bg-[#F3F4F6]" />
            <div className="h-16 rounded bg-[#F3F4F6]" />
          </div>
        ))}
      </div>
    </div>
  )
}
