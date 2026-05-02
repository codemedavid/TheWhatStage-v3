export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-6 w-32 rounded bg-[#E5E7EB]" />
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 rounded-lg border border-[#E5E7EB] bg-white"
          />
        ))}
      </div>
    </div>
  )
}
