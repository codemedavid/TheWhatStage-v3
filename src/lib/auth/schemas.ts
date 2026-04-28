import { z } from 'zod'

const email = z.string().trim().toLowerCase().email('Enter a valid email address.')

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .regex(/[A-Za-z]/, 'Password must contain a letter.')
  .regex(/[0-9]/, 'Password must contain a number.')

const fullName = z
  .string()
  .trim()
  .min(1, 'Full name is required.')
  .max(80, 'Full name must be 80 characters or fewer.')

export const signUpSchema = z.object({
  full_name: fullName,
  email,
  password,
})

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required.'),
})

export type SignUpInput = z.infer<typeof signUpSchema>
export type SignInInput = z.infer<typeof signInSchema>
