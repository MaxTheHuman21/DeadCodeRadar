import { Radar } from 'lucide-react'
import { cn } from '@/lib/utils'

export type View = 'landing' | 'testing'

export function TopNav({
  view,
  onChange,
}: {
  view: View
  onChange: (v: View) => void
}) {
  const tabs: { id: View; label: string }[] = [
    { id: 'landing', label: 'Home' },
    { id: 'testing', label: 'Try it' },
  ]

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
        <button
          type="button"
          onClick={() => onChange('landing')}
          className="flex items-center gap-2 text-foreground"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Radar className="h-[18px] w-[18px]" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">DeadCode Radar</span>
        </button>

        <nav className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cn(
                'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                view === tab.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  )
}
