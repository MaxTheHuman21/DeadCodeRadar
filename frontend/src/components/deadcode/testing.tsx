import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, FileSearch, RefreshCw, Search, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MaskIcon } from './mask-icon'
import {
  LOADING_STEPS,
  confidenceSortValue,
  type AnalysisResult,
  type Finding,
} from './data'
import { PrCard } from './pr-card'
import { FindingRow } from './finding-row'

type Status = 'idle' | 'loading' | 'error' | 'empty' | 'done'

const GITHUB_RE = /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/i
const EXAMPLE = 'https://github.com/MaxTheHuman21/next-commerce'

const API_URL = import.meta.env.VITE_API_URL

// 5 minute timeout for the fetch (analysis can take several minutes)
const FETCH_TIMEOUT_MS = 5 * 60 * 1000

export function Testing() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [step, setStep] = useState(0)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout)
      abortRef.current?.abort()
    }
  }, [])

  function reset() {
    timers.current.forEach(clearTimeout)
    timers.current = []
    abortRef.current?.abort()
    setStatus('idle')
    setResult(null)
    setErrorMessage('')
    setStep(0)
  }

  async function analyze() {
    const value = url.trim()
    timers.current.forEach(clearTimeout)
    timers.current = []
    abortRef.current?.abort()

    if (!GITHUB_RE.test(value)) {
      setStatus('error')
      setErrorMessage('Enter a full repository URL in the form https://github.com/owner/repo — make sure it\'s public and points to a specific repository.')
      setResult(null)
      return
    }

    setStatus('loading')
    setStep(0)
    setResult(null)
    setErrorMessage('')

    // Simulate progress steps with timeouts while waiting for the real response
    const stepDuration = 8000 // ~8 seconds per step to spread across potentially long waits
    LOADING_STEPS.forEach((_, i) => {
      const t = setTimeout(() => setStep(i), i * stepDuration)
      timers.current.push(t)
    })

    // After all steps shown, keep cycling the last step
    const loopTimer = setTimeout(() => {
      setStep(LOADING_STEPS.length - 1)
    }, LOADING_STEPS.length * stepDuration)
    timers.current.push(loopTimer)

    try {
      const controller = new AbortController()
      abortRef.current = controller

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: value }),
        signal: controller.signal,
      })

      // Clear progress timers once we get a response
      timers.current.forEach(clearTimeout)
      timers.current = []

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(
          response.status === 422
            ? 'The repository URL is not valid or the repo is not accessible.'
            : response.status === 404
            ? 'The analysis endpoint was not found. Please try again later.'
            : `Server error (${response.status}): ${errorText || 'Unknown error'}`
        )
      }

      const data = await response.json()

      if (data.status === 'error') {
        throw new Error(data.error || 'The analysis failed. Please try again with a different repository.')
      }

      // Map the API response to our AnalysisResult type
      const analysisResult: AnalysisResult = {
        jobId: data.jobId,
        status: data.status,
        repoUrl: data.repoUrl || value,
        filesAnalyzed: data.filesAnalyzed || 0,
        enriched: data.enriched ?? true,
        findings: data.findings || [],
        prDescription: data.prDescription || null,
      }

      if (analysisResult.findings.length === 0) {
        setStatus('empty')
      } else {
        setResult(analysisResult)
        setStatus('done')
      }
    } catch (err: unknown) {
      timers.current.forEach(clearTimeout)
      timers.current = []

      if (err instanceof Error && err.name === 'AbortError') {
        return
      }

      setStatus('error')
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred. Please try again.'
      )
    }
  }

  // Client-side safety timeout
  useEffect(() => {
    if (status !== 'loading') return
    const timeout = setTimeout(() => {
      abortRef.current?.abort()
      setStatus('error')
      setErrorMessage('The analysis is taking too long. The repository might be too large or the server is busy. Please try again later.')
      timers.current.forEach(clearTimeout)
      timers.current = []
    }, FETCH_TIMEOUT_MS)
    return () => clearTimeout(timeout)
  }, [status])

  return (
    <div className="mx-auto max-w-3xl px-5 pt-14 pb-24">
      <div className="text-center">
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          Analyze a repository
        </h1>
        <p className="mx-auto mt-3 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
          Paste a public GitHub repo URL and we&apos;ll surface its dead code with
          confidence-ranked, AI-explained findings.
        </p>
      </div>

      {/* Input — always visible unless showing results */}
      {status !== 'done' && (
        <>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <MaskIcon
                src="/logos/github.svg"
                label="GitHub"
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="url"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value)
                  if (status === 'error') setStatus('idle')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    analyze()
                  }
                }}
                placeholder="https://github.com/owner/repo"
                disabled={status === 'loading'}
                className="h-11 w-full rounded-xl border border-input bg-card pl-10 pr-4 font-mono text-sm text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
              />
            </div>
            <Button
              size="lg"
              onClick={analyze}
              disabled={status === 'loading' || url.trim().length === 0}
              className="h-11 rounded-xl px-6"
            >
              <Search className="h-4 w-4" />
              Analyze
            </Button>
          </div>

          {status === 'idle' && (
            <button
              type="button"
              onClick={() => setUrl(EXAMPLE)}
              className="mt-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Try an example:{' '}
              <span className="font-mono text-primary">{EXAMPLE}</span>
            </button>
          )}
        </>
      )}

      {/* Loading */}
      {status === 'loading' && <LoadingState step={step} />}

      {/* Error */}
      {status === 'error' && (
        <ErrorPanel
          message={errorMessage}
          onRetry={analyze}
        />
      )}

      {/* Empty */}
      {status === 'empty' && (
        <div className="mt-10 flex flex-col items-center rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-sm">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <FileSearch className="h-6 w-6" />
          </span>
          <h3 className="mt-4 text-base font-semibold text-foreground">No dead code found</h3>
          <p className="mt-2 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
            We analyzed the repository but didn&apos;t find any dead code findings. The codebase looks clean!
          </p>
          <Button variant="outline" size="sm" onClick={reset} className="mt-6 rounded-full">
            <ArrowLeft className="h-4 w-4" />
            Analyze another repo
          </Button>
        </div>
      )}

      {/* Results */}
      {status === 'done' && result && (
        <Results result={result} onReset={reset} />
      )}
    </div>
  )
}

