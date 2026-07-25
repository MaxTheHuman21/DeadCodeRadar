import { useState } from 'react'
import Markdown from 'react-markdown'
import { Check, ChevronDown, Copy, GitPullRequest, Loader2, ExternalLink, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PrDescription } from './data'

interface PrCardProps {
  pr: PrDescription
  githubToken?: string
  jobId?: string
  apiUrl?: string
}

export function PrCard({ pr, githubToken, jobId, apiUrl }: PrCardProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [prStatus, setPrStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const [prError, setPrError] = useState<string | null>(null)

  const canCreatePr = !!githubToken?.trim() && !!jobId

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${pr.title}\n\n${pr.body}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  async function createPr() {
    if (!canCreatePr || !apiUrl) return
    setPrStatus('loading')
    setPrError(null)
    try {
      const response = await fetch(`${apiUrl}/pr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, userGithubToken: githubToken!.trim() }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({ error: 'Unknown error' }))
        const errorMsg = data.error || 'Unknown error'
        if (response.status === 403) {
          if (errorMsg.includes('does not own')) {
            throw new Error("You don't own this repository")
          }
          throw new Error("You don't have write access to this repository")
        }
        throw new Error(errorMsg)
      }
      const data = await response.json()
      setPrUrl(data.prUrl)
      setPrStatus('success')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error — please try again'
      setPrError(message)
      setPrStatus('error')
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
            <div className="font-display text-xs font-medium uppercase tracking-wide text-primary">
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

          {/* PR Creation Button */}
          {prStatus === 'success' && prUrl ? (
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success transition-colors hover:bg-success/20"
            >
              <Check className="h-3.5 w-3.5" />
              PR Created
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : prStatus === 'loading' ? (
            <Button
              variant="outline"
              size="sm"
              disabled
              className="shrink-0 rounded-full"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating...
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={!canCreatePr}
              onClick={createPr}
              className="shrink-0 rounded-full"
              title={!canCreatePr ? 'Add your GitHub token above to enable this' : undefined}
            >
              <GitPullRequest className="h-4 w-4" />
              Create PR
            </Button>
          )}
        </div>
      </div>

      {/* PR Error message */}
      {prStatus === 'error' && prError && (
        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          <p className="flex-1 text-xs text-destructive">{prError}</p>
          <button
            type="button"
            onClick={createPr}
            className="text-xs font-medium text-primary underline underline-offset-2 hover:text-primary/80"
          >
            Retry
          </button>
        </div>
      )}

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
