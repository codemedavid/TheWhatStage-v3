const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function randomSuffix(len = 6): string {
  let out = ''
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return out
}

export function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  const stem = base.length >= 3 ? base : 'page'
  return `${stem}-${randomSuffix()}`
}
