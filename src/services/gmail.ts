import type { GmailEmail, EmailType, EmailStatus, UserInfo } from '../types'

export async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function gmailFetch(token: string, path: string, retries = 3, backoff = 800): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (r.ok) return r.json()
    if (r.status === 429 && attempt < retries) {
      // Exponential backoff with jitter on 429 rate limit
      const wait = backoff * Math.pow(2, attempt) + Math.random() * 300
      await delay(wait)
      continue
    }
    throw new Error(`Gmail API ${r.status}`)
  }
}

export async function fetchInBatches<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency = 5): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0
  async function worker() {
    while (index < items.length) {
      const i = index++
      results[i] = await fn(items[i])
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

export async function getUserInfo(token: string): Promise<UserInfo> {
  const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const d = await r.json()
  return { email: d.email, name: d.name, picture: d.picture, provider: 'google' }
}

export function decodeBase64(str: string) {
  try {
    return decodeURIComponent(
      atob(str.replace(/-/g, '+').replace(/_/g, '/'))
        .split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    )
  } catch { return '' }
}

export function extractBody(payload: any): string {
  if (!payload) return ''
  if (payload.body?.data) return decodeBase64(payload.body.data)
  if (payload.parts) {
    for (const p of payload.parts) {
      if (p.mimeType === 'text/plain' && p.body?.data) return decodeBase64(p.body.data)
    }
    for (const p of payload.parts) { const n = extractBody(p); if (n) return n }
  }
  return ''
}

export function parseHeader(headers: { name: string; value: string }[], name: string) {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}

export function classify(subject: string, snippet: string, body: string): EmailType {
  const t = `${subject} ${snippet} ${body}`.toLowerCase()
  if (t.includes('bill of lading') || t.includes('b/l') ||
    (t.includes('bl') && (t.includes('draft') || t.includes('confirm') || t.includes('shipping instruction'))) ||
    (t.includes('draft') && t.includes('lading'))) return 'Document Comparison'
  if (t.includes('invoice') || t.includes('remittance')) return 'Invoice Query'
  if (t.includes('shipping instruction') && !t.includes('bill of lading')) return 'New SI Request'
  if (t.includes('unsubscribe') || t.includes('promotion') || t.includes('special offer')) return 'Spam'
  return 'General'
}

export function mockStatus(type: EmailType, id: string): EmailStatus {
  if (type !== 'Document Comparison') return 'Classified'
  const h = id.charCodeAt(id.length - 1) % 4
  return h === 0 ? 'Mismatch' : h === 1 ? 'Needs Review' : h === 2 ? 'Match' : 'New'
}

export function fmtDate(ts: number) {
  const d = new Date(ts), now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if ((now.getTime() - ts) < 172800000) return 'Yesterday'
  if ((now.getTime() - ts) < 604800000) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export function parseFrom(from: string) {
  const m = from.match(/^(.*?)\s*<(.+?)>$/)
  return m ? { name: m[1].replace(/"/g, '').trim() || m[2], email: m[2] } : { name: from, email: from }
}

export interface GmailPageResult {
  emails: GmailEmail[]
  nextPageToken?: string
}

export async function fetchEmailsPage(token: string, pageToken?: string, maxResults = 25): Promise<GmailPageResult> {
  const pageParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''
  const list = await gmailFetch(token, `users/me/messages?maxResults=${maxResults}&q=in:inbox${pageParam}`)
  const ids: string[] = (list.messages || []).map((m: any) => m.id)
  const emails = await fetchInBatches(ids, async id => {
    const msg = await gmailFetch(token, `users/me/messages/${id}?format=full`)
    const headers = msg.payload?.headers || []
    const subject = parseHeader(headers, 'subject') || '(no subject)'
    const from = parseHeader(headers, 'from')
    const { name: fromName, email: fromEmail } = parseFrom(from)
    const dateStr = parseHeader(headers, 'date')
    const timestamp = dateStr ? new Date(dateStr).getTime() : Number(msg.internalDate) || Date.now()
    const snippet = msg.snippet || ''
    const body = extractBody(msg.payload)
    const hasAttachments = !!(msg.payload?.parts?.some((p: any) => p.filename?.length > 0))
    return {
      id,
      threadId: msg.threadId,
      from: fromEmail,
      fromName,
      subject,
      snippet,
      date: fmtDate(timestamp),
      timestamp,
      type: 'General',
      status: 'Processing',
      hasAttachments,
      body: body.slice(0, 2000),
    } as GmailEmail
  }, 5)
  return {
    emails: emails.sort((a, b) => b.timestamp - a.timestamp),
    nextPageToken: list.nextPageToken,
  }
}

