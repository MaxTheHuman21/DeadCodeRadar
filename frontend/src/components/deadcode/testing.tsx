import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowLeft, FileSearch, RefreshCw, Search, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MaskIcon } from './mask-icon'
import { RadarSweep } from './radar-sweep'
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
  const [githubToken, setGithubToken] = useState('')
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
    setGithubToken('')
  }

  async function analyze() {
    const value = url.trim()
    timers.current.forEach(clearTimeout)
    timers.current = []
    abortRef.current?.abort()

    if (!GITHUB_RE.test(value)) {
      setStatus('error')
      setErrorMessage('Ingresa la URL completa del repositorio en la forma https://github.com/owner/repo — asegúrate de que sea público y apunte a un repositorio específico.')
      setResult(null)
      return
    }

    setStatus('loading')
    setStep(0)
    setResult(null)
    setErrorMessage('')

    // Simulate progress steps with timeouts while waiting for the real response
    const stepDuration = 8000
    LOADING_STEPS.forEach((_, i) => {
      const t = setTimeout(() => setStep(i), i * stepDuration)
      timers.current.push(t)
    })

    const loopTimer = setTimeout(() => {
      setStep(LOADING_STEPS.length - 1)
    }, LOADING_STEPS.length * stepDuration)
    timers.current.push(loopTimer)

    try {
      const controller = new AbortController()
      abortRef.current = controller

      const body: Record<string, string> = { repoUrl: value }
      const trimmedToken = githubToken.trim()
      if (trimmedToken.length > 0) {
        body.userGithubToken = trimmedToken
      }

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      timers.current.forEach(clearTimeout)
      timers.current = []

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(
          response.status === 422
            ? 'La URL del repositorio no es válida o el repo no es accesible.'
            : response.status === 404
            ? 'No se encontró el endpoint de análisis. Intenta de nuevo más tarde.'
            : `Error del servidor (${response.status}): ${errorText || 'Error desconocido'}`
        )
      }

      const data = await response.json()

      if (data.status === 'error') {
        throw new Error(data.error || 'El análisis falló. Intenta de nuevo con otro repositorio.')
      }

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
          : 'Ocurrió un error inesperado. Intenta de nuevo.'
      )
    }
  }

  // Client-side safety timeout
  useEffect(() => {
    if (status !== 'loading') return
    const timeout = setTimeout(() => {
      abortRef.current?.abort()
      setStatus('error')
      setErrorMessage('El análisis está tardando demasiado. El repositorio puede ser muy grande o el servidor está ocupado. Intenta de nuevo más tarde.')
      timers.current.forEach(clearTimeout)
      timers.current = []
    }, FETCH_TIMEOUT_MS)
    return () => clearTimeout(timeout)
  }, [status])

  return (
    <div className="mx-auto max-w-3xl px-5 pt-14 pb-24">
      <div className="text-center">
        <h1 className="text-balance font-display text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          Analiza un repositorio
        </h1>
        <p className="mx-auto mt-3 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground">
          Pega la URL de un repo público de GitHub y encontraremos su código muerto con
          hallazgos rankeados por confianza y explicados por IA.
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
              Analizar
            </Button>
          </div>

          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
              Agrega tu token de GitHub para habilitar la creación de PRs (opcional)
            </summary>
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Proporcionar un token con scope <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">repo</code> permite crear un PR que elimina el código muerto.{' '}
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  Crear un token →
                </a>
              </p>
              <input
                type="password"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxx"
                disabled={status === 'loading'}
                className="h-9 w-full rounded-lg border border-input bg-card px-3 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/30 disabled:opacity-60"
              />
            </div>
          </details>

          {status === 'idle' && (
            <button
              type="button"
              onClick={() => setUrl(EXAMPLE)}
              className="mt-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Prueba un ejemplo:{' '}
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
          <h3 className="mt-4 font-display text-base font-semibold text-foreground">No se encontró código muerto</h3>
          <p className="mt-2 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
            Analizamos el repositorio pero no encontramos código muerto. ¡El codebase se ve limpio!
          </p>
          <Button variant="outline" size="sm" onClick={reset} className="mt-6 rounded-full">
            <ArrowLeft className="h-4 w-4" />
            Analizar otro repo
          </Button>
        </div>
      )}

      {/* Results */}
      {status === 'done' && result && (
        <Results result={result} onReset={reset} githubToken={githubToken} />
      )}
    </div>
  )
}

/* ─── Loading ─────────────────────────────────────────── */

function LoadingState({ step }: { step: number }) {
  return (
    <div className="relative mt-10 flex flex-col items-center gap-6 overflow-hidden rounded-2xl border border-border bg-card py-14 shadow-sm">
      <RadarSweep className="opacity-60" />
      <div className="relative z-10 flex flex-col items-center gap-6">
        <span className="relative flex h-14 w-14 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
          <span className="absolute inset-2 animate-pulse rounded-full bg-primary/30" />
          <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        </span>
        <div className="h-5 text-center">
          <p className="font-mono text-sm font-medium text-foreground transition-all">
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
          Esto puede tomar unos minutos en repositorios grandes...
        </p>
      </div>
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
      <h3 className="mt-4 font-display text-base font-semibold text-foreground">Algo salió mal</h3>
      <p className="mt-2 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
        {message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-6 rounded-full">
        <RefreshCw className="h-4 w-4" />
        Reintentar
      </Button>
    </div>
  )
}

/* ─── Results ─────────────────────────────────────────── */

function Results({ result, onReset, githubToken }: { result: AnalysisResult; onReset: () => void; githubToken: string }) {
  const groupSizes = countGroups(result.findings)

  return (
    <div className="mt-10 flex flex-col gap-6">
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={onReset} className="self-start rounded-full -mb-2">
        <ArrowLeft className="h-4 w-4" />
        Analizar otro repo
      </Button>

      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <Stat value={result.filesAnalyzed.toLocaleString()} label="Archivos analizados" />
        <span className="hidden h-8 w-px bg-border sm:block" />
        <Stat value={result.findings.length} label="Hallazgos" />
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
            {result.enriched ? 'Enriquecido con IA' : 'Solo análisis estático'}
          </span>
        </div>
      </div>

      {/* PR description */}
      {result.prDescription && (
        <PrCard
          pr={result.prDescription}
          githubToken={githubToken}
          jobId={result.jobId}
          apiUrl={API_URL}
        />
      )}

      {/* Findings list */}
      <div>
        <div className="mb-3 flex items-center justify-between px-1">
          <h3 className="font-display text-sm font-semibold text-foreground">
            Hallazgos (<span className="font-mono">{result.findings.length}</span>)
          </h3>
          <span className="font-mono text-xs text-muted-foreground">
            ordenados por confianza
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
      <div className="font-mono text-2xl font-semibold tracking-tight text-foreground">{value}</div>
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