/* ─── Loading ─────────────────────────────────────────── */

function LoadingState({ step }: { step: number }) {
  return (
    <div className="mt-10 flex flex-col items-center gap-6 rounded-2xl border border-border bg-card py-14 shadow-sm">
      <span className="relative flex h-14 w-14 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
        <span className="absolute inset-2 animate-pulse rounded-full bg-primary/30" />
        <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
      </span>
      <div className="h-5 text-center">
        <p className="text-sm font-medium text-foreground transition-all">
          {LOADING_STEPS[step]}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {LOADING_STEPS.map((_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 rounded-full transition-all',
              i <= step ? 'w-6 bg-primary' : 'w-1.5 bg-border',
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        This may take a few minutes for large repositories...
      </p>
    </div>
  )
}

/* ─── Error ───────────────────────────────────────────── */

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="mt-10 flex flex-col items-center rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-sm">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-6 w-6" />
      </span>
      <h3 className="mt-4 text-base font-semibold text-foreground">Something went wrong</h3>
      <p className="mt-2 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
        {message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-6 rounded-full">
        <RefreshCw className="h-4 w-4" />
        Retry
      </Button>
    </div>
  )
}

/* ─── Results ─────────────────────────────────────────── */

function Results({ result, onReset }: { result: AnalysisResult; onReset: () => void }) {
  const groupSizes = countGroups(result.findings)

  return (
    <div className="mt-10 flex flex-col gap-6">
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={onReset} className="self-start rounded-full -mb-2">
        <ArrowLeft className="h-4 w-4" />
        Analyze another repo
      </Button>

      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <Stat value={result.filesAnalyzed.toLocaleString()} label="Files analyzed" />
        <span className="hidden h-8 w-px bg-border sm:block" />
        <Stat value={result.findings.length} label="Findings" />
        <span className="hidden h-8 w-px bg-border sm:block" />
        <div className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
              result.enriched
                ? 'bg-success/10 text-success'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {result.enriched ? 'AI-enriched' : 'Static analysis only'}
          </span>
        </div>
      </div>

      {/* PR description */}
      {result.prDescription && <PrCard pr={result.prDescription} />}

      {/* Findings list */}
      <div>
        <div className="mb-3 flex items-center justify-between px-1">
          <h3 className="text-sm font-semibold text-foreground">
            Findings ({result.findings.length})
          </h3>
          <span className="font-mono text-xs text-muted-foreground">
            sorted by confidence
          </span>
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          {[...result.findings]
            .sort((a, b) => confidenceSortValue(b.confidenceScore) - confidenceSortValue(a.confidenceScore))
            .map((f, i) => (
              <FindingRow
                key={`${f.file}-${f.name}-${i}`}
                finding={f}
                groupSize={f.groupId ? groupSizes[f.groupId] : 1}
                enriched={result.enriched}
              />
            ))}
        </div>
      </div>
    </div>
  )
}

/* ─── Helpers ─────────────────────────────────────────── */

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tracking-tight text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function countGroups(findings: Finding[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((acc, f) => {
    if (f.groupId) acc[f.groupId] = (acc[f.groupId] ?? 0) + 1
    return acc
  }, {})
}
