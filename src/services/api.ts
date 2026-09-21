// ─── API Service Layer ────────────────────────────────────────────────────────
// Connects ShipCheck to the email-extract-compare FastAPI backend
import { getSupabaseAccessToken } from './supabase'

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

async function getAuthHeaders(extraHeaders: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extraHeaders }
  try {
    const token = await getSupabaseAccessToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
  } catch {
    // Continue without auth header if session retrieval fails
  }
  return headers
}

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
  comparison_id?: number
}

export interface ComparisonRecord {
  id: number
  email_id?: string
  si_name: string
  bl_name: string
  status: EmailStatus
  summary?: string
  fields_json: string
  fields?: ComparisonField[]
  reviewed: boolean
  reviewed_by?: string
  created_at: string
}

export function parseComparisonRecord(record: any): ComparisonRecord {
  let fields: ComparisonField[] = []
  try {
    fields = typeof record.fields_json === 'string' ? JSON.parse(record.fields_json) : (record.fields || [])
  } catch {
    fields = []
  }
  return {
    ...record,
    fields,
  }
}

export function mapEmailRecordToGmailEmail(record: any): {
  id: string
  threadId: string
  from: string
  fromName: string
  subject: string
  snippet: string
  date: string
  timestamp: number
  type: EmailType
  status: EmailStatus
  hasAttachments: boolean
  body?: string
} {
  return {
    id: record.id,
    threadId: record.thread_id || record.threadId || record.id,
    from: record.from_email || record.from || '',
    fromName: record.from_name || record.fromName || '',
    subject: record.subject || '(no subject)',
    snippet: record.snippet || '',
    date: record.date_str || record.date || '',
    timestamp: record.timestamp || Date.now(),
    type: (record.email_type || record.type || 'General') as EmailType,
    status: (record.status || 'Classified') as EmailStatus,
    hasAttachments: record.has_attachments ?? record.hasAttachments ?? false,
    body: record.body_snippet || record.body || '',
  }
}

export function mapGmailEmailToCreatePayload(email: {
  id: string
  threadId: string
  from: string
  fromName: string
  subject: string
  snippet: string
  date: string
  timestamp: number
  type: EmailType
  status: EmailStatus
  hasAttachments: boolean
  body?: string
}): any {
  const isUnclassified = email.status === 'Processing' || !email.type || email.type === 'General'
  return {
    id: email.id,
    thread_id: email.threadId,
    from_name: email.fromName,
    from_email: email.from,
    subject: email.subject,
    snippet: email.snippet,
    date_str: email.date,
    timestamp: email.timestamp,
    email_type: isUnclassified ? undefined : email.type,
    status: isUnclassified ? undefined : email.status,
    has_attachments: email.hasAttachments,
    body: email.body || email.snippet,
    body_snippet: email.body ? email.body.slice(0, 1000) : email.snippet,
  }
}

export interface HealthResponse {
  status: string
  provider?: string
  model?: string
  database?: string
  [key: string]: any
}

/**
 * Checks if the FastAPI backend service is reachable and healthy.
 */
