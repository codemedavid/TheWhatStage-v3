export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 animate-pulse">
      <div className="h-4 w-32 rounded bg-[#EEF0F3]" />
      <div className="h-8 w-2/3 rounded bg-[#E5E7EB]" />
      <div className="h-3 w-40 rounded bg-[#EEF0F3]" />
      <div className="space-y-2 pt-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-4 rounded bg-[#F3F4F6]" />
        ))}
      </div>
    </div>
  )
}
