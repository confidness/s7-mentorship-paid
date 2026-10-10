import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ImagePlus, PenLine, RefreshCw, Store, Trash2, Type } from 'lucide-react'
import { useApp, useToast } from '../../lib/store'
import { deleteKit, drawImage, getKit } from '../../lib/api'
import { errorMessage, useAsync } from '../../lib/hooks'
import { Button, Card, Modal, SectionHeading, SkeletonCard, Tabs, btn } from '../../components/ui'
import { ErrorNote, LogoTile, PageHeader, Swatches, TypeSpecimen, VoicePanel, useKitFonts } from '../../components/kit'
import { CopyPanel, ImagePanel } from './panels'
import { t } from '../../i18n'

/**
 * One brand kit, and the tools that use it.
 *
 * Locked in: the kit is generated once and then read. Rebuilding it means building a new one
 * beside it, so the brand a freelancer was handed last week is still the brand they have.
 * The logo is the exception — the first drawing is often not the one — and only the owner
 * may redraw it.
 */
export default function KitPage() {
  const { kitId = '' } = useParams()
  const { user } = useApp()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const { data: kit, error, loading, setData } = useAsync(() => getKit(kitId), [kitId])
  const [tab, setTab] = useState<'copy' | 'images'>('copy')
  const [drawing, setDrawing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  useKitFonts(kit?.typography_json)

  const owner = Boolean(kit && user && kit.user_id === user.id)

  async function redrawLogo(concept?: string) {
    if (!kit) return
    setDrawing(true)
    try {
      const { url } = await drawImage({ brandKitId: kit.id, purpose: 'logo', subject: concept })
      setData({ ...kit, logo_url: url })
    } catch (err) {
      toast({ title: t('logo_failed'), body: errorMessage(err), tone: 'error' })
    } finally {
      setDrawing(false)
    }
  }

  // Arriving straight from the builder: draw the first logo from the strategist's concept.
  // The state is cleared first, so a reload does not draw a second one.
  const drawn = useRef(false)
  useEffect(() => {
    const wanted = (location.state as { drawLogo?: string | boolean } | null)?.drawLogo
    if (!kit || !owner || kit.logo_url || !wanted || drawn.current) return
    drawn.current = true
    navigate(location.pathname, { replace: true, state: null })
    void redrawLogo(typeof wanted === 'string' ? wanted : undefined)
  }, [kit, owner])

  async function remove() {
    if (!kit) return
    setDeleting(true)
    try {
      await deleteKit(kit.id)
      toast({ title: t('kit_deleted'), tone: 'info' })
      navigate('/')
    } catch (err) {
      toast({ title: t('could_not_delete'), body: errorMessage(err), tone: 'error' })
      setDeleting(false)
    }
  }

  if (loading && !kit) return <SkeletonCard />
  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!kit) return <ErrorNote>{t('kit_not_found')}</ErrorNote>

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-ink-900">
        <ArrowLeft size={15} aria-hidden="true" />
        {t('studio_title')}
      </Link>

      <Card className="flex flex-wrap items-center gap-5 p-5 sm:p-6">
        <div className="relative">
          <LogoTile kit={kit} size={96} />
          {drawing && <span className="skeleton absolute inset-0 rounded-[var(--ui-radius-sm)]" aria-hidden="true" />}
        </div>
        <div className="min-w-0 flex-1">
          <PageHeader title={kit.brand_name} subtitle={kit.vibe_summary} />
          {!owner && <p className="mt-2 text-xs font-semibold text-ink-500">{t('shared_with_you_on_a_contract')}</p>}
        </div>
        {owner && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={RefreshCw} loading={drawing} onClick={() => void redrawLogo()}>
              {kit.logo_url ? t('redraw_logo') : t('draw_logo')}
            </Button>
            <Link to="/bazaar" className={btn('secondary', 'sm')}>
              <Store size={15} aria-hidden="true" />
              {t('hire_with_this_kit')}
            </Link>
          </div>
        )}
      </Card>

      <Card className="p-5 sm:p-6">
        <SectionHeading title={t('palette')} subtitle={t('click_a_colour_to_copy')} />
        <Swatches palette={kit.palette_json} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5 sm:p-6">
          <SectionHeading title={t('typography')} icon={Type} />
          <TypeSpecimen typography={kit.typography_json} brandName={kit.brand_name} sample={kit.voice_rules_json.examples[0]} />
        </Card>
        <Card className="p-5 sm:p-6">
          <SectionHeading title={t('voice_and_photos')} />
          <VoicePanel voice={kit.voice_rules_json} />
        </Card>
      </div>

      <section className="space-y-4">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'copy', label: t('write_copy'), icon: PenLine },
            { id: 'images', label: t('make_images'), icon: ImagePlus },
          ]}
        />
        {tab === 'copy' ? <CopyPanel kitId={kit.id} /> : <ImagePanel kitId={kit.id} />}
      </section>

      {owner && (
        <div className="border-t edge pt-6">
          <Button variant="ghost" icon={Trash2} onClick={() => setConfirmDelete(true)}>
            {t('delete_kit')}
          </Button>
        </div>
      )}

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('delete_kit_title', { name: kit.brand_name })}
        subtitle={t('delete_kit_body')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t('keep_it')}
            </Button>
            <Button variant="danger" icon={Trash2} loading={deleting} onClick={() => void remove()}>
              {t('delete_kit')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">{t('delete_kit_contracts_note')}</p>
      </Modal>
    </div>
  )
}
