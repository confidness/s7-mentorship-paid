import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import { formatDate as i18nDate, t } from '../i18n'
import { ApiError } from './api'

/**
 * One read, with its loading and error states, re-run when its inputs change.
 *
 * A late answer for an earlier input is dropped rather than shown: open one contract, then
 * another before the first has loaded, and the page must not end up showing the first.
 */
export function useAsync<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const run = useRef(0)

  // The caller's deps are the contract; `load` is a fresh closure every render.
  const reload = useCallback(async () => {
    const id = ++run.current
    setLoading(true)
    setError('')
    try {
      const value = await load()
      if (id === run.current) setData(value)
    } catch (err) {
      if (id === run.current) setError(errorMessage(err))
    } finally {
      if (id === run.current) setLoading(false)
    }
  }, deps)

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, error, loading, reload, setData }
}

/** What to tell a person when something they asked for failed. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'api_unavailable' || err.code === 'not_configured') return t('server_functions_not_running')
    return err.message
  }
  return err instanceof Error && err.message ? err.message : t('something_went_wrong_try_again')
}

export const relativeTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return t('just_now')
  if (mins < 60) return t('minutes_ago', { n: mins })
  const hours = Math.round(mins / 60)
  if (hours < 24) return t('hours_ago', { n: hours })
  const days = Math.round(hours / 24)
  if (days === 1) return t('yesterday')
  if (days < 30) return t('days_ago', { n: days })
  return i18nDate(iso)
}

export const formatDate = (iso: string) => i18nDate(iso)
