export default function Loading() {
  return (
    <div className="flex h-full animate-pulse">
      <div className="w-48 border-r border-[#E5E7EB] p-4 space-y-2">
        <div className="h-4 w-24 rounded bg-[#EEF0F3]" />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-8 rounded-md bg-[#F3F4F6]" />
        ))}
      </div>
      <div className="flex-1 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-6 w-32 rounded bg-[#E5E7EB]" />
          <div className="flex gap-2">
            <div className="h-9 w-32 rounded-md bg-[#EEF0F3]" />
            <div className="h-9 w-28 rounded-md bg-[#E5E7EB]" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
            <div key={i} className="aspect-square rounded-lg border border-[#E5E7EB] bg-[#F3F4F6]" />
          ))}
        </div>
      </div>
    </div>
  )
}
