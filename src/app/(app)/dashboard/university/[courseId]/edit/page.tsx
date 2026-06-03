import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { getAdminCourse, listAdminCategories } from '@/lib/university/admin'
import { CourseEditor } from '../../_components/CourseEditor'

export const dynamic = 'force-dynamic'

export default async function EditCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>
}) {
  const { courseId } = await params

  const session = await getSession()
  if (session?.role !== 'superadmin') redirect('/dashboard')

  const [course, categories] = await Promise.all([
    getAdminCourse(courseId),
    listAdminCategories(),
  ])
  if (!course) notFound()

  return <CourseEditor mode="edit" course={course} categories={categories} />
}
