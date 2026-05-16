export default function Loading() {
  return (
    <div className="min-h-svh bg-zinc-50">
      <div className="h-12 w-full border-b border-zinc-200 bg-white" />
      <div className="mx-auto max-w-2xl animate-pulse px-4 py-10">
        <div className="h-6 w-2/3 rounded bg-zinc-200" />
        <div className="mt-4 h-4 w-full rounded bg-zinc-200" />
        <div className="mt-2 h-4 w-5/6 rounded bg-zinc-200" />
      </div>
    </div>
  )
}
