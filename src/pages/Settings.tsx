import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BriefcaseBusiness, LogOut, Palette, Store, User as UserIcon, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useApp, useToast } from '../lib/store'
import type { Role } from '../lib/bazaar'
import { updateMe } from '../lib/api'
import { errorMessage } from '../lib/hooks'
import { Button, Card, Field, SectionHeading, inputClass } from '../components/ui'
import SkinPicker from '../components/SkinPicker'
import ServerStatus from '../components/ServerStatus'
import { PageHeader } from '../components/kit'
import { t } from '../i18n'

const ROLES: { value: Role; icon: LucideIcon }[] = [
  { value: 'client', icon: Store },
  { value: 'freelancer', icon: BriefcaseBusiness },
  { value: 'both', icon: Users },
]

/**
 * Hiring, selling, or both. Shared by registration and settings, so the choice reads the same
 * in both places — and so does the note that it is a choice of tools, not a permission.
 */
export function RolePicker({ value, onChange, compact }: { value: Role; onChange: (role: Role) => void; compact?: boolean }) {
  return (
    <div role="radiogroup" className={`grid gap-2 ${compact ? 'grid-cols-3' : 'sm:grid-cols-3'}`}>
      {ROLES.map(({ value: option, icon: Icon }) => {
        const on = option === value
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option)}
            className={`flex flex-col items-start gap-1 rounded-[var(--ui-radius-sm)] border p-3 text-left transition ${on ? 'border-[var(--color-accent-400)] fill-strong ring-2 ring-[var(--color-accent-400)]' : 'edge fill-soft hover:fill'}`}
          >
            <Icon size={17} className={on ? 'text-brand-500' : 'text-ink-400'} aria-hidden="true" />
            <span className="text-sm font-bold text-ink-900">{t(`role_${option}`)}</span>
            {!compact && <span className="text-xs leading-relaxed text-ink-500">{t(`role_${option}_note`)}</span>}
          </button>
        )
      })}
    </div>
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

      <Card className="space-y-4 p-5 sm:p-6">
        <SectionHeading title={t('how_you_use_brandyzer')} subtitle={t('role_is_a_choice')} icon={BriefcaseBusiness} />
        <RolePicker value={user.role} onChange={(role) => role !== user.role && void save({ role }, t('role_saved'))} />
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title={t('appearance')} subtitle={t('appearance_note')} icon={Palette} />
        <SkinPicker />
      </Card>

      <Card className="p-5 sm:p-6">
        <ServerStatus />
      </Card>

      <Button
        variant="danger"
        icon={LogOut}
        onClick={() => {
          void logout().then(() => navigate('/login'))
        }}
      >
        {t('sign_out')}
      </Button>
    </div>
  )
}
