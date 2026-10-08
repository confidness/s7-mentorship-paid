import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import Layout from './components/Layout'
import { useApp } from './lib/store'

import Login from './pages/Login'
import Landing from './pages/Landing'
import Assigned, { AssignedLesson } from './pages/student/Assigned'
import MentorLessons, { LessonSubmissions } from './pages/mentor/MentorLessons'
import LessonBuilder from './pages/mentor/LessonBuilder'
import EventBuilder from './pages/mentor/EventBuilder'
import NotFound from './pages/NotFound'

import Dashboard from './pages/student/Dashboard'
import Courses from './pages/student/Courses'
import CourseDetail from './pages/student/CourseDetail'
import LessonPage from './pages/student/Lesson'
import MyLearning from './pages/student/MyLearning'
import Projects from './pages/student/Projects'
import Requests from './pages/student/Requests'
import ProjectDetail from './pages/student/ProjectDetail'
import Achievements from './pages/student/Achievements'
import Gallery from './pages/student/Gallery'
import Competition from './pages/student/Competition'
import AIMentor from './pages/student/AIMentor'
import Profile from './pages/student/Profile'
import StudentSettings from './pages/student/Settings'

import MentorDashboard from './pages/mentor/Dashboard'
import MentorStudents from './pages/mentor/Students'
import MentorGroups from './pages/mentor/Groups'
import MentorReviews from './pages/mentor/Reviews'
import ReviewDetail from './pages/mentor/ReviewDetail'
import MentorProjects from './pages/mentor/Projects'
import MentorAnalytics from './pages/mentor/Analytics'
import { MentorCourses, MentorCompetition, MentorSettings } from './pages/mentor/Misc'
import Payouts from './pages/mentor/Payouts'

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
