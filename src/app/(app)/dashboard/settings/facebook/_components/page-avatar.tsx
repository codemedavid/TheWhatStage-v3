/* eslint-disable @next/next/no-img-element */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

export function PageAvatar({
  src,
  name,
  size = 36,
}: {
  src: string | null | undefined
  name: string
  size?: number
}) {
  const dim = `${size}px`
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="shrink-0 rounded-full border border-[#E5E7EB] object-cover"
        style={{ width: dim, height: dim }}
      />
    )
  }
  return (
    <div
      aria-hidden="true"
      style={{ width: dim, height: dim }}
      className="flex shrink-0 items-center justify-center rounded-full bg-[#1877F2] text-[12px] font-semibold text-white"
    >
      {initials(name)}
    </div>
  )
}
