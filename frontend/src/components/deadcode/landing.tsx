import { ArrowRight, ClipboardList, Link2, ScanSearch, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MaskIcon } from './mask-icon'

const STEPS = [
  {
    icon: Link2,
    title: 'Paste a repo URL',
    body: 'Drop in any public GitHub repository. No install, no config, no CI wiring.',
  },
  {
    icon: ScanSearch,
    title: 'We analyze it',
    body: 'Static analysis builds the dependency graph, then AI reviews each candidate for context.',
  },
  {
    icon: ClipboardList,
    title: 'Get prioritized findings',
    body: 'Confidence-ranked results plus a ready-to-paste PR description you can ship today.',
  },
]

export function Landing({ onTryIt }: { onTryIt: () => void }) {
  return (
    <div className="mx-auto max-w-5xl px-5">
      {/* Hero */}
      <section className="flex flex-col items-center pt-20 pb-16 text-center md:pt-28">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          Static analysis, sharpened by AI
        </div>

        <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-foreground md:text-6xl">
          Find dead code in your repo before it finds you
        </h1>

        <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
          DeadCode Radar scans your GitHub repository for unused files, exports, and
          dependencies — then explains what&apos;s safe to remove and why.
        </p>

        <div className="mt-8 flex flex-col items-center gap-4">
          <Button size="lg" onClick={onTryIt} className="rounded-full px-6 text-sm">
            Try it now
            <ArrowRight className="h-4 w-4" />
          </Button>

          {/* Built with badge */}
          <div className="mt-2 inline-flex items-center gap-2.5 rounded-full border border-border bg-card px-3.5 py-2 text-muted-foreground">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
              Powered by
            </span>
            <MaskIcon src="/logos/aws.svg" label="AWS" className="h-4 w-6 text-foreground/70" />
            <span className="text-border">·</span>
            <MaskIcon src="/logos/kiro.svg" label="Kiro" className="h-4 w-4 text-foreground/70" />
            <span className="text-border">·</span>
            <MaskIcon src="/logos/claude.svg" label="Claude" className="h-4 w-4 text-foreground/70" />
            <span className="text-[11px] font-medium text-muted-foreground/70">
              AWS · Kiro · Claude
            </span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border py-16">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-primary">
          How it works
        </h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              className="rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <step.icon className="h-5 w-5" />
                </span>
                <span className="text-xs font-semibold text-muted-foreground">
                  Step {i + 1}
                </span>
              </div>
              <h3 className="mt-4 text-base font-semibold text-foreground">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* AI angle */}
      <section className="border-t border-border py-16">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Why the AI matters
            </div>
            <h2 className="mt-5 text-balance text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
              It doesn&apos;t just flag dead code. It tells you why.
            </h2>
            <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground md:text-base">
              Pure static analysis is noisy — it trips over dynamic imports, framework
              entrypoints, and re-exported public APIs. DeadCode Radar enriches every finding
              with a plain-English risk explanation and a confidence score, so the false
              positives sink to the bottom and the safe wins rise to the top.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <code className="font-mono text-xs text-muted-foreground">app/api/webhook/route.ts</code>
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                low · 0.31
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-foreground">
              &ldquo;Appears unused by imports, but this is a Next.js route handler invoked by the
              framework at runtime. Almost certainly a false positive — keep.&rdquo;
            </p>
            <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              A static-only tool would have told you to delete this.
            </div>
          </div>
        </div>
      </section>

      {/* By devs for devs */}
      <section className="border-t border-border py-16">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            By developers, for developers
          </h2>
          <p className="mt-4 text-pretty text-sm leading-relaxed text-muted-foreground md:text-base">
            This tool exists because manually hunting dead code is tedious, error-prone work
            nobody enjoys. We built it during a hackathon to scratch our own itch — a fast,
            honest way to keep a codebase lean without babysitting a linter&apos;s false alarms.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-10">
        <div className="flex flex-col items-center gap-6 text-center">
          <a
            href="https://github.com/MaxTheHuman21/DeadCodeRadar"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-foreground transition-colors hover:text-primary"
          >
            <MaskIcon src="/logos/github.svg" label="GitHub" className="h-4 w-4" />
            View source on GitHub
          </a>

          <div className="flex items-center gap-3 text-muted-foreground">
            <span className="text-xs text-muted-foreground/70">Running on</span>
            <img
              src="/logos/aws-lambda.svg"
              alt="AWS Lambda"
              className="h-6 w-6 opacity-60 grayscale"
            />
            <img
              src="/logos/aws-bedrock.svg"
              alt="Amazon Bedrock"
              className="h-6 w-6 opacity-60 grayscale"
            />
            <img
              src="/logos/aws-dynamodb.svg"
              alt="Amazon DynamoDB"
              className="h-6 w-6 opacity-60 grayscale"
            />
            <span className="text-xs text-muted-foreground/70">
              Lambda · Bedrock · DynamoDB
            </span>
          </div>

          <p className="text-xs text-muted-foreground/60">
            DeadCode Radar — a hackathon project. Not affiliated with AWS, Kiro, or Anthropic.
          </p>
        </div>
      </footer>
    </div>
  )
}
