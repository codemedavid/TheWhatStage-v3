export const VIBE_PRESETS = [
  'friendly_kuya_ate',
  'professional_consultant',
  'hype_closer',
  'calm_expert',
] as const

export type VibePreset = (typeof VIBE_PRESETS)[number]

export interface PersonalitySeeds {
  vibe_preset?: VibePreset
  greet?: string
  must_use?: string
  must_not?: string
}

export interface GeneratedPersonality {
  name: string
  persona: string
  do_rules: string[]
  dont_rules: string[]
  fallback_message: string
}
