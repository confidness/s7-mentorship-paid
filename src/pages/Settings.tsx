import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Palette, Sparkles, Trash2, User as UserIcon } from 'lucide-react'
import { useApp, useToast } from '../lib/store'
import { deleteAccount, getPlan, proCheckoutUrl, updateMe } from '../lib/api'
import { PLAN_LIMITS, PRO_PRICE_USD, USAGE_KINDS } from '../lib/plans'
import { errorMessage, useAsync } from '../lib/hooks'
import { Button, Card, Field, Modal, ProgressBar, SectionHeading, btn, inputClass } from '../components/ui'
import SkinPicker from '../components/SkinPicker'
import ServerStatus from '../components/ServerStatus'
import { PageHeader } from '../components/kit'
import { t } from '../i18n'

/**
 * Free or Pro, this month's use against the plan's limits, and the way to change plan.
 *
 * Upgrading is Lemon Squeezy's hosted checkout; its webhook is what makes somebody Pro, so a
 * page opened straight after paying may still say Free for a few seconds. Managing or
 * cancelling is Lemon Squeezy's own customer page, reached with the email the buyer used.
 */
function PlanCard({ user }: { user: { id: string; email: string } }) {
  const { data } = useAsync(() => getPlan(user.id), [user.id])
  const plan = data?.plan ?? 'free'
  const limits = PLAN_LIMITS[plan]
  const { data: checkout } = useAsync(() => (plan === 'pro' ? Promise.resolve(null) : proCheckoutUrl()), [user.id, plan])

  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <SectionHeading
        title={plan === 'pro' ? t('plan_pro') : t('plan_free')}
        subtitle={plan === 'pro' && data?.proUntil ? t('pro_until', { date: new Date(data.proUntil).toLocaleDateString() }) : t('plan_resets_monthly')}
        icon={Sparkles}
      />
      <div className="space-y-3">
        {USAGE_KINDS.map((kind) => (
          <div key={kind} className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-ink-700">{t(`usage_${kind}`)}</span>
              <span className="font-semibold text-ink-900 tabular-nums">
                {data?.used[kind] ?? 0} / {limits[kind]}
              </span>
            </div>
            <ProgressBar value={((data?.used[kind] ?? 0) / limits[kind]) * 100} size="sm" label={t(`usage_${kind}`)} />
          </div>
        ))}
      </div>
      {plan === 'pro' ? (
        <a href="https://app.lemonsqueezy.com/my-orders" target="_blank" rel="noreferrer" className={btn('secondary')}>
          {t('manage_subscription')}
        </a>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-600">{t('pro_includes', { kit: PLAN_LIMITS.pro.kit, copy: PLAN_LIMITS.pro.copy, image: PLAN_LIMITS.pro.image })}</p>
          {checkout ? (
            <a href={checkout} className={btn('primary')}>
              {t('upgrade_to_pro', { price: PRO_PRICE_USD })}
            </a>
          ) : (
            <p className="text-sm text-ink-500">{t('pro_not_open_yet')}</p>
          )}
        </div>
      )}
    </Card>
  )
}

/** Asks once, then deletes. The server refuses while Pro still bills, or with Bazaar contracts, and says why. */
function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    try {
      await deleteAccount()
      onDeleted()
    } catch (err) {
      setBusy(false)
      setOpen(false)
      toast({ title: t('could_not_delete'), body: errorMessage(err), tone: 'error' })
    }
  }

  return (
    <>
      <Button variant="ghost" icon={Trash2} onClick={() => setOpen(true)}>
        {t('delete_account')}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('delete_account_title')}
        subtitle={t('delete_account_body')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('keep_it')}
            </Button>
            <Button variant="danger" icon={Trash2} loading={busy} onClick={() => void remove()}>
              {t('delete_account')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">{t('delete_account_note')}</p>
      </Modal>
    </>
  )
}

export default function Settings() {
  const { user, refreshMe, logout } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const [name, setName] = useState(user?.name ?? '')
  const [bio, setBio] = useState(user?.bio ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(user?.name ?? '')
    setBio(user?.bio ?? '')
  }, [user?.name, user?.bio])

  if (!user) return null

  async function save(patch: Parameters<typeof updateMe>[0], done: string) {
    setSaving(true)
    try {
      await updateMe(patch)
      await refreshMe()
      toast({ title: done, tone: 'success' })
    } catch (err) {
      toast({ title: t('could_not_save'), body: errorMessage(err), tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title={t('nav_settings')} subtitle={t('settings_subtitle')} />

      <PlanCard user={user} />

      <Card className="space-y-4 p-5 sm:p-6">
        <SectionHeading title={t('profile')} subtitle={user.email} icon={UserIcon} />
        <Field label={t('your_name')}>
          <input className={inputClass} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('bio')} hint={t('bio_hint')}>
          <textarea className={`${inputClass} min-h-24`} value={bio} maxLength={2000} onChange={(e) => setBio(e.target.value)} />
        </Field>
        <Button loading={saving} disabled={name.trim().length < 1} onClick={() => void save({ name: name.trim(), bio: bio.trim() || null }, t('profile_saved'))}>
          {t('save')}
        </Button>
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title={t('appearance')} subtitle={t('appearance_note')} icon={Palette} />
        <SkinPicker />
      </Card>

      <Card className="p-5 sm:p-6">
        <ServerStatus />
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button
          variant="danger"
          icon={LogOut}
          onClick={() => {
            void logout().then(() => navigate('/login'))
          }}
        >
          {t('sign_out')}
        </Button>
        <DeleteAccount
          onDeleted={() => {
            toast({ title: t('account_deleted'), tone: 'success' })
            void logout().then(() => navigate('/login'))
          }}
        />
      </div>
    </div>
  )
}
