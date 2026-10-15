import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { Spinner } from '../components/ui'
import NotFound from './NotFound'

/**
 * A published website, at /s/<address>. Public: no account needed to read it.
 *
 * The page is the stored html in an iframe with scripts off and its own opaque origin, so
 * nothing in it can touch the visitor's Brandyzer session. Links may open new tabs, and tel:
 * and Instagram links may take the whole tab when the visitor clicks them.
 */
export default function SitePage() {
  const { slug = '' } = useParams()
  const { data: html, loading } = useAsync(
    async () => {
      const { data } = await supabase().from('sites').select('html').eq('slug', slug).maybeSingle()
      return (data?.html as string | undefined) ?? null
    },
    [slug],
  )
  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner /></div>
  if (!html) return <NotFound />
  return <iframe title={slug} srcDoc={html} sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" className="fixed inset-0 z-50 h-full w-full border-0 bg-white" />
}
