export type FindingType = 'unused-file' | 'unused-export' | 'unused-dependency'

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface Finding {
  file: string
  line: number | null
  type: FindingType
  name: string
  confidenceScore: ConfidenceLevel | null
  riskExplanation: string | null
  groupId: string | null
}

export interface PrDescription {
  title: string
  body: string
}

export interface AnalysisResult {
  jobId: string
  status: 'completed' | 'error'
  repoUrl: string
  filesAnalyzed: number
  enriched: boolean
  findings: Finding[]
  prDescription: PrDescription | null
}

export const TYPE_LABELS: Record<FindingType, string> = {
  'unused-file': 'unused file',
  'unused-export': 'unused export',
  'unused-dependency': 'unused dependency',
}

/** Sort priority: high > medium > low > null */
export function confidenceSortValue(score: ConfidenceLevel | null): number {
  if (score === 'high') return 3
  if (score === 'medium') return 2
  if (score === 'low') return 1
  return 0
}

export const LOADING_STEPS = [
  'Cloning repository...',
  'Downloading files...',
  'Building the dependency graph...',
  'Running static analysis...',
  'Enriching findings with AI...',
  'Drafting your PR description...',
]
