import type { CustomLesson } from './types'

/**
 * Finding a course without a model.
 *
 * The AI advisor is the nice path and it is the one that will be down: no key configured, no
 * credit left, a flaky network, a student on the metro. So the ranking lives here, as a pure
 * function over the catalogue, and the model is a layer on top of it rather than the thing it
 * depends on. Everything below runs offline, synchronously, with no fetch and no state.
 *
 * It is also what the model is *given*. A language model asked to recommend a course will
 * cheerfully invent one; passing it a shortlist this file produced, and asking it to choose
 * among those, is the difference between advice and fiction.
 *
 * Four things describe a course here — direction, price, length and format — and only price
 * is stored. The other three are derived, which is a deliberate trade: a mentor publishing in
 * three minutes will not fill in a taxonomy, and a filter nobody populates is a filter that
 * returns nothing. Derivation is wrong sometimes; an empty dropdown is wrong always.
 */

/* ------------------------------------------------------------------ direction */

export type DirectionId =
  | 'programming'
  | 'design'
  | 'data'
  | 'languages'
  | 'business'
  | 'science'
  | 'music'
  | 'health'
  | 'craft'
  | 'other'

interface Direction {
  id: DirectionId
  /**
   * Keywords in all three languages the platform speaks.
   *
   * Written as alternation rather than `\b...\b` on purpose: Russian and Kazakh inflect, so
   * "дизайн" has to match "дизайна" and "дизайнер". A prefix match over-matches a little;
   * a word-boundary match misses most of the language.
   */
  match: RegExp
}

/**
 * The taxonomy, ordered. First match wins, so the specific sit above the general — "data
 * science" is data rather than science, and "game design" is design rather than programming.
 */
export const DIRECTIONS: Direction[] = [
  { id: 'data', match: /data scien|machine learn|deep learn|neural|statistic|analytic|дата|данн|машинн обуч|машинного обучения|нейросет|статистик|аналитик|дерекқор|деректер/i },
  { id: 'design', match: /design|figma|ux|ui\b|typograph|illustrat|drawing|paint|дизайн|график|рисова|рисуй|портрет|иллюстрац|типограф|шрифт|сурет салу|дизайнер/i },
  { id: 'programming', match: /program|coding|code|develop|javascript|typescript|python|java\b|c\+\+|react|backend|frontend|web\b|app\b|robot|arduino|програм|кодинг|разработ|сайт|приложен|бэкенд|фронтенд|робот|бағдарламалау|кодтау/i },
  { id: 'languages', match: /english|spanish|german|french|chinese|ielts|toefl|language|grammar|англ|испан|немец|француз|китайск|язык|грамматик|ағылшын|тіл\b|тілі/i },
  { id: 'business', match: /business|marketing|startup|finance|budget|money|invest|manage|product|sales|бизнес|маркетинг|стартап|финанс|бюджет|деньг|доход|инвест|менеджмент|продаж|продукт|кәсіп|қаржы|ақша|бюджет/i },
  { id: 'science', match: /physic|chemistr|biolog|math|algebra|geometr|calculus|astronom|физик|хими|биолог|математик|алгебр|геометр|астроном|матем|физика|ғылым/i },
  { id: 'music', match: /music|guitar|piano|vocal|sing|produc(er|tion) music|beat|музык|гитар|фортепиано|пианино|вокал|пение|бит\b|ән\b|музыка/i },
  { id: 'health', match: /fitness|workout|yoga|nutrition|health|sport|running|medit|фитнес|трениров|йога|питани|здоров|спорт|бег\b|медитац|дене шынықтыру|денсаулық/i },
  { id: 'craft', match: /cook|baking|photo|video|craft|sewing|wood|pottery|makeup|готовк|готови|рецепт|блюд|кулинар|выпечк|фото|видео|ремесл|шить|шитьё|дерев|керамик|макияж|аспаз|фотограф/i },
]

/** Every direction, plus the catch-all, in the order a filter should list them. */
export const DIRECTION_IDS: DirectionId[] = [...DIRECTIONS.map((d) => d.id), 'other']

/** What this course is about, read off its own words. */
export function directionOf(lesson: Pick<CustomLesson, 'title' | 'summary'>): DirectionId {
  const text = `${lesson.title} ${lesson.summary}`
  return DIRECTIONS.find((d) => d.match.test(text))?.id ?? 'other'
}

