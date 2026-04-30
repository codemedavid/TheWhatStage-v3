export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F9FAFB] p-6">
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-8 text-center">
        <h1 className="text-[18px] font-semibold text-[#111827]">Page not found</h1>
        <p className="mt-1 text-[13px] text-[#6B7280]">
          This action page may be unpublished or the link may be expired.
        </p>
      </div>
    </main>
  )
}
