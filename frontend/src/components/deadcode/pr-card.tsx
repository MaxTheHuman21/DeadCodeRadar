import { useState } from 'react'
import Markdown from 'react-markdown'
import { Check, ChevronDown, Copy, GitPullRequest } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PrDescription } from './data'

export function PrCard({ pr }: { pr: PrDescription }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${pr.title}\n\n${pr.body}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <GitPullRequest className="h-[18px] w-[18px]" />
          </span>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-primary">
              AI-generated PR description
            </div>
            <h3 className="mt-1 font-mono text-sm font-medium text-foreground">{pr.title}</h3>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={copy} className="shrink-0 rounded-full">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled
            className="shrink-0 rounded-full opacity-50"
            title="Próximamente"
          >
            <GitPullRequest className="h-4 w-4" />
            Crear PR
          </Button>
        </div>
      </div>

      <div className="border-t border-border px-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? 'Hide details' : 'View details'}
          <ChevronDown
            className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
          />
        </button>
      </div>

      {open && (
        <div className="border-t border-border p-5">
          <div className="prose-sm max-w-none rounded-xl bg-muted p-4 text-foreground [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_ul]:ml-4 [&_ul]:list-disc [&_ul]:space-y-1 [&_li]:text-xs [&_li]:leading-relaxed [&_p]:text-xs [&_p]:leading-relaxed [&_p]:mb-2 [&_code]:rounded [&_code]:bg-background [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_strong]:font-semibold">
            <Markdown>{pr.body}</Markdown>
          </div>
        </div>
      )}
    </div>
  )
}
