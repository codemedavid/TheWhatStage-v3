import { z } from 'zod'

export const TitleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(200, 'Title too long')

export const CategoryNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(60, 'Name too long')

export const CategoryColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value')
  .optional()
  .nullable()

export const CreateDocumentInput = z.object({
  title: TitleSchema.optional(),
  categoryId: z.string().uuid().nullable().optional(),
})

// 1 MB hard cap on serialized HTML/text — prevents oversized writes.
const MAX_BODY_BYTES = 1_000_000

export const AutosaveDocumentInput = z
  .object({
    id: z.string().uuid(),
    title: TitleSchema,
    draftJson: z.unknown(),
    draftHtml: z.string().max(MAX_BODY_BYTES, 'Document too large'),
    draftText: z.string().max(MAX_BODY_BYTES, 'Document too large'),
  })
  .superRefine((val, ctx) => {
    try {
      const size = new TextEncoder().encode(JSON.stringify(val.draftJson ?? null)).length
      if (size > MAX_BODY_BYTES) {
        ctx.addIssue({
          code: 'custom',
          message: 'Document too large',
          path: ['draftJson'],
        })
      }
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Invalid draft JSON', path: ['draftJson'] })
    }
  })

export const SaveDocumentInput = z.object({
  id: z.string().uuid(),
})

export const RenameDocumentInput = z.object({
  id: z.string().uuid(),
  title: TitleSchema,
})

export const SetDocumentCategoryInput = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
})

export const DeleteDocumentInput = z.object({
  id: z.string().uuid(),
})

export const CreateCategoryInput = z.object({
  name: CategoryNameSchema,
  color: CategoryColorSchema,
})

export const RenameCategoryInput = z.object({
  id: z.string().uuid(),
  name: CategoryNameSchema,
})

export const UpdateCategoryColorInput = z.object({
  id: z.string().uuid(),
  color: CategoryColorSchema,
})

export const DeleteCategoryInput = z.object({
  id: z.string().uuid(),
})

export const ReorderCategoriesInput = z.object({
  ids: z.array(z.string().uuid()),
})

export const TogglePinInput = z.object({
  id: z.string().uuid(),
  pinned: z.boolean(),
})

export const TagNameSchema = z
  .string()
  .trim()
  .min(1, 'Tag name required')
  .max(40, 'Tag name too long')

export const CreateTagInput = z.object({
  name: TagNameSchema,
  color: CategoryColorSchema,
})
export const RenameTagInput = z.object({
  id: z.string().uuid(),
  name: TagNameSchema,
})
export const DeleteTagInput = z.object({ id: z.string().uuid() })
export const SetDocumentTagsInput = z.object({
  id: z.string().uuid(),
  tagIds: z.array(z.string().uuid()),
})

export const FaqQuestionSchema = z
  .string()
  .trim()
  .min(1, 'Question is required')
  .max(300, 'Question too long')

export const FaqAnswerSchema = z
  .string()
  .max(10000, 'Answer too long')

export const CreateFaqInput = z.object({
  question: FaqQuestionSchema,
  answer: FaqAnswerSchema.optional().default(''),
  categoryId: z.string().uuid().nullable().optional(),
})

export const UpdateFaqInput = z.object({
  id: z.string().uuid(),
  question: FaqQuestionSchema,
  answer: FaqAnswerSchema,
  categoryId: z.string().uuid().nullable().optional(),
  isPublished: z.boolean().optional(),
})

export const DeleteFaqInput = z.object({ id: z.string().uuid() })

export const ReorderFaqsInput = z.object({
  ids: z.array(z.string().uuid()),
})

export const ToggleFaqPublishedInput = z.object({
  id: z.string().uuid(),
  isPublished: z.boolean(),
})
