export type TemplateVisibility = 'public' | 'private'

export type ToneAxes = {
  assertiveness: number
  warmth: number
  formality: number
  humor: number
}

export type PersonalityTemplate = {
  id: string
  slug: string
  name: string
  inspiredBy: string
  tagline: string
  avatarEmoji: string
  voiceDescriptor: string
  samplePersona: string
  sampleDoRules: string[]
  sampleDontRules: string[]
  signaturePhrases: string[]
  toneAxes: ToneAxes
  bestFor: string[]
  visibility: TemplateVisibility
  authorUserId: string | null
  isOfficial: boolean
  createdAt: string
  updatedAt: string
}

export type AdoptionStatus = 'draft' | 'applied' | 'reverted'

export type PersonalityAdoption = {
  id: string
  userId: string
  templateId: string
  status: AdoptionStatus
  sourceSnapshot: Record<string, unknown>
  generatedConfig: GeneratedPersonalityConfig
  appliedConfig: GeneratedPersonalityConfig | null
  adaptationNotes: string | null
  adoptedAt: string
}

export type GeneratedPersonalityConfig = {
  name: string
  persona: string
  instructions: string
  doRules: string[]
  dontRules: string[]
  fallbackMessage: string
  suggestedTemperature: number
  adaptationNotes: string
}
