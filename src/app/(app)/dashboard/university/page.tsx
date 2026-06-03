import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { listAdminCourses, type AdminCourseListRow } from '@/lib/university/admin'
import { CourseList } from './_components/CourseList'

// Superadmin course list (CMS screen A — UNIVERSITY_BUILD_SPEC §5.2).
// Lists ALL courses including drafts; gated to superadmin.
export default async function UniversityAdminPage() {
  const session = await getSession()
  if (session?.role !== 'superadmin') redirect('/dashboard')

  let courses: AdminCourseListRow[] = []
  let loadError: string | null = null
  try {
    courses = await listAdminCourses()
  } catch (e) {
    loadError = e instanceof Error ? e.message : 'Failed to load courses.'
  }

  return <CourseList courses={courses} loadError={loadError} />
}
