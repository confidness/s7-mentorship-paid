import { Link } from 'react-router-dom'
import { Palette, Plus } from 'lucide-react'
import { listKits } from '../../lib/api'
import { formatDate, useAsync } from '../../lib/hooks'
import { EmptyState, SkeletonCard, btn } from '../../components/ui'
import { ErrorNote, LogoTile, PageHeader, PaletteStrip } from '../../components/kit'
import { t } from '../../i18n'

/** The front door: every brand this person has made, and the button to make another. */
export default function StudioHome() {
  const { data: kits, error, loading } = useAsync(listKits, [])
  const create = (
    <Link to="/studio/new" className={btn('primary', 'md')}>
      <Plus size={17} aria-hidden="true" />
      {t('new_brand_kit')}
    </Link>
  )

  return (
    <div className="space-y-6">
      <PageHeader title={t('studio_title')} subtitle={t('studio_subtitle')} action={kits?.length ? create : undefined} />

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading && !kits ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : kits && kits.length === 0 ? (
        <EmptyState icon={Palette} title={t('no_kits_yet')} body={t('no_kits_yet_body')} action={create} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {kits?.map((kit) => (
            <li key={kit.id}>
              <Link to={`/studio/${kit.id}`} className="card flex h-full flex-col gap-4 p-5 transition hover:-translate-y-0.5">
                <div className="flex items-center gap-3.5">
                  <LogoTile kit={kit} size={52} />
                  <div className="min-w-0">
                    <p className="truncate text-[17px] font-bold tracking-[-0.02em] text-ink-900">{kit.brand_name}</p>
                    <p className="text-xs text-ink-500">{formatDate(kit.created_at)}</p>
                  </div>
                </div>
                {kit.vibe_summary && <p className="line-clamp-3 text-sm leading-relaxed text-ink-600">{kit.vibe_summary}</p>}
                <PaletteStrip palette={kit.palette_json} className="mt-auto h-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
