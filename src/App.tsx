import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { lazy, type ReactNode } from 'react'
import Layout from './components/Layout'
import { useApp } from './lib/store'

// Eager: the first screen anyone signed out sees, and the one that renders outside the
// layout's Suspense boundary. Login already shares most of its weight with the chrome, so
// splitting it off would add a round trip before the first paint to save a few kilobytes.
import Login from './pages/Login'
// Eager for the same reason: the front door a signed-out visitor lands on at `/`.
import Landing from './pages/Landing'
import NotFound from './pages/NotFound'

// Everything else loads when it is first opened. A student never needs the lesson builder,
// a mentor reviewing work never needs the course advisor, and nobody needs every screen
// before they can see the first. Layout keeps its chrome up while a screen arrives.
const Assigned = lazy(() => import('./pages/student/Assigned'))
const AssignedLesson = lazy(() => import('./pages/student/Assigned').then((m) => ({ default: m.AssignedLesson })))
const MentorLessons = lazy(() => import('./pages/mentor/MentorLessons'))
const LessonSubmissions = lazy(() => import('./pages/mentor/MentorLessons').then((m) => ({ default: m.LessonSubmissions })))
const LessonBuilder = lazy(() => import('./pages/mentor/LessonBuilder'))
const EventBuilder = lazy(() => import('./pages/mentor/EventBuilder'))

const Dashboard = lazy(() => import('./pages/student/Dashboard'))
const Courses = lazy(() => import('./pages/student/Courses'))
const CourseDetail = lazy(() => import('./pages/student/CourseDetail'))
const LessonPage = lazy(() => import('./pages/student/Lesson'))
const MyLearning = lazy(() => import('./pages/student/MyLearning'))
const Projects = lazy(() => import('./pages/student/Projects'))
const Requests = lazy(() => import('./pages/student/Requests'))
const ProjectDetail = lazy(() => import('./pages/student/ProjectDetail'))
const Achievements = lazy(() => import('./pages/student/Achievements'))
const Gallery = lazy(() => import('./pages/student/Gallery'))
const Competition = lazy(() => import('./pages/student/Competition'))
const AIMentor = lazy(() => import('./pages/student/AIMentor'))
const Profile = lazy(() => import('./pages/student/Profile'))
const StudentSettings = lazy(() => import('./pages/student/Settings'))

const MentorDashboard = lazy(() => import('./pages/mentor/Dashboard'))
const MentorStudents = lazy(() => import('./pages/mentor/Students'))
const MentorGroups = lazy(() => import('./pages/mentor/Groups'))
const MentorReviews = lazy(() => import('./pages/mentor/Reviews'))
const ReviewDetail = lazy(() => import('./pages/mentor/ReviewDetail'))
const MentorProjects = lazy(() => import('./pages/mentor/Projects'))
const MentorAnalytics = lazy(() => import('./pages/mentor/Analytics'))
const MentorCourses = lazy(() => import('./pages/mentor/Misc').then((m) => ({ default: m.MentorCourses })))
const MentorCompetition = lazy(() => import('./pages/mentor/Misc').then((m) => ({ default: m.MentorCompetition })))
const MentorSettings = lazy(() => import('./pages/mentor/Misc').then((m) => ({ default: m.MentorSettings })))
const Payouts = lazy(() => import('./pages/mentor/Payouts'))

/**
 * Signed in, and for `/m` also teaching.
 *
 * The learner side is open to everybody. It used to bounce a mentor back to `/m`, which made
 * sense when teaching was a status granted after review — now that anyone can switch it on,
 * a mentor is simply somebody who also publishes, and locking them out of the catalogue
 * would mean they could not take a course on the platform they teach on.
 *
 * Signed out, the bare address and a deep link are different visitors. Somebody typing the
 * domain or following it from a search has not been told what this is yet, so `/` goes to
 * the front door. Somebody following a link to one lesson already knows, and wants that
 * lesson — they still go straight to sign-in, exactly as before.
 */
function Protected({ mentor, children }: { mentor?: boolean; children: ReactNode }) {
  const { user } = useApp()
  const location = useLocation()
  if (!user && location.pathname === '/') return <Navigate to="/welcome" replace />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (mentor && user.role !== 'mentor') return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const { user } = useApp()
  const home = user?.role === 'mentor' ? '/m' : '/'

  return (
    <Routes>
      {/* Public, and only while signed out: anybody signed in is sent home from all three. */}
      <Route path="/welcome" element={user ? <Navigate to={home} replace /> : <Landing />} />
      <Route path="/login" element={user ? <Navigate to={home} replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to={home} replace /> : <Login register />} />

      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        {/* The catalogue is the front door: what there is to learn here, before anything
            about one account's progress. `/courses` still resolves to the same page so old
            links keep working. */}
        <Route path="/" element={<Courses />} />
        <Route path="/courses" element={<Navigate to="/" replace />} />
        {/* The demand board sits beside the catalogue: what there is to learn, and what
            there is not yet. Both sides of the marketplace read the same page. */}
        <Route path="/requests" element={<Requests />} />
        <Route path="/courses/:courseId" element={<CourseDetail />} />
        <Route path="/learn/:courseId/:lessonId" element={<LessonPage />} />
        {/* Progress used to be the home page. It is the first tab of Learning now. */}
        <Route path="/learning" element={<Dashboard />} />
        <Route path="/learning/courses" element={<MyLearning />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:projectId" element={<ProjectDetail />} />
        <Route path="/achievements" element={<Achievements />} />
        <Route path="/gallery" element={<Gallery />} />
        <Route path="/competition" element={<Competition />} />
        <Route path="/ai" element={<AIMentor />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/assigned" element={<Assigned />} />
        <Route path="/assigned/:lessonId" element={<AssignedLesson />} />
        <Route path="/settings" element={<StudentSettings />} />
      </Route>

      <Route
        path="/m"
        element={
          <Protected mentor>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<MentorDashboard />} />
        <Route path="groups" element={<MentorGroups />} />
        <Route path="students" element={<MentorStudents />} />
        <Route path="students/:studentId" element={<MentorStudents />} />
        <Route path="reviews" element={<MentorReviews />} />
        <Route path="reviews/:projectId" element={<ReviewDetail />} />
        <Route path="projects" element={<MentorProjects />} />
        <Route path="courses" element={<MentorCourses />} />
        <Route path="competition" element={<MentorCompetition />} />
        <Route path="competition/new" element={<EventBuilder />} />
        <Route path="competition/:competitionId/edit" element={<EventBuilder />} />
        <Route path="analytics" element={<MentorAnalytics />} />
        <Route path="requests" element={<Requests />} />
        <Route path="lessons" element={<MentorLessons />} />
        <Route path="lessons/new" element={<LessonBuilder />} />
        <Route path="lessons/:lessonId" element={<LessonSubmissions />} />
        <Route path="lessons/:lessonId/edit" element={<LessonBuilder />} />
        <Route path="settings" element={<MentorSettings />} />
        <Route path="payouts" element={<Payouts />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
