import { z } from 'zod'

export const MediaSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,119}$/)
export const MediaFolderSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/)

export const CreateMediaFolderInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: MediaFolderSlugSchema.optional(),
  description: z.string().trim().max(2000).nullable().default(null),
})

export const UpdateMediaFolderInput = CreateMediaFolderInput.extend({
  id: z.string().uuid(),
})

export const UpdateMediaAssetInput = z.object({
  id: z.string().uuid(),
  folderId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  slug: MediaSlugSchema,
  description: z.string().trim().max(4000).nullable().default(null),
  isArchived: z.boolean().default(false),
})

export type CreateMediaFolderInput = z.infer<typeof CreateMediaFolderInput>
export type UpdateMediaFolderInput = z.infer<typeof UpdateMediaFolderInput>
export type UpdateMediaAssetInput = z.infer<typeof UpdateMediaAssetInput>
