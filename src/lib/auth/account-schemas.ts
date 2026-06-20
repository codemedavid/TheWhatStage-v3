import { z } from 'zod'

// Mirror the bounds and password policy used at signup (see ./schemas.ts) so
// the rules a user must satisfy to change their password match the rules they
// satisfied to create the account.
const PASSWORD_MAX = 128
const EMAIL_MAX = 254

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX, 'Email is too long.')
  .email('Enter a valid email address.')

const newPassword = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(PASSWORD_MAX, 'Password is too long.')
  .regex(/[A-Za-z]/, 'Password must contain a letter.')
  .regex(/[0-9]/, 'Password must contain a number.')

export const changePasswordSchema = z
  .object({
    // Don't enforce the strong-password policy on the current password:
    // legacy accounts may predate it. Just bound the length.
    current_password: z
      .string()
      .min(1, 'Enter your current password.')
      .max(PASSWORD_MAX, 'Password is too long.'),
    new_password: newPassword,
    confirm_password: z.string().min(1, 'Confirm your new password.'),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    message: 'Passwords do not match.',
    path: ['confirm_password'],
  })
  .refine((v) => v.new_password !== v.current_password, {
    message: 'Choose a password different from your current one.',
    path: ['new_password'],
  })

export const changeEmailSchema = z.object({ email })

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>
