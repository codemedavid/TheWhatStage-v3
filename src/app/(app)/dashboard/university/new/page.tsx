import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { listAdminCategories } from '@/lib/university/admin'
import { CourseEditor } from '../_components/CourseEditor'

export const dynamic = 'force-dynamic'

export default async function NewCoursePage() {
  const session = await getSession()
  if (session?.role !== 'superadmin') redirect('/dashboard')

  const categories = await listAdminCategories()

  return <CourseEditor mode="new" categories={categories} />
}
