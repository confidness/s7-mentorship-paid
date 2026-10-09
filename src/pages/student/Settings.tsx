import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, BookOpen, GraduationCap, LogOut, Palette, RefreshCw, Shield, User as UserIcon } from 'lucide-react'
import { useApp, useToast } from '../../lib/store'
import { profileOf } from '../../lib/selectors'
import { Button, Card, Field, Modal, SectionHeading, inputClass } from '../../components/ui'
import SkinPicker from '../../components/SkinPicker'
import BackdropPicker from '../../components/BackdropPicker'
import { ApiError, setTeaching } from '../../lib/api'
import { t, formatNumber } from '../../i18n'

export default function Settings() {
  const { state, user, standing, refreshStanding, setCurrentCourse, resetDemo, logout } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const [confirmReset, setConfirmReset] = useState(false)
  const [switching, setSwitching] = useState(false)

  /**
   * Flip the role, then re-read standing rather than assuming it worked.
   *
   * `refreshStanding` is what brings the navigation and the authoring tools with it — it
   * already reconciles the local mirror against the server's role in both directions, so
   * turning teaching on or off takes effect without a reload or a sign-out.
   */
  async function toggleTeaching(on: boolean) {
    setSwitching(true)
    try {
      await setTeaching(on)
      await refreshStanding()
      navigate(on ? '/m' : '/')
    } catch (error) {
      // Two failures worth naming, because each has a different thing to do about it: the
      // migration that has not run yet, and a build served without its serverless functions.
      const code = error instanceof ApiError ? error.code : ''
      const body = code === 'role_change_refused' ? t('role_change_refused') : code === 'api_unavailable' || code === 'not_configured' ? t('server_functions_not_running') : error instanceof Error ? error.message : ''
      toast({ title: t('something_went_wrong_try_again'), body, tone: 'error' })
    } finally {
      setSwitching(false)
    }
  }

  if (!user) return null

  const profile = profileOf(state, user.id)!

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-[28px] font-bold tracking-[-0.03em] text-ink-900">{t('settings')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('your_account_the_track_you_are_following_and_you')}</p>
      </header>

      <Card className="p-5 sm:p-6">
        <SectionHeading title={t('account')} icon={UserIcon} />
        <dl className="space-y-3 text-sm">
          {[
            { label: t('name'), value: user.name },
            { label: t('email'), value: user.email },
            { label: t('role'), value: t(user.role) },
            { label: t('level_xp'), value: formatNumber(profile.xp) },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 border-b edge pb-3">
              <dt className="text-ink-500">{row.label}</dt>
              <dd className="truncate font-semibold text-ink-900">{row.value}</dd>
            </div>
          ))}
        </dl>
        <Button variant="secondary" className="mt-4" onClick={() => navigate('/profile')}>
          {t('edit_profile_details')}
        </Button>
      </Card>

      {/* No application, no review, no waiting. The switch is the whole of it: publishing
          under your own name is what makes someone a mentor here, and the only thing still
          gated is taking money, which Stripe decides. */}
      <Card className="p-5 sm:p-6">
        <SectionHeading title={t('teach_on_s7')} subtitle={t('anyone_can_publish_here')} icon={GraduationCap} />
        <div className="mt-4 space-y-3">
          {standing.isMentor ? (
            <>
              <p className="border-2 border-ink-900 bg-emerald-100/60 px-3.5 py-3 text-sm font-medium text-ink-900">{t('you_are_teaching')}</p>
              <p className="text-sm text-ink-600">{t('stopping_hides_authoring_not_your_work')}</p>
              <Button variant="secondary" loading={switching} onClick={() => void toggleTeaching(false)}>
                {t('stop_teaching')}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-600">{t('paid_lessons_need_a_payout_account')}</p>
              <Button loading={switching} onClick={() => void toggleTeaching(true)}>
                {t('start_teaching')}
              </Button>
            </>
          )}
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title={t('appearance')} subtitle={t('appearance_note')} icon={Palette} />
        <SkinPicker />
        {/* Light and dark is the device's setting and has no control anywhere — this card is
            the other axis, what the interface is made of and what it is drawn on. */}
        <div className="mt-6">
          <BackdropPicker />
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title={t('current_track')} subtitle={t('the_course_your_dashboard_follows')} icon={BookOpen} />
        <Field label={t('active_course')}>
          <select
            className={inputClass}
            value={profile.currentCourseId}
            onChange={(e) => {
              setCurrentCourse(e.target.value)
              toast({ title: t('track_changed'), body: state.courses.find((c) => c.id === e.target.value)?.title, tone: 'success' })
            }}
          >
            {state.courses
              .filter((c) => profile.enrolledCourseIds.includes(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
          </select>
        </Field>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title={t('your_data')} subtitle={t('everything_you_do_is_stored_in_this_browser_only')} icon={Shield} />
        <div className="flex flex-wrap gap-2.5">
          <Button variant="secondary" icon={RefreshCw} onClick={() => setConfirmReset(true)}>
            {t('erase_my_data')}
          </Button>
          <Button
            variant="danger"
            icon={LogOut}
            onClick={() => {
              logout()
              navigate('/login')
            }}
          >
            {t('sign_out')}
          </Button>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-ink-500">
          {t('erasing_removes_every_account_project_and_xp_rec')}
        </p>
      </Card>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title={t('erase_everything_in_this_browser')}
        subtitle={t('accounts_projects_and_progress_stored_here_will_')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              {t('keep_my_data')}
            </Button>
            <Button
              variant="danger"
              icon={RefreshCw}
              onClick={() => {
                resetDemo()
                setConfirmReset(false)
                navigate('/login')
                toast({ title: t('data_erased'), body: t('the_platform_is_back_to_a_clean_install'), tone: 'info' })
              }}
            >
              {t('erase_everything')}
            </Button>
          </>
        }
      >
        <p className="flex items-start gap-3 border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t('this_cannot_be_undone_and_it_affects_every_accou')}
        </p>
      </Modal>
    </div>
  )
}