/* ------------------------------------------------------------------ format */

/** What doing this course actually consists of. */
export type FormatId = 'quiz' | 'practice' | 'coding' | 'reading'

/**
 * The shape of the work, from the questions the mentor wrote.
 *
 * `reading` is the honest answer for a lesson with material and no tasks — it is something to
 * read, and calling it a course with exercises would be a small lie in a filter people use to
 * decide how to spend an evening.
 */
export function formatOf(lesson: Pick<CustomLesson, 'tasks' | 'material'>): FormatId {
  const tasks = lesson.tasks ?? []
  if (!tasks.length) return 'reading'
  if (tasks.some((task) => task.kind === 'code')) return 'coding'
  if (tasks.every((task) => task.kind === 'quiz')) return 'quiz'
  return 'practice'
}

/* ------------------------------------------------------------------ length */

/**
 * Minutes, estimated from the work the course contains.
 *
 * Nobody writes down how long their course takes, and if there were a field for it the
 * numbers would be marketing. Counting the actual questions is at least measuring something:
 * a quiz item is quick, an open question needs thinking, a coding task needs an editor and a
 * few false starts. Material adds reading time on top.
 *
 * These weights are a guess with a known error bar, and the UI says "about" for that reason.
 */
const MINUTES: Record<string, number> = { quiz: 2, open: 10, code: 25 }
const MATERIAL_MINUTES = 12

export function minutesOf(lesson: Pick<CustomLesson, 'tasks' | 'material'>): number {
  const work = (lesson.tasks ?? []).reduce((total, task) => total + (MINUTES[task.kind] ?? 8), 0)
  return Math.max(5, work + (lesson.material ? MATERIAL_MINUTES : 0))
}

export type LengthId = 'short' | 'medium' | 'long'

/** Under half an hour, an evening, or a project. */
export function lengthOf(lesson: Pick<CustomLesson, 'tasks' | 'material'>): LengthId {
  const minutes = minutesOf(lesson)
  return minutes <= 30 ? 'short' : minutes <= 90 ? 'medium' : 'long'
}

/* ------------------------------------------------------------------ text */

/**
 * Lowercase, unaccented, punctuation gone.
 *
 * `NFD` then stripping combining marks folds é to e and, more to the point here, Kazakh ә ғ
 * қ ң ө ұ ү һ і to their bare forms — so someone typing on a Russian keyboard still finds a
 * Kazakh title. Cyrillic ё folds to е the same way.
 */
const normalise = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const tokens = (text: string) => normalise(text).split(' ').filter(Boolean)

/**
 * How well one query word matches one field word.
 *
 * Prefix rather than equality, because every language here inflects and a student types the
 * dictionary form: "гитар" should find "гитары", "design" should find "designer". Short
 * tokens are required to match exactly — two letters as a prefix match nearly everything.
 */
function wordScore(queryWord: string, fieldWord: string): number {
  if (queryWord === fieldWord) return 1
  if (queryWord.length < 3) return 0
  if (fieldWord.startsWith(queryWord)) return 0.8
  if (queryWord.startsWith(fieldWord) && fieldWord.length >= 4) return 0.6
  return 0
}

/** The best any word in this field does against one query word. */
function fieldScore(queryWord: string, field: string[]): number {
  let best = 0
  for (const word of field) {
    const score = wordScore(queryWord, word)
    if (score > best) best = score
    if (best === 1) break
  }
  return best
}

/* ------------------------------------------------------------------ search */

export interface Filters {
  /** Free text. Empty means "everything", ranked by the tie-breakers below. */
  query?: string
  direction?: DirectionId | 'all'
  format?: FormatId | 'all'
  length?: LengthId | 'all'
  /** In minor units, like every other price here. Undefined means no ceiling. */
  maxPriceCents?: number
  freeOnly?: boolean
}

export interface Match {
  lesson: CustomLesson
  score: number
  direction: DirectionId
  format: FormatId
  minutes: number
}

/** A title hit means more than the same word buried in a summary. */
const WEIGHT = { title: 3, summary: 1.4, author: 1 }

/**
 * Rank the catalogue against a query and a set of filters.
 *
 * Filters exclude; the query orders. That split matters: someone who ticks "free" means it,
 * and a paid course creeping into the results because it matched the words better is the
 * search arguing with them. Text relevance only decides what comes first among the courses
 * they said they would consider.
 */
