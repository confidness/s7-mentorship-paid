import type { ContractStatus } from '../lib/bazaar'
import { formatMoney } from '../lib/money'
import { localeTag, t } from '../i18n'
import { Badge, type Tone } from './ui'

const STATUS_TONE: Record<ContractStatus, Tone> = {
  pending: 'neutral',
  funded: 'brand',
  in_review: 'warning',
  completed: 'success',
  canceled: 'neutral',
  refunded: 'danger',
}

export function StatusBadge({ status }: { status: ContractStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{t(`status_${status}`)}</Badge>
}

/** Dollars, in the interface's own number format. Every amount here is integer cents. */
export const usd = (cents: number) => formatMoney(cents, 'usd', localeTag())
