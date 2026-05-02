export interface BuildMediaRagTextInput {
  folderName: string
  folderSlug: string
  folderDescription: string | null
  assetName: string
  assetSlug: string
  assetDescription: string | null
}

export interface MediaRefs {
  folderSlugs: string[]
  assetSlugs: string[]
}

function uniquePush(values: string[], value: string) {
  if (!values.includes(value)) values.push(value)
}

export function buildMediaRagText(input: BuildMediaRagTextInput): string {
  return [
    `# ${input.assetName.trim() || input.assetSlug}`,
    '',
    `Media folder: ${input.folderName.trim() || input.folderSlug}`,
    `Folder slug: #${input.folderSlug}`,
    `Folder description: ${(input.folderDescription ?? '').trim() || '(none)'}`,
    '',
    `Image slug: @${input.assetSlug}`,
    `Image description: ${(input.assetDescription ?? '').trim() || '(none)'}`,
  ].join('\n')
}

export function extractMediaRefs(text: string): MediaRefs {
  const folderSlugs: string[] = []
  const assetSlugs: string[] = []
  const tokenRe = /(^|[\s([{<>"'])([#@])([a-z0-9][a-z0-9-]{1,119})(?=$|[\s.,;:!?()[\]{}<>"'])/g

  for (const match of text.matchAll(tokenRe)) {
    const marker = match[2]
    const slug = match[3]

    if (marker === '#') uniquePush(folderSlugs, slug)
    else uniquePush(assetSlugs, slug)
  }

  return { folderSlugs, assetSlugs }
}
