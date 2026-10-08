import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ClipboardList, Code2, Download, FileText, ListChecks, MessageSquareText, RotateCcw, Send } from 'lucide-react'
import { useApp, useToast } from '../../lib/store'
import { assignedLessons, customLessonById, submissionFor, userById } from '../../lib/selectors'
import { reachedServer } from '../../lib/submissions'
import type { AppState, CustomTask, LessonSubmission, TaskAnswer } from '../../lib/types'
import { Badge, Button, Card, EmptyState, SectionHeading, inputClass } from '../../components/ui'
import { t, formatDate, useLocale } from '../../i18n'
import Paywall from '../../components/Paywall'
import { getLessonContent } from '../../lib/api'
import { backendConfigured } from '../../lib/supabase'
import { formatMoney } from '../../lib/money'
import type { CustomLesson, LessonMaterial } from '../../lib/types'

const KIND_ICON = { quiz: ListChecks, code: Code2, open: MessageSquareText }
const KIND_LABEL = { quiz: 'task_kind_quiz', code: 'task_kind_code', open: 'task_kind_open' }
const STATUS_BADGE = {
  submitted: { tone: 'warning', label: 'awaiting_review' },
  needs_changes: { tone: 'warning', label: 'changes_requested' },
  reviewed: { tone: 'success', label: 'reviewed' },
} as const

/**
 * This student's hand-in for a lesson, if it counts as handed in.
 *
 * With a server, one the server never received does not: it was saved here by a build that
 * marked fetched lessons against an empty copy, and no mentor can see it. It is offered back as
 * a draft instead of sitting under "awaiting review" for good.
 */
function handedIn(state: AppState, lessonId: string, studentId: string): { sub?: LessonSubmission; unsent?: LessonSubmission } {
  const sub = submissionFor(state, lessonId, studentId)
  if (sub && backendConfigured && !reachedServer(sub)) return { unsent: sub }
  return { sub }
}

/* ------------------------------------------------------------------ list */

export default function Assigned() {
  const { state, user, standing } = useApp()
  const { locale } = useLocale()
  if (!user) return null
  const lessons = assignedLessons(state)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[28px] font-bold tracking-[-0.03em] text-ink-900">{t('mentor_assignments')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('material_and_questions_set_by_your_mentor')}</p>
      </header>

      {lessons.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t('nothing_assigned_yet')} body={t('when_your_mentor_publishes_a_lesson_it_appears_h')} />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {lessons.map((lesson) => {
            const done = handedIn(state, lesson.id, user.id).sub
            const author = userById(state, lesson.authorId)
            return (
              <li key={lesson.id}>
                <Link to={`/assigned/${lesson.id}`} className="block h-full">
                  <Card className="flex h-full flex-col p-5 transition hover:border-brand-300">
                    <div className="flex flex-wrap items-center gap-2">
                      {done ? (
                        <Badge tone={STATUS_BADGE[done.status].tone}>{t(STATUS_BADGE[done.status].label)}</Badge>
                      ) : (
                        <Badge tone="brand">{t('not_started')}</Badge>
                      )}
                      <Badge tone="neutral">{t('n_questions', { n: lesson.tasks.length })}</Badge>
                      {lesson.material && <Badge tone="accent">{t('has_material')}</Badge>}
                      {/* Price is shown before opening, so nobody clicks into a wall. */}
                      {lesson.priceCents > 0 &&
                        (standing.entitlements.includes(lesson.id) ? (
                          <Badge tone="success">{t('owned')}</Badge>
                        ) : (
                          <Badge tone="brand">{formatMoney(lesson.priceCents, lesson.currency, locale)}</Badge>
                        ))}
                    </div>
                    <h2 className="mt-3 text-base font-bold text-ink-900">{lesson.title}</h2>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-600">{lesson.summary}</p>
                    <p className="mt-auto pt-3 text-xs text-ink-500">{t('from_mentor', { name: author?.name ?? '' })}</p>
                  </Card>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ taking one */

export function AssignedLesson() {
  const { lessonId } = useParams()
  const { state, user, submitLessonAnswers, refreshSubmissions } = useApp()
  const toast = useToast()
  const local = customLessonById(state, lessonId)

  // A verdict may have landed since sign-in, and this is the page it is read on.
  useEffect(() => {
    void refreshSubmissions()
  }, [lessonId, refreshSubmissions])

  /**
   * Paid lessons are fetched, not read out of local state.
   *
   * The tasks and the material URL only exist server-side until an entitlement is confirmed,
   * so there is nothing in the browser to unlock by editing. A free lesson, or a run with no
   * backend configured, keeps using the local copy exactly as before.
   */
  const [remote, setRemote] = useState<{ tasks: CustomTask[]; material: LessonMaterial | null } | null>(null)
  const [locked, setLocked] = useState<{ title: string; summary: string; priceCents: number; currency: string } | null>(null)
  const [loading, setLoading] = useState(false)

  /**
   * Every lesson comes from the server now, not only the paid ones.
   *
   * The catalogue arrives as teasers with no tasks and no material link, because those are
   * what entitlement guards. The old condition fetched content only when a price was set, so
   * a FREE lesson written on another device rendered as a title with nothing under it.
   */
  const needsServer = backendConfigured

  useEffect(() => {
    if (!needsServer || !lessonId) return
    let alive = true
    setLoading(true)
    void getLessonContent(lessonId)
      .then((result) => {
        if (!alive) return
        if ('paywalled' in result) setLocked({ title: result.lesson.title, summary: result.lesson.summary, priceCents: result.lesson.priceCents, currency: result.lesson.currency })
        else {
          setLocked(null)
          setRemote({ tasks: result.tasks, material: result.material ?? null })
        }
      })
      .catch(() => alive && setLocked(null))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [needsServer, lessonId])

  // What the page renders from: the server's copy when there is one, the local copy otherwise.
  const lesson = useMemo(() => {
    if (!local) return undefined
    if (!remote) return local
    return { ...local, tasks: remote.tasks, material: remote.material ?? undefined } as CustomLesson
  }, [local, remote])

  const { sub: found, unsent } = user && lesson ? handedIn(state, lesson.id, user.id) : {}
  // Sent back is not done: the answers are open again, with the author's feedback above them.
  const sentBack = found?.status === 'needs_changes' ? found : undefined
  const done = found && !sentBack ? found : undefined
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  /**
   * Seeded once the real task list is known — for a paid lesson that is after the fetch.
   *
   * Answering again starts from what was sent, not from blank: the author asked for changes,
   * not for the whole thing written out a second time. Seeding stops the moment the student
   * types, so a refresh landing mid-answer cannot wipe what they wrote.
   */
  const prior = (sentBack ?? unsent)?.answers
  useEffect(() => {
    if (touched) return
    setAnswers(Object.fromEntries((lesson?.tasks ?? []).map((task) => [task.id, prior?.find((a) => a.taskId === task.id)?.value ?? (task.kind === 'code' ? (task.starter ?? '') : '')])))
  }, [lesson, prior, touched])
  const [error, setError] = useState('')

  const maxXp = useMemo(() => (lesson?.tasks ?? []).reduce((n, task) => n + task.points, 0), [lesson])

  if (!user) return null
  if (locked && lessonId) return <Paywall {...locked} lessonId={lessonId} />
  if (loading && !remote) return null
  if (!lesson || !lesson.published) return <EmptyState icon={FileText} title={t('lesson_not_found')} body={t('it_may_have_been_deleted')} />

  const answered = lesson.tasks.filter((task) => (answers[task.id] ?? '').trim() !== '').length
  const answer = (taskId: string, value: string) => {
    setTouched(true)
    setAnswers((a) => ({ ...a, [taskId]: value }))
  }

  async function submit() {
    if (answered < lesson!.tasks.length) {
      setError(t('answer_every_question_before_sending'))
      return
    }
    setError('')
    const payload: TaskAnswer[] = lesson!.tasks.map((task) => ({ taskId: task.id, value: answers[task.id] ?? '' }))
    setBusy(true)
    let result: LessonSubmission | undefined
    try {
      result = await submitLessonAnswers(lesson!.id, payload)
    } catch (err) {
      // Answers that did not reach the server are not handed in, whatever this page says.
      setBusy(false)
      toast({ title: t('could_not_submit'), body: err instanceof Error ? err.message : '', tone: 'error' })
      return
    }
    setBusy(false)
    if (!result) return toast({ title: t('could_not_submit'), tone: 'error' })
    setTouched(false)
    // The mark is whatever came back, never something worked out on this page.
    toast(
      result.status === 'reviewed'
        ? { title: t('notif_assignment_marked'), body: t('notif_assignment_marked_body', { title: lesson!.title, score: result.quizScore, total: result.quizTotal, xp: result.awardedXp ?? 0 }), tone: 'success' }
        : { title: t('answers_sent'), body: t('your_mentor_will_read_them'), tone: 'success' },
    )
  }

  return (
    <div className="space-y-6">
      <header>
        <Link to="/assigned" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 transition hover:text-brand-700">
          <ArrowLeft size={15} aria-hidden="true" />
          {t('mentor_assignments')}
        </Link>
        <h1 className="mt-3 text-[28px] font-bold tracking-[-0.03em] text-ink-900">{lesson.title}</h1>
        <p className="mt-1 text-sm text-ink-600">{lesson.summary}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="neutral">{t('n_questions', { n: lesson.tasks.length })}</Badge>
          <Badge tone="warning">{t('xp_available', { n: maxXp })}</Badge>
        </div>
      </header>

      {lesson.material && (
        <Card className="p-5">
          <SectionHeading title={t('teaching_material')} subtitle={t('read_this_before_answering')} icon={FileText} />
          <a
            href={lesson.material.url}
            download={lesson.material.name}
            className="mt-4 flex items-center gap-3 border edge fill px-4 py-3 transition hover:border-brand-300"
          >
            <FileText size={20} className="shrink-0 text-brand-600" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink-900">{lesson.material.name}</span>
              <span className="block text-xs text-ink-500">{t('n_kb', { n: Math.max(1, Math.round(lesson.material.size / 1024)) })}</span>
            </span>
            <Download size={16} className="shrink-0 text-ink-500" aria-hidden="true" />
          </a>
        </Card>
      )}

      {done ? (
        <Card className="p-6">
          <SectionHeading
            title={done.status === 'reviewed' ? t('reviewed') : t('awaiting_review')}
            subtitle={t('sent_on', { date: formatDate(done.submittedAt) })}
            icon={CheckCircle2}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {done.quizTotal > 0 && <Badge tone={done.quizScore === done.quizTotal ? 'success' : 'warning'}>{t('quiz_n_of_total', { n: done.quizScore, total: done.quizTotal })}</Badge>}
            {done.status === 'reviewed' && <Badge tone="brand">{t('plus_xp', { n: done.awardedXp ?? 0 })}</Badge>}
          </div>
          {done.feedback && (
            <p className="mt-4 border border-brand-200/70 bg-brand-100/50 px-4 py-3 text-sm leading-relaxed text-brand-800">{done.feedback}</p>
          )}

          <ol className="mt-5 space-y-3">
            {lesson.tasks.map((task, i) => (
              <li key={task.id} className="border edge fill-soft p-4">
                <Review task={task} index={i} value={done.answers.find((a) => a.taskId === task.id)?.value ?? ''} />
              </li>
            ))}
          </ol>
        </Card>
      ) : (
        <>
          {sentBack && (
            <Card className="p-6">
              <SectionHeading title={t('changes_requested')} subtitle={t('answers_sent_back_edit_and_resend')} icon={RotateCcw} />
              {sentBack.feedback && (
                <p className="mt-4 border border-brand-200/70 bg-brand-100/50 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-brand-800">{sentBack.feedback}</p>
              )}
            </Card>
          )}
          {unsent && (
            <p role="status" className="border border-amber-300/60 bg-amber-100/60 px-3.5 py-2.5 text-sm font-medium text-amber-800">
              {t('answers_never_reached_your_mentor')}
            </p>
          )}
          <ol className="space-y-4">
            {lesson.tasks.map((task, i) => {
              const Icon = KIND_ICON[task.kind]
              return (
                <li key={task.id}>
                  <Card className="p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-ink-900">{t('question_n', { n: i + 1 })}</span>
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500">
                        <Icon size={12} aria-hidden="true" />
                        {t(KIND_LABEL[task.kind])}
                      </span>
                      <span className="ml-auto text-xs font-semibold text-ink-500">{t('plus_xp', { n: task.points })}</span>
                    </div>
                    <p className="mt-2.5 text-sm leading-relaxed font-medium text-ink-900">{task.prompt}</p>

                    <div className="mt-4">
                      {task.kind === 'quiz' ? (
                        <ul className="space-y-2" role="radiogroup" aria-label={t('question_n', { n: i + 1 })}>
                          {(task.options ?? []).map((option, oi) => {
                            const picked = answers[task.id] === String(oi)
                            return (
                              <li key={oi}>
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={picked}
                                  onClick={() => answer(task.id, String(oi))}
                                  className={`flex w-full items-center gap-3 border px-4 py-3 text-left text-sm transition ${
                                    picked ? 'border-brand-400 bg-brand-100/60 font-semibold text-brand-800' : 'edge fill text-ink-700 hover:border-brand-300'
                                  }`}
                                >
                                  <span className={`grid h-5 w-5 shrink-0 place-items-center border-2 ${picked ? 'border-brand-600' : 'border-ink-300'}`}>
                                    {picked && <span className="h-2.5 w-2.5 bg-brand-600" />}
                                  </span>
                                  {option}
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      ) : task.kind === 'code' ? (
                        <textarea
                          className={`${inputClass} min-h-40 resize-y font-mono text-xs`}
                          value={answers[task.id] ?? ''}
                          onChange={(e) => answer(task.id, e.target.value)}
                          spellCheck={false}
                          aria-label={t('your_code_for_question_n', { n: i + 1 })}
                        />
                      ) : (
                        <textarea
                          className={`${inputClass} min-h-28 resize-y`}
                          value={answers[task.id] ?? ''}
                          onChange={(e) => answer(task.id, e.target.value)}
                          placeholder={t('write_your_answer')}
                          aria-label={t('your_answer_to_question_n', { n: i + 1 })}
                        />
                      )}
                    </div>
                  </Card>
                </li>
              )
            })}
          </ol>

          <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
            <p className="text-sm text-ink-600">{t('n_of_total_answered', { n: answered, total: lesson.tasks.length })}</p>
            <Button icon={Send} onClick={() => void submit()} loading={busy} disabled={lesson.tasks.length === 0}>
              {sentBack ? t('resubmit_with_changes') : t('send_answers')}
            </Button>
          </Card>
          {error && (
            <p role="alert" className="border border-rose-300/60 bg-rose-100/60 px-3.5 py-2.5 text-sm font-medium text-rose-700">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The student's own answer, shown back to them once it has been handed in.
 *
 * Right or wrong is shown only where this copy has the answer key, which is a lesson kept in
 * this browser with no server. A lesson fetched from the server never carries one — that is
 * the point of stripping it — so marking against it here called every answer wrong and named
 * the first option as the right one. The score the server worked out is on the card above.
 */
function Review({ task, index, value }: { task: CustomTask; index: number; value: string }) {
  const keyed = task.kind === 'quiz' && task.answerIndex !== undefined
  const correct = keyed && value !== '' && Number(value) === task.answerIndex
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-ink-900">{t('question_n', { n: index + 1 })}</span>
        {keyed && <Badge tone={correct ? 'success' : 'danger'}>{correct ? t('correct') : t('incorrect')}</Badge>}
      </div>
      <p className="mt-2 text-sm font-medium text-ink-900">{task.prompt}</p>
      {task.kind === 'quiz' ? (
        <p className="mt-2 text-sm text-ink-600">
          {t('chose_answer', { answer: (task.options ?? [])[Number(value)] ?? '—' })}
          {keyed && !correct && <span className="block text-emerald-700">{t('correct_answer_was', { answer: (task.options ?? [])[task.answerIndex ?? 0] ?? '—' })}</span>}
        </p>
      ) : task.kind === 'code' ? (
        <pre className="code-surface mt-2 overflow-x-auto p-3 font-mono text-xs whitespace-pre-wrap text-[#e2e8f0]">{value || t('left_blank')}</pre>
      ) : (
        <p className="mt-2 fill px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-ink-700">{value || t('left_blank')}</p>
      )}
    </>
  )
}
