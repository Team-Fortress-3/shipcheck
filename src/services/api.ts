// ─── API Service Layer ────────────────────────────────────────────────────────
// Connects ShipCheck to the email-extract-compare FastAPI backend (http://localhost:8000)

export type EmailType = 'Document Comparison' | 'New SI Request' | 'Invoice Query' | 'General' | 'Spam'
export type EmailStatus = 'New' | 'Mismatch' | 'Match' | 'Needs Review' | 'Classified' | 'Processing'

export interface ComparisonField {
  field: string
  si: string
  bl: string
  match: boolean
}

export interface EmailClassifyRequest {
  subject: string
  snippet: string
  body: string
}

export interface EmailClassifyResponse {
  type: EmailType
  confidence: number
  reasoning?: string
}

export interface CompareResponse {
  status: EmailStatus
  fields: ComparisonField[]
  summary?: string
}

export interface HealthResponse {
  status: string
  provider?: string
  model?: string
  [key: string]: any
}

/**
 * Checks if the FastAPI backend service is reachable and healthy.
 */
export async function checkBackendHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health')
  if (!res.ok) {
    throw new Error(`Backend health check failed with status ${res.status}`)
  }
  return res.json()
}

/**
 * Sends an email to the FastAPI backend for classification using Claude Haiku / OpenRouter.
 * Strict error handling: Throws an Error if backend is unreachable or returns a non-200 status.
 */
export async function classifyEmailApi(req: EmailClassifyRequest): Promise<EmailClassifyResponse> {
  const res = await fetch('/api/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const errJson = await res.json()
      detail = errJson.detail || JSON.stringify(errJson)
    } catch {
      detail = await res.text()
    }
    throw new Error(`Classification API error (${res.status}): ${detail || res.statusText}`)
  }

  return res.json()
}

/**
 * Uploads Shipping Instruction and Bill of Lading files for AI extraction and comparison.
 * Strict error handling: Throws an Error if backend is unreachable or returns an error.
 */
export async function compareFilesApi(siFile: File, blFile: File): Promise<CompareResponse> {
  const formData = new FormData()
  formData.append('si_file', siFile)
  formData.append('bl_file', blFile)

  const res = await fetch('/api/compare', {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    let detail = ''
    try {
      const errJson = await res.json()
      detail = errJson.detail || JSON.stringify(errJson)
    } catch {
      detail = await res.text()
    }
    throw new Error(`Comparison API error (${res.status}): ${detail || res.statusText}`)
  }

  return res.json()
}

/**
 * Direct raw-text comparison endpoint.
 */
export async function compareTextApi(siText: string, blText: string): Promise<CompareResponse> {
  const res = await fetch('/api/compare/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ si_text: siText, bl_text: blText }),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const errJson = await res.json()
      detail = errJson.detail || JSON.stringify(errJson)
    } catch {
      detail = await res.text()
    }
    throw new Error(`Text comparison API error (${res.status}): ${detail || res.statusText}`)
  }

  return res.json()
}

/**
 * Executes batch email classification with bounded concurrency (default 2)
 * to avoid overwhelming the LLM service while progressively reporting progress.
 */
export async function classifyEmailsBatch<T extends { subject: string; snippet: string; body?: string }>(
  items: T[],
  onItemClassified: (index: number, result: EmailClassifyResponse, item: T) => void,
  onItemFailed: (index: number, error: Error, item: T) => void,
  concurrency = 2
): Promise<void> {
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++
      const item = items[currentIndex]
      try {
        const result = await classifyEmailApi({
          subject: item.subject,
          snippet: item.snippet,
          body: item.body || item.snippet || item.subject,
        })
        onItemClassified(currentIndex, result, item)
      } catch (err) {
        onItemFailed(currentIndex, err instanceof Error ? err : new Error(String(err)), item)
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
}

