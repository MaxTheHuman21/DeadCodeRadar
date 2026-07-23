import { useState } from 'react'
import { Landing } from '@/components/deadcode/landing'
import { Testing } from '@/components/deadcode/testing'
import { TopNav, type View } from '@/components/deadcode/top-nav'

export default function App() {
  const [view, setView] = useState<View>('landing')

  function changeView(v: View) {
    setView(v)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <main className="min-h-dvh bg-background">
      <TopNav view={view} onChange={changeView} />
      {view === 'landing' ? (
        <Landing onTryIt={() => changeView('testing')} />
      ) : (
        <Testing />
      )}
    </main>
  )
}
