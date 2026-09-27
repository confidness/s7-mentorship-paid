import { StrictMode } from 'react'
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import Crash from './components/Crash'
import { AppProvider } from './lib/store'
import { LocaleProvider } from './i18n'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Outermost, above the store: a crash while the provider is building state is exactly
        the case that used to render nothing at all. */}
    <Crash>
      <BrowserRouter>
        {/* Only the DOM animation features, which is what this interface uses — 14 kB gzipped
            cheaper than the whole library. `strict` makes a stray `motion.div` throw with an
            explanation instead of quietly pulling the rest of it back into the bundle. */}
        <LazyMotion features={domAnimation} strict>
          {/* One place decides how motion behaves for someone who asked for less of it: the
              reduced-motion rule in index.css reaches CSS animation and nothing driven by JS. */}
          <MotionConfig reducedMotion="user">
            <LocaleProvider>
              <AppProvider>
                <App />
              </AppProvider>
            </LocaleProvider>
          </MotionConfig>
        </LazyMotion>
      </BrowserRouter>
    </Crash>
  </StrictMode>,
)
