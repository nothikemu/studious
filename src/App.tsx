import { useEffect } from 'react'
import { Library } from './components/Library'
import { Progress } from './components/Progress'
import { Review } from './components/Review'
import { SearchDialog } from './components/SearchDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { Workspace } from './components/Workspace'
import { ToastHost } from './components/ui'
import { useUI } from './store'

export default function App() {
  const route = useUI((s) => s.route)
  const theme = useUI((s) => s.theme)
  const searchOpen = useUI((s) => s.searchOpen)
  const settingsOpen = useUI((s) => s.settingsOpen)
  const setSearchOpen = useUI((s) => s.setSearchOpen)

  useEffect(() => {
    const root = document.documentElement
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => root.setAttribute('data-theme', theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme)
    apply()
    if (theme !== 'system') return
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSearchOpen])

  return (
    <>
      <a href="#main" className="skip" onClick={(e) => (e.preventDefault(), document.getElementById('main')?.focus())}>
        Skip to content
      </a>
      <div id="main" tabIndex={-1} className="app-root">
        {route.name === 'library' && <Library />}
        {route.name === 'notebook' && <Workspace key={route.id} id={route.id} />}
        {route.name === 'review' && <Review id={route.id} />}
        {route.name === 'progress' && <Progress id={route.id} />}
      </div>
      {searchOpen && <SearchDialog />}
      {settingsOpen && <SettingsDialog />}
      <ToastHost />
    </>
  )
}