export async function checkBackendHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/api/health`)
  if (!res.ok) {
    throw new Error(`Backend health check failed with status ${res.status}`)
  }
  return res.json()
}

async function extractErrorDetail(res: Response): Promise<string> {
  if (res.status === 502 || res.status === 504) {
    return 'FastAPI backend service is not running or unreachable. Please verify the backend service.'
  }
  if (res.status === 404) {
    return `Endpoint ${res.url} not found (404). Please ensure the backend is running with the latest routes.`
  }
  try {
    const text = await res.text()
    try {
      const json = JSON.parse(text)
      return json.detail || JSON.stringify(json)
    } catch {
      return text.slice(0, 300) || res.statusText
    }
  } catch {
    return res.statusText
  }
}

/**
 * Sends an email to the FastAPI backend for classification using Claude Haiku / OpenRouter.
 * Strict error handling: Throws an Error if backend is unreachable or returns a non-200 status.
 */
export async function classifyEmailApi(req: EmailClassifyRequest): Promise<EmailClassifyResponse> {
  let res: Response
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const headers = await getAuthHeaders({ 'Content-Type': 'application/json' })
    res = await fetch(`${API_BASE}/api/classify`, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
      signal: controller.signal,
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Classification request timed out after 15s.')
    }
    throw new Error('FastAPI backend service is offline. Please verify the backend service is running.')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const detail = await extractErrorDetail(res)
    throw new Error(`Classification API error (${res.status}): ${detail}`)
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

  let res: Response
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45000)
  try {
    const headers = await getAuthHeaders()
    res = await fetch(`${API_BASE}/api/compare`, {
      method: 'POST',
      headers,
      body: formData,
      signal: controller.signal,
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Document comparison timed out after 45s.')
    }
    throw new Error('FastAPI backend service is offline. Please verify the backend service is running.')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const detail = await extractErrorDetail(res)
    throw new Error(`Comparison API error (${res.status}): ${detail}`)
  }

  return res.json()
}

/**
 * Direct raw-text comparison endpoint.
 */
export async function compareTextApi(siText: string, blText: string): Promise<CompareResponse> {
  let res: Response
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const headers = await getAuthHeaders({ 'Content-Type': 'application/json' })
    res = await fetch(`${API_BASE}/api/compare/text`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ si_text: siText, bl_text: blText }),
      signal: controller.signal,
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Comparison request timed out after 30s.')
    }
    throw new Error('FastAPI backend service is offline. Please verify the backend service is running.')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const detail = await extractErrorDetail(res)
    throw new Error(`Text comparison API error (${res.status}): ${detail}`)
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

/**
 * Fetches cached emails from the SQLite database.
 */
export async function getCachedEmailsApi(limit = 50, offset = 0, emailType?: string, status?: string): Promise<any[]> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (emailType) params.append('email_type', emailType)
  if (status) params.append('status', status)

  let res: Response
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const headers = await getAuthHeaders()
    res = await fetch(`${API_BASE}/api/emails?${params.toString()}`, {
      headers,
      signal: controller.signal,
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Timed out fetching cached emails from database.')
    }
    throw new Error('FastAPI backend service is offline. Please verify the backend service is running.')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const detail = await extractErrorDetail(res)
    throw new Error(`Failed to fetch cached emails (${res.status}): ${detail}`)
  }

  const data = await res.json()
  return (data || []).map(mapEmailRecordToGmailEmail)
}

/**
 * Syncs a batch of Gmail messages to the backend SQLite cache.
 * Existing emails in SQLite are returned at 0 token cost;
 * only new unclassified emails are classified via Claude Haiku and persisted.
 */
export async function syncEmailBatchApi(emails: any[]): Promise<any[]> {
  const payload = emails.map(e => mapGmailEmailToCreatePayload(e))
  let res: Response
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 18000)
  try {
    const headers = await getAuthHeaders({ 'Content-Type': 'application/json' })
    res = await fetch(`${API_BASE}/api/emails/batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Batch sync timed out after 18s.')
    }
    throw new Error('FastAPI backend service is offline. Please verify the backend service is running.')
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const detail = await extractErrorDetail(res)
    throw new Error(`Email batch sync failed (${res.status}): ${detail}`)
  }

  const data = await res.json()
  return (data || []).map(mapEmailRecordToGmailEmail)
}

/**
 * Progressive batch sync to backend SQLite cache with bounded concurrency.
 * Calls onItemDone for each completed item so the UI updates in real time.
 */
export async function syncEmailBatchProgressive<T extends { id: string }>(
  items: T[],
  onItemDone: (syncedItem: any, originalItem: T) => void,
  onItemFailed: (error: Error, originalItem: T) => void,
  concurrency = 2
): Promise<void> {
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++
      const item = items[currentIndex]
      try {
        const syncedList = await syncEmailBatchApi([item])
        const syncedItem = syncedList[0] || item
        onItemDone(syncedItem, item)
      } catch (err) {
        onItemFailed(err instanceof Error ? err : new Error(String(err)), item)
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  const workers = Array.from({ length: workerCount }, () => worker())
  await Promise.all(workers)
}

/**
 * Fetches historical comparison records from Supabase Postgres.
 */
export async function getComparisonsApi(limit = 50, offset = 0): Promise<ComparisonRecord[]> {
  const headers = await getAuthHeaders()
  const res = await fetch(`${API_BASE}/api/comparisons?limit=${limit}&offset=${offset}`, {
    headers,
  })
  if (!res.ok) throw new Error(`Failed to fetch comparisons: ${res.status}`)
  const data = await res.json()
  return (data || []).map(parseComparisonRecord)
}

/**
 * Fetches a single comparison by ID.
 */
export async function getComparisonByIdApi(id: number): Promise<ComparisonRecord> {
  const headers = await getAuthHeaders()
  const res = await fetch(`${API_BASE}/api/comparisons/${id}`, {
    headers,
  })
  if (!res.ok) throw new Error(`Failed to fetch comparison ${id}: ${res.status}`)
  const data = await res.json()
  return parseComparisonRecord(data)
}

/**
 * Registers / syncs a user with Supabase auth.users in the backend and returns a valid Supabase JWT.
 */
export async function syncUserWithBackendApi(user: {
  email: string
  name?: string
  picture?: string
  provider?: string
}): Promise<{ user_id: string; email: string; name: string; token: string }> {
  const res = await fetch(`${API_BASE}/api/auth/sync-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  })
  if (!res.ok) {
    const detail = await extractErrorDetail(res)
    throw new Error(`User sync failed (${res.status}): ${detail}`)
  }
  return res.json()
}


