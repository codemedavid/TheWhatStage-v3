export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <header>
        <div className="h-6 w-40 rounded bg-[#E5E7EB]" />
        <div className="mt-2 h-3 w-72 rounded bg-[#EEF0F3]" />
      </header>
      <div className="flex items-center gap-2">
        <div className="h-8 w-24 rounded bg-[#EEF0F3]" />
        <div className="h-8 w-24 rounded bg-[#EEF0F3]" />
        <div className="ml-auto h-8 w-32 rounded bg-[#E5E7EB]" />
      </div>
      <div className="h-9 w-full max-w-md rounded-md bg-[#EEF0F3]" />
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-14 rounded-lg border border-[#E5E7EB] bg-white"
          />
        ))}
      </div>
    </div>
  )
}
