import { useState } from 'react'
import { ChevronDown, Layers, Sparkles, ShieldQuestion } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TYPE_LABELS, type ConfidenceLevel, type Finding } from './data'

const TIER_STYLES: Record<ConfidenceLevel, string> = {
  high: 'bg-success/10 text-success',
  medium: 'bg-warning/15 text-warning-foreground',
  low: 'bg-muted text-muted-foreground',
}

const NULL_STYLE = 'bg-muted text-muted-foreground'

export function FindingRow({
  finding,
  groupSize,
  enriched,
}: {
  finding: Finding
  groupSize: number
  enriched: boolean
}) {
  const [open, setOpen] = useState(false)
  const confidence = finding.confidenceScore

  return (
    <div className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
      >
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />

        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">
          {finding.file}
          {finding.line != null && (
            <span className="text-muted-foreground">:{finding.line}</span>
          )}
        </span>

        <span className="hidden shrink-0 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground sm:inline">
          {TYPE_LABELS[finding.type]}
        </span>

        <span
          className={cn(
            'shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold capitalize',
            confidence ? TIER_STYLES[confidence] : NULL_STYLE,
          )}
        >
          {confidence ?? 'N/A'}
        </span>
      </button>

      {open && (
        <div className="border-t border-border bg-muted/30 px-4 py-4 pl-11">
          <div className="mb-2 flex flex-wrap items-center gap-2 sm:hidden">
            <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
              {TYPE_LABELS[finding.type]}
            </span>
          </div>

          {finding.riskExplanation ? (
            <p className="flex items-start gap-2 text-sm leading-relaxed text-foreground">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{finding.riskExplanation}</span>
            </p>
          ) : (
            <p className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground italic">
              <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{enriched ? 'No risk explanation available.' : 'Not enriched — run with AI enrichment for detailed explanations.'}</span>
            </p>
          )}

          {finding.groupId && groupSize > 1 && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
              <Layers className="h-3.5 w-3.5" />
              Grouped with {groupSize - 1} related finding{groupSize - 1 > 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