export function searchLessons(lessons: CustomLesson[], filters: Filters = {}): Match[] {
  const queryWords = tokens(filters.query ?? '')

  const out: Match[] = []
  for (const lesson of lessons) {
    const direction = directionOf(lesson)
    const format = formatOf(lesson)
    const minutes = minutesOf(lesson)
    const length = lengthOf(lesson)

    if (filters.direction && filters.direction !== 'all' && direction !== filters.direction) continue
    if (filters.format && filters.format !== 'all' && format !== filters.format) continue
    if (filters.length && filters.length !== 'all' && length !== filters.length) continue
    if (filters.freeOnly && lesson.priceCents > 0) continue
    if (filters.maxPriceCents !== undefined && lesson.priceCents > filters.maxPriceCents) continue

    let score = 0
    if (queryWords.length) {
      const title = tokens(lesson.title)
      const summary = tokens(lesson.summary)
      const author = tokens(lesson.authorName ?? '')
      let matched = 0
      for (const word of queryWords) {
        const best = WEIGHT.title * fieldScore(word, title) + WEIGHT.summary * fieldScore(word, summary) + WEIGHT.author * fieldScore(word, author)
        if (best > 0) matched++
        score += best
      }
      // Nothing in the query landed anywhere. A result that matches none of what was asked
      // for is noise, however well it scores on the tie-breakers below.
      if (!matched) continue
      // Every word found beats one word found loudly — two terms usually means both matter.
      score *= matched / queryWords.length
    }

    // Tie-breakers, small enough not to overturn a real text match. Free first, because a
    // free course is the one a browsing student can actually start right now; then newer.
    if (lesson.priceCents <= 0) score += 0.35
    score += Math.min(0.3, (lesson.tasks?.length ?? 0) * 0.05)

    /**
     * A course other people have taken, nudged up. Capped hard, and here is why.
     *
     * The contract at the top of this file is that filters exclude and the query orders. A
     * popularity term large enough to outrank a title match would quietly rewrite that into
     * "the query and the popularity contest argue", and every existing test would still
     * pass. 0.2 keeps it inside the same band as the two tie-breakers above.
     *
     * Reply time is deliberately *not* in here. Ranking on speed pays for speed, and the
     * cheapest way to be fast is to reject without reading. It is shown on the card and
     * nowhere else.
     *
     * Absence is not a penalty. A lesson with no stats — which is every lesson when the
     * backend is unconfigured, the case this whole file exists for — scores exactly as it
     * did before any of this was added.
     */
    const taken = (lesson.stats?.buyers ?? 0) + (lesson.stats?.starters ?? 0)
    if (taken > 0) score += Math.min(0.2, Math.log10(1 + taken) * 0.1)

    out.push({ lesson, score, direction, format, minutes })
  }

  return out.sort((a, b) => b.score - a.score || b.lesson.createdAt.localeCompare(a.lesson.createdAt))
}

/**
 * A shortlist to hand the advisor.
 *
 * Deliberately small. The catalogue goes into a prompt, and a prompt that carries two hundred
 * courses costs real money per question and buries the relevant ones in the middle, which is
 * where models stop reading.
 */
export function shortlistFor(lessons: CustomLesson[], question: string, limit = 12): Match[] {
  const direct = searchLessons(lessons, { query: question })
  if (direct.length >= limit) return direct.slice(0, limit)

  /**
   * Pad, never replace.
   *
   * One strong match and nothing else is a common and awkward case: too thin to be a list of
   * options, and far too good to throw away — which an earlier version did, falling back to
   * the whole catalogue and burying the one course the person actually asked about under the
   * free ones. The matches keep their order at the front; the rest is context the advisor
   * can offer as alternatives.
   */
  const taken = new Set(direct.map((m) => m.lesson.id))
  const rest = searchLessons(lessons).filter((m) => !taken.has(m.lesson.id))
  return [...direct, ...rest].slice(0, limit)
}

/** One line per course, for the prompt. Short on purpose — this is paid for by the token. */
export function describeForPrompt(match: Match): string {
  const price = match.lesson.priceCents > 0 ? `${(match.lesson.priceCents / 100).toFixed(2)} ${match.lesson.currency.toUpperCase()}` : 'free'
  return `${match.lesson.id} | ${match.lesson.title} | ${match.direction} | ${match.format} | ~${match.minutes} min | ${price} | ${match.lesson.summary.slice(0, 140)}`
}
