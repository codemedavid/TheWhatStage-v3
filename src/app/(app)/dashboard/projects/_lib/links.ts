// Canonical deep-link to a project card. The Projects index resolves this legacy
// `?project=<id>` form to the card's own workspace board (see
// fetchProjectWorkspaceId), so it works regardless of which workspace the card
// lives in — including cards created into a non-default workspace via the picker.
export function projectHref(projectId: string): string {
  return `/dashboard/projects?project=${projectId}`
}
