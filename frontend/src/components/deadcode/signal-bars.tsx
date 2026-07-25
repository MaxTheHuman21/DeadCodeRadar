// src/components/deadcode/signal-bars.tsx
import { cn } from '@/lib/utils'
import type { ConfidenceLevel } from './data'

const TIER_BARS: Record<ConfidenceLevel, number> = { high: 3, medium: 2, low: 1 }
const TIER_COLOR: Record<ConfidenceLevel, string> = {
  high: 'bg-primary',
  medium: 'bg-warning',
  low: 'bg-muted-foreground/60',
}

export function SignalBars({ confidence }: { confidence: ConfidenceLevel | null }) {
  const filled = confidence ? TIER_BARS[confidence] : 0
  const color = confidence ? TIER_COLOR[confidence] : 'bg-signal-dim'

  return (
    <div className="flex items-end gap-[3px]" title={confidence ?? 'not enriched'}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            'w-1 rounded-sm transition-colors',
            i <= filled ? color : 'bg-signal-dim',
          )}
          style={{ height: `${5 + i * 3}px` }}
        />
      ))}
      <span className="ml-1.5 font-mono text-[11px] font-medium capitalize text-muted-foreground">
        {confidence ?? 'n/a'}
      </span>
    </div>
  )
}