// Skeleton shown while the inbox query resolves on navigation.
export default function InboxLoading() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse">
      <div className="mb-4">
        <div className="h-6 w-24 rounded bg-[#E5E7EB]" />
        <div className="mt-2 h-3 w-72 rounded bg-[#EEF0F3]" />
      </div>
      <div className="mb-4 flex gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-8 w-24 rounded-full bg-[#EEF0F3]" />
        ))}
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-14 rounded-xl border border-[#E5E7EB] bg-white" />
        ))}
      </div>
    </div>
  )
}
