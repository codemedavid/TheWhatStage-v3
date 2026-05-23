import { z } from 'zod'

// Cap inputs at sane bounds so an attacker can't tie up a worker by submitting
// a 1MB password / 1MB email. 254 is the RFC 5321 path limit for email; 128
// is comfortably above any reasonable password length while still capping
// bcrypt-style hash work.
const PASSWORD_MAX = 128
const EMAIL_MAX = 254

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX, 'Email is too long.')
  .email('Enter a valid email address.')

const signUpPassword = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(PASSWORD_MAX, 'Password is too long.')
  .regex(/[A-Za-z]/, 'Password must contain a letter.')
  .regex(/[0-9]/, 'Password must contain a number.')

const fullName = z
  .string()
  .trim()
  .min(1, 'Full name is required.')
  .max(80, 'Full name must be 80 characters or fewer.')

// Coerce the "agree to terms" checkbox: HTML forms send the literal string
// "on" when checked and omit the field when not. Treat anything else as
// not-agreed so we fail closed.
const agree = z
  .string()
  .optional()
  .refine((v) => v === 'on', { message: 'You must agree to the Terms and Privacy Policy.' })

export const signUpSchema = z.object({
  full_name: fullName,
  email,
  password: signUpPassword,
  agree,
})

export const signInSchema = z.object({
  email,
  // Don't enforce signUpPassword rules on sign-in: legacy accounts may have
  // weaker passwords than the current policy. Just bound the length so we
  // don't burn CPU on a megabyte payload.
  password: z
    .string()
    .min(1, 'Password is required.')
    .max(PASSWORD_MAX, 'Password is too long.'),
})

export type SignUpInput = z.infer<typeof signUpSchema>
export type SignInInput = z.infer<typeof signInSchema>
