# 🎯 DeadCode Radar

> Static analysis, sharpened by AI. Find dead code in your repo before it finds you.

**[🚀 Try it live](TU_URL_AQUI)** · **[📹 Watch the demo](LINK_AL_VIDEO)**

![screenshot](ruta/a/tu/screenshot.png)

## What it does

DeadCode Radar scans any public GitHub repository for unused files, exports, and 
dependencies — then uses AI to explain *why* each finding is a safe (or risky) removal 
candidate, catching false positives that pure static analysis tools miss.

## Why it's different

Static analysis alone is noisy: it flags Next.js route handlers, dynamically-loaded 
modules, and re-exported APIs as "dead" when they're not. DeadCode Radar enriches every 
finding with a confidence score and a plain-English risk explanation — then, for the 
cases it's genuinely confident about, it can open a real Pull Request that removes the 
dead code for you.

## How it works

1. **Paste a repo URL** — public GitHub repos, JS/TypeScript
2. **Static analysis** (knip/ts-prune) builds the raw list of unused files, exports, 
   and dependencies
3. **Amazon Bedrock (Claude)** reads the actual file context around each finding, 
   assigns a confidence score (high/medium/low), groups related findings, and drafts 
   a PR description
4. **Create a real PR** — with your own GitHub token, DeadCode Radar opens a Pull 
   Request that removes only the high-confidence, unambiguous dead code — leaving 
   anything uncertain for manual review

## Architecture

[Aquí un diagrama simple — puedo generarte uno con el Visualizer si quieres, dime]

- **AWS Lambda** — serverless backend, Node.js/TypeScript
- **Amazon Bedrock (Claude Sonnet)** — AI enrichment layer
- **DynamoDB** — job results storage
- **S3** — frontend hosting
- **GitHub API (Octokit)** — repo download + PR creation

## Built with Kiro

This entire project was built using Kiro's spec-driven workflow (requirements → design → 
tasks) across two development days, plus Claude Code for iterative debugging and UI 
refinement. [Opcional: menciona algo específico que te haya sorprendido de ese flujo]

## Known limitations

- `unused-dependency` detection requires the analyzed repo to have installed 
  `node_modules` for knip to resolve properly — not currently supported for remote 
  repos analyzed without a full install step
- PR creation confidence scores are AI-generated and can vary slightly between runs 
  on the same repo (LLM non-determinism) — the system is intentionally conservative: 
  when in doubt, it doesn't touch the file
- Currently supports JavaScript/TypeScript only

## Roadmap

- GitHub OAuth login (vs. manual PAT entry)
- Multi-language support (Python, Go)
- Fork-based PR creation for repos you don't own

## Local setup

[comandos de instalación local si alguien quiere correrlo]