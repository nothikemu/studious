import { useUI } from '../store'
import { IconButton } from './ui'

export function TopRight() {
  const theme = useUI((s) => s.theme)
  const setTheme = useUI((s) => s.setTheme)
  const setSearchOpen = useUI((s) => s.setSearchOpen)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  const dark = theme === 'dark' || (theme === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches)
  return (
    <div className="top-right">
      <IconButton icon="search" label="Search everything" shortcut="⌘K" onClick={() => setSearchOpen(true)} />
      <IconButton className="hide-xs" icon={dark ? 'sun' : 'moon'} label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(dark ? 'light' : 'dark')} />
      <IconButton icon="gear" label="Settings" onClick={() => setSettingsOpen(true)} />
    </div>
  )
}
