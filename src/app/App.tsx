import { useState, useEffect, useCallback } from 'react'
import { useGoogleLogin } from '@react-oauth/google'
import {
  classifyEmailsBatch,
  compareFilesApi,
  type EmailType,
  type EmailStatus,
  type ComparisonField,
} from '../services/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type Page = 'dashboard' | 'inbox' | 'email-detail' | 'processing' | 'comparison' | 'review' | 'review-detail' | 'reports' | 'upload' | 'upload-comparison'

interface GmailEmail {
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
}

interface UserInfo { email: string; name: string; picture?: string }


// ─── Gmail API ────────────────────────────────────────────────────────────────

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function gmailFetch(token: string, path: string, retries = 3, backoff = 800): Promise<any> {
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

async function fetchInBatches<T, R>(items: T[], fn: (item: T) => Promise<R>, concurrency = 5): Promise<R[]> {
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

async function getUserInfo(token: string): Promise<UserInfo> {

  const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return r.json().then(d => ({ email: d.email, name: d.name, picture: d.picture }))
}

function decodeBase64(str: string) {
  try {
    return decodeURIComponent(
      atob(str.replace(/-/g, '+').replace(/_/g, '/'))
        .split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    )
  } catch { return '' }
}

function extractBody(payload: any): string {
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

function parseHeader(headers: { name: string; value: string }[], name: string) {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}

function classify(subject: string, snippet: string, body: string): EmailType {
  const t = `${subject} ${snippet} ${body}`.toLowerCase()
  if (t.includes('bill of lading') || t.includes('b/l') ||
    (t.includes('bl') && (t.includes('draft') || t.includes('confirm') || t.includes('shipping instruction'))) ||
    (t.includes('draft') && t.includes('lading'))) return 'Document Comparison'
  if (t.includes('invoice') || t.includes('remittance')) return 'Invoice Query'
  if (t.includes('shipping instruction') && !t.includes('bill of lading')) return 'New SI Request'
  if (t.includes('unsubscribe') || t.includes('promotion') || t.includes('special offer')) return 'Spam'
  return 'General'
}

function mockStatus(type: EmailType, id: string): EmailStatus {
  if (type !== 'Document Comparison') return 'Classified'
  const h = id.charCodeAt(id.length - 1) % 4
  return h === 0 ? 'Mismatch' : h === 1 ? 'Needs Review' : h === 2 ? 'Match' : 'New'
}

function fmtDate(ts: number) {
  const d = new Date(ts), now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if ((now.getTime() - ts) < 172800000) return 'Yesterday'
  if ((now.getTime() - ts) < 604800000) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

function parseFrom(from: string) {
  const m = from.match(/^(.*?)\s*<(.+?)>$/)
  return m ? { name: m[1].replace(/"/g, '').trim() || m[2], email: m[2] } : { name: from, email: from }
}

interface GmailPageResult {
  emails: GmailEmail[]
  nextPageToken?: string
}

async function fetchEmailsPage(token: string, pageToken?: string, maxResults = 25): Promise<GmailPageResult> {
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

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK: GmailEmail[] = [
  { id: 'e1', threadId: 't1', fromName: 'Operations Dept', from: 'operations@shipping.com', subject: 'RE: Draft BL for Shipment #48291', snippet: 'Please review the attached draft Bill of Lading against our SI...', date: '10:42 AM', timestamp: Date.now() - 3600000, type: 'Document Comparison', status: 'Mismatch', hasAttachments: true },
  { id: 'e2', threadId: 't2', fromName: 'Klang Freight', from: 'freight@klangport.my', subject: 'RE: BL Confirmation #48288 – Port Klang', snippet: 'Attaching revised BL draft. Please confirm container count matches SI...', date: '10:18 AM', timestamp: Date.now() - 5400000, type: 'Document Comparison', status: 'Match', hasAttachments: true },
  { id: 'e3', threadId: 't3', fromName: 'XYZ Trading', from: 'accounts@xyztrading.com', subject: 'Invoice #39281 – Query on freight charges', snippet: 'Please clarify the additional freight surcharge added to invoice #39281...', date: '09:54 AM', timestamp: Date.now() - 7200000, type: 'Invoice Query', status: 'Classified', hasAttachments: false },
  { id: 'e4', threadId: 't4', fromName: 'Global Freight', from: 'ops@globalfreight.com', subject: 'New Shipping Instruction – Order #2026-09-047', snippet: 'Please find enclosed the new Shipping Instruction for Order #2026-09-047...', date: '09:31 AM', timestamp: Date.now() - 9000000, type: 'New SI Request', status: 'Classified', hasAttachments: true },
  { id: 'e5', threadId: 't5', fromName: 'Promotions', from: 'no-reply@promotions.biz', subject: 'Special Offer: Freight rates reduced 30%!', snippet: 'Limited time offer on freight forwarding services. Click here...', date: '08:47 AM', timestamp: Date.now() - 11000000, type: 'Spam', status: 'Classified', hasAttachments: false },
  { id: 'e6', threadId: 't6', fromName: 'ABC Logistics', from: 'logistics@abcltd.com', subject: 'RE: Draft BL #48300 – urgent review needed', snippet: 'BL attachment could not be read by our system. Human review required...', date: '08:22 AM', timestamp: Date.now() - 13000000, type: 'Document Comparison', status: 'Needs Review', hasAttachments: true },
  { id: 'e7', threadId: 't7', fromName: 'Port Ops', from: 'ops@shipping.com', subject: 'Operational update – route change advisory', snippet: 'Tanjung Pelepas terminal operates reduced capacity 22–25 Sep 2026...', date: 'Yesterday', timestamp: Date.now() - 86400000, type: 'General', status: 'Classified', hasAttachments: false },
]

const COMPARISON: ComparisonField[] = [
  { field: 'Shipper', si: 'ABC Logistics Ltd.', bl: 'ABC Logistics Ltd.', match: true },
  { field: 'Consignee', si: 'XYZ Trading Pte Ltd.', bl: 'XYZ Trading Pte Ltd.', match: true },
  { field: 'Notify Party', si: 'XYZ Trading Pte Ltd.', bl: 'XYZ Trading Pte Ltd.', match: true },
  { field: 'Port of Loading', si: 'Port Klang', bl: 'Port Klang', match: true },
  { field: 'Port of Discharge', si: 'Singapore', bl: 'Singapore', match: true },
  { field: 'Container Count', si: '3', bl: '4', match: false },
  { field: 'Gross Weight (kg)', si: '22,000', bl: '22,000', match: true },
]

// ─── Design tokens ────────────────────────────────────────────────────────────

const bg = '#EDEAE2'        // warm beige main bg (from Emotion Monitor)
const surface = '#F7F5EF'   // slightly warmer surface
const white = '#FFFFFF'
const navy = '#1B3652'
const navyMid = '#264D76'
const border = '#D8D3C8'
const borderLight = '#E5E1D8'
const ink = '#1A1612'
const muted = '#6B6560'
const faint = '#A8A298'
const amber = '#B45309'
const amberBg = '#FEF3C7'
const amberBdr = '#F6D860'
const green = '#166534'
const greenBg = '#DCFCE7'

// ─── Primitives ───────────────────────────────────────────────────────────────

// "— LABEL STYLE" section marker
function SectionLabel({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span style={{ color: muted, fontSize: 13, fontWeight: 400 }}>—</span>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: muted }}>{children}</span>
    </div>
  )
}

function Divider() {
  return <div style={{ height: 1, background: borderLight, margin: '20px 0' }} />
}

function Badge({ label }: { label: string }) {
  const map: Record<string, { bg: string; color: string; border: string }> = {
    'Document Comparison': { bg: '#EEF2FF', color: '#3730A3', border: '#C7D2FE' },
    'New SI Request':      { bg: greenBg,  color: green,     border: '#86EFAC' },
    'Invoice Query':       { bg: amberBg,  color: amber,     border: amberBdr },
    'General':             { bg: '#F3F4F6', color: '#4B5563', border: '#E5E7EB' },
    'Spam':                { bg: '#FFF1F2', color: '#9F1239', border: '#FECDD3' },
    'Mismatch':            { bg: amberBg,  color: '#92400E', border: amberBdr },
    'Needs Review':        { bg: amberBg,  color: '#92400E', border: amberBdr },
    'Match':               { bg: greenBg,  color: green,     border: '#86EFAC' },
    'Classified':          { bg: '#F3F4F6', color: '#4B5563', border: '#E5E7EB' },
    'New':                 { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
  }
  const s = map[label] || map['Classified']
  const dot = label === 'Mismatch' || label === 'Needs Review' || label === 'Match'
  return (
    <span className="inline-flex items-center gap-1" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '3px 8px', border: `1px solid ${s.border}`, borderRadius: 3, background: s.bg, color: s.color }}>
      {dot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: label === 'Match' ? green : '#D97706', display: 'inline-block' }} />}
      {label}
    </span>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ page, onNav, user, emails }: { page: Page; onNav: (p: Page) => void; user: UserInfo | null; emails: GmailEmail[] }) {
  const attn = emails.filter(e => e.status === 'Mismatch' || e.status === 'Needs Review').length
  const unread = emails.filter(e => e.status === 'New').length
  const reviewCount = emails.filter(e => e.status === 'Needs Review').length

  const nav: { id: Page; label: string; count?: number }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'inbox', label: 'Inbox', count: unread || undefined },
    { id: 'upload', label: 'Upload & Compare' },
    { id: 'review', label: 'Review', count: reviewCount || undefined },
    { id: 'reports', label: 'Reports' },
  ]

  return (
    <aside className="app-sidebar" style={{ background: navy }}>
      {/* Logo */}
      <div style={{ padding: '28px 20px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
          <div style={{ width: 30, height: 30, borderRadius: 6, background: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M2 3.5h12M2 7.5h8M2 11.5h10" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="14" cy="11" r="2" fill="#F59E0B"/>
            </svg>
          </div>
          <div>
            <div style={{ fontFamily: 'Playfair Display, serif', color: 'white', fontSize: 16, fontWeight: 700, lineHeight: 1 }}>ShipCheck</div>
          </div>
        </div>
        <div style={{ fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', paddingLeft: 40, marginTop: 4 }}>by Averis · Est. 2026</div>
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '0 20px' }} />

      {/* Nav */}
      <nav style={{ flex: 1, padding: '16px 0' }}>
        <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', padding: '0 20px', marginBottom: 8, fontWeight: 600 }}>Navigation</div>
        {nav.map(({ id, label, count }) => {
          const active = page === id
          return (
            <button
              key={id}
              onClick={() => onNav(id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 20px', border: 'none', background: 'none',
                cursor: 'pointer', textAlign: 'left', position: 'relative',
                borderLeft: active ? '2px solid #F59E0B' : '2px solid transparent',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: active ? 600 : 400, color: active ? 'white' : 'rgba(255,255,255,0.5)', flex: 1 }}>{label}</span>
              {count ? (
                <span style={{ fontSize: 10, fontWeight: 700, minWidth: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3, background: '#F59E0B', color: ink, padding: '0 4px' }}>{count}</span>
              ) : null}
            </button>
          )
        })}
      </nav>


      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '0 20px' }} />

      {/* User */}
      <div style={{ padding: '12px 20px 20px' }}>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            {user.picture
              ? <img src={user.picture} style={{ width: 26, height: 26, borderRadius: '50%' }} alt="" />
              : <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'white' }}>{user.name?.[0]}</div>
            }
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'white', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
            </div>
          </div>
        )}
        <button style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>
          <SettingsIcon /> Settings
        </button>
      </div>
    </aside>
  )
}

// ─── TopBar ───────────────────────────────────────────────────────────────────

function TopBar({
  crumb,
  onRefresh,
  loading,
  classifying,
}: {
  crumb: string
  onRefresh?: () => void
  loading?: boolean
  classifying?: { active: boolean; current: number; total: number; error: string | null }
}) {
  const now = new Date()
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()
  const [, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick(n => n + 1), 1000); return () => clearInterval(t) }, [])

  return (
    <div className="app-topbar" style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', background: white, borderBottom: `1px solid ${border}` }}>
      <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: muted, fontWeight: 500 }}>
        — {crumb}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {classifying?.active && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: '#1E40AF', background: '#EFF6FF', border: '1px solid #BFDBFE', padding: '3px 9px', borderRadius: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid #2563EB', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
            AI CLASSIFYING ({classifying.current}/{classifying.total})
          </div>
        )}
        {classifying?.error && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: '#991B1B', background: '#FEF2F2', border: '1px solid #FECACA', padding: '3px 8px', borderRadius: 4 }}>
            <span>⚠</span> AI BACKEND ERROR
          </div>
        )}
        {onRefresh && (
          <button onClick={onRefresh} disabled={loading || classifying?.active} style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: navy, border: `1px solid ${border}`, borderRadius: 4, padding: '4px 12px', background: 'none', cursor: 'pointer', opacity: loading || classifying?.active ? 0.5 : 1 }}>
            {loading ? 'Loading…' : '↺ Refresh'}
          </button>
        )}
        <div style={{ fontSize: 11, color: faint, letterSpacing: '0.06em' }}>
          <span style={{ color: muted, fontWeight: 500 }}>{timeStr}</span> · {dateStr}
        </div>
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardPage({ emails, user, onNav, onSelect }: { emails: GmailEmail[]; user: UserInfo | null; onNav: (p: Page) => void; onSelect: (id: string) => void }) {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.name?.split(' ')[0] || 'User'

  const docComps = emails.filter(e => e.type === 'Document Comparison')
  const mismatches = emails.filter(e => e.status === 'Mismatch')
  const review = emails.filter(e => e.status === 'Needs Review')
  const attention = emails.filter(e => e.status === 'Mismatch' || e.status === 'Needs Review')

  return (
    <div style={{ padding: 28, flex: 1 }}>
      {/* Greeting */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 36, fontWeight: 700, color: ink, lineHeight: 1.1, margin: '0 0 14px' }}>
          {greeting}, <em style={{ fontStyle: 'italic', color: navy }}>{firstName}.</em>
        </h1>

        {/* Status strip — amber background only on actionable cells */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, border: `1px solid ${border}`, borderRadius: 4, overflow: 'hidden' }}>
          {[
            { label: 'Emails', value: emails.length, sub: 'in inbox', urgent: false, click: () => onNav('inbox') },
            { label: 'Doc Checks', value: docComps.length, sub: `${docComps.filter(e => e.status === 'Match').length} matched`, urgent: false, click: () => onNav('inbox') },
            { label: 'Mismatches', value: mismatches.length, sub: mismatches.length ? 'Action required' : 'All clear', urgent: mismatches.length > 0, click: () => onNav('inbox') },
            { label: 'Needs Review', value: review.length, sub: review.length ? 'Human review' : 'None pending', urgent: review.length > 0, click: () => onNav('review') },
          ].map((s, i) => (
            <button
              key={i}
              onClick={s.click}
              style={{ flex: 1, padding: '12px 18px', border: 'none', background: s.urgent ? amberBg : white, cursor: 'pointer', textAlign: 'left', borderLeft: i > 0 ? `1px solid ${s.urgent ? amberBdr : border}` : 'none', borderTop: s.urgent ? `2px solid ${amber}` : '2px solid transparent' }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: s.urgent ? amber : faint, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 28, fontWeight: 700, color: s.urgent ? '#92400E' : navy, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 11, color: s.urgent ? amber : faint, marginTop: 3 }}>{s.sub}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        {/* Recent emails */}
        <div>
          <SectionLabel>Recent Activity</SectionLabel>
          <div style={{ border: `1px solid ${border}`, borderRadius: 4, overflow: 'hidden', background: white }}>
            {emails.slice(0, 6).map((e, i) => {
              return (
                <button
                  key={e.id}
                  onClick={() => onSelect(e.id)}
                  style={{ width: '100%', display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 20px', border: 'none', background: 'white', cursor: 'pointer', textAlign: 'left', borderBottom: i < 5 ? `1px solid ${borderLight}` : 'none' }}
                  onMouseEnter={ev => (ev.currentTarget as HTMLButtonElement).style.background = surface}
                  onMouseLeave={ev => (ev.currentTarget as HTMLButtonElement).style.background = 'white'}
                >
                  <div style={{ width: 28, height: 28, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, background: '#EEF2FF', color: '#3730A3', marginTop: 1 }}>
                    {e.fromName?.[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>{e.subject}</span>
                      <span style={{ fontSize: 10, color: faint, whiteSpace: 'nowrap', marginLeft: 8 }}>{e.date}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: muted }}>{e.fromName}</span>
                      <Badge label={e.type} />
                      {e.type === 'Document Comparison' && <Badge label={e.status} />}
                    </div>
                  </div>
                </button>
              )
            })}
            <button onClick={() => onNav('inbox')} style={{ width: '100%', padding: '10px 20px', border: 'none', background: surface, cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: navy, textAlign: 'left', borderTop: `1px solid ${borderLight}` }}>
              View all {emails.length} emails →
            </button>
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Flagged items — minimal, no amber backgrounds */}
          <div>
            <SectionLabel>Flagged</SectionLabel>
            <div style={{ border: `1px solid ${border}`, borderRadius: 4, overflow: 'hidden', background: white }}>
              {attention.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: green }}>✓ All clear</div>
                  <div style={{ fontSize: 11, color: faint, marginTop: 2 }}>No items flagged</div>
                </div>
              ) : attention.map((e, i) => (
                <button
                  key={e.id}
                  onClick={() => onSelect(e.id)}
                  style={{ width: '100%', padding: '11px 14px', border: 'none', background: 'white', cursor: 'pointer', textAlign: 'left', borderBottom: i < attention.length - 1 ? `1px solid ${borderLight}` : 'none' }}
                  onMouseEnter={ev => (ev.currentTarget as HTMLButtonElement).style.background = surface}
                  onMouseLeave={ev => (ev.currentTarget as HTMLButtonElement).style.background = 'white'}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: ink, marginBottom: 4, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.subject}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Badge label={e.status} />
                    <span style={{ fontSize: 10, color: faint }}>{e.date}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Recent Comparisons — last processed BL checks with outcome */}
          <div>
            <SectionLabel>Recent Comparisons</SectionLabel>
            <div style={{ border: `1px solid ${border}`, borderRadius: 4, background: white, overflow: 'hidden' }}>
              {(() => {
                const recent = emails.filter(e => e.type === 'Document Comparison' && e.status !== 'New' && e.status !== 'Processing')
                if (recent.length === 0) return (
                  <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 12, color: faint }}>No comparisons processed yet</div>
                )
                return recent.slice(0, 4).map((e, i) => {
                  const isMatch = e.status === 'Match'
                  const isMismatch = e.status === 'Mismatch'
                  const isReview = e.status === 'Needs Review'
                  const outcomeColor = isMatch ? green : isMismatch || isReview ? amber : muted
                  const outcomeIcon = isMatch ? '✓' : isMismatch ? '⚠' : isReview ? '?' : '—'
                  return (
                    <button
                      key={e.id}
                      onClick={() => onSelect(e.id)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', background: white, cursor: 'pointer', textAlign: 'left', borderBottom: i < Math.min(recent.length, 4) - 1 ? `1px solid ${borderLight}` : 'none' }}
                      onMouseEnter={ev => (ev.currentTarget as HTMLButtonElement).style.background = surface}
                      onMouseLeave={ev => (ev.currentTarget as HTMLButtonElement).style.background = white}
                    >
                      <div style={{ width: 24, height: 24, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, background: isMatch ? '#DCFCE7' : isMismatch || isReview ? amberBg : '#F3F4F6', color: outcomeColor }}>
                        {outcomeIcon}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.subject}</div>
                        <div style={{ fontSize: 10, color: faint, marginTop: 1 }}>{e.date}</div>
                      </div>
                      <Badge label={e.status} />
                    </button>
                  )
                })
              })()}
              <button onClick={() => onNav('reports')} style={{ width: '100%', padding: '8px 14px', border: 'none', background: surface, cursor: 'pointer', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: navy, textAlign: 'left', borderTop: `1px solid ${borderLight}` }}>
                View history →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Inbox ────────────────────────────────────────────────────────────────────

const CATEGORY_ORDER = ['Document Comparison', 'New SI Request', 'Invoice Query', 'General', 'Spam'] as const
const ALL_CLASSIFICATIONS = ['Document Comparison', 'New SI Request', 'Invoice Query', 'General', 'Spam'] as const
const ALL_BL_STATUSES = ['Match', 'Mismatch', 'Needs Review', 'New', 'Classified'] as const

interface InboxFilters {
  classifications: string[]
  blStatuses: string[]
  senderSearch: string
  dateSort: 'recent' | 'old'
}

const DEFAULT_FILTERS: InboxFilters = { classifications: [], blStatuses: [], senderSearch: '', dateSort: 'recent' }

function EmailRow({ e, onSelect, isLast }: { e: GmailEmail; onSelect: (id: string) => void; isLast: boolean }) {
  const warn = e.status === 'Mismatch' || e.status === 'Needs Review'
  return (
    <tr
      onClick={() => onSelect(e.id)}
      style={{ cursor: 'pointer', background: 'white', borderBottom: !isLast ? `1px solid ${borderLight}` : 'none' }}
      onMouseEnter={ev => (ev.currentTarget as HTMLTableRowElement).style.background = surface}
      onMouseLeave={ev => (ev.currentTarget as HTMLTableRowElement).style.background = 'white'}
    >
      <td style={{ padding: '14px 16px', width: 16 }}>
        {warn && <span style={{ width: 7, height: 7, borderRadius: '50%', background: amber, display: 'block' }} />}
      </td>
      <td style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: ink, whiteSpace: 'nowrap', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.fromName}</div>
        <div style={{ fontSize: 11, color: muted, whiteSpace: 'nowrap', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.from}</div>
      </td>
      <td style={{ padding: '14px 16px', maxWidth: 300 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.subject}</div>
        <div style={{ fontSize: 12, color: muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{e.snippet}</div>
      </td>
      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}><Badge label={e.type} /></td>
      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
        {e.type === 'Document Comparison' ? <Badge label={e.status} /> : <span style={{ color: faint, fontSize: 13 }}>—</span>}
      </td>
      <td style={{ padding: '14px 16px', fontSize: 12, color: muted, whiteSpace: 'nowrap' }}>{e.date}</td>
    </tr>
  )
}

function EmailTable({ rows, onSelect }: { rows: GmailEmail[]; onSelect: (id: string) => void }) {
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 4, overflow: 'hidden', background: white }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${borderLight}`, background: surface }}>
            {['', 'Sender', 'Subject', 'Classification', 'BL Status', 'Date'].map(h => (
              <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => <EmailRow key={e.id} e={e} onSelect={onSelect} isLast={i === rows.length - 1} />)}
          {!rows.length && (
            <tr><td colSpan={6} style={{ padding: '48px 20px', textAlign: 'center', color: faint, fontSize: 14 }}>No emails match.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function FilterDropdown({ filters, onChange }: { filters: InboxFilters; onChange: (f: InboxFilters) => void }) {
  const [open, setOpen] = useState(false)

  const activeCount = filters.classifications.length + filters.blStatuses.length +
    (filters.senderSearch ? 1 : 0) + (filters.dateSort !== 'recent' ? 1 : 0)

  function toggleSet(key: 'classifications' | 'blStatuses', val: string) {
    const cur = filters[key]
    onChange({ ...filters, [key]: cur.includes(val) ? cur.filter(x => x !== val) : [...cur, val] })
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
          padding: '7px 14px', borderRadius: 4, cursor: 'pointer',
          border: `1px solid ${activeCount > 0 ? navy : border}`,
          background: activeCount > 0 ? navy : white,
          color: activeCount > 0 ? white : muted,
        }}
      >
        <span>⊞ Filter</span>
        {activeCount > 0 && (
          <span style={{ fontSize: 10, fontWeight: 700, minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'rgba(255,255,255,0.25)', color: white, padding: '0 4px' }}>{activeCount}</span>
        )}
        <span style={{ fontSize: 10, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setOpen(false)} />
          {/* panel */}
          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 100, width: 320, background: white, border: `1px solid ${border}`, borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.10)', overflow: 'hidden' }}>
            {/* Classification */}
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${borderLight}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted, marginBottom: 10 }}>Classification</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ALL_CLASSIFICATIONS.map(c => (
                  <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: ink }}>
                    <input
                      type="checkbox"
                      checked={filters.classifications.includes(c)}
                      onChange={() => toggleSet('classifications', c)}
                      style={{ accentColor: navy, width: 14, height: 14 }}
                    />
                    {c}
                  </label>
                ))}
              </div>
            </div>

            {/* BL Status */}
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${borderLight}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted, marginBottom: 10 }}>BL Status</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {ALL_BL_STATUSES.map(s => {
                  const active = filters.blStatuses.includes(s)
                  return (
                    <button
                      key={s}
                      onClick={() => toggleSet('blStatuses', s)}
                      style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 3, border: `1px solid ${active ? navy : border}`, background: active ? navy : 'none', color: active ? white : muted, cursor: 'pointer', letterSpacing: '0.04em' }}
                    >{s}</button>
                  )
                })}
              </div>
            </div>

            {/* Sender */}
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${borderLight}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted, marginBottom: 10 }}>Sender</div>
              <input
                value={filters.senderSearch}
                onChange={e => onChange({ ...filters, senderSearch: e.target.value })}
                placeholder="Filter by sender name or email…"
                style={{ width: '100%', fontSize: 13, padding: '7px 10px', border: `1px solid ${border}`, borderRadius: 4, background: surface, color: ink, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Date sort */}
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${borderLight}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted, marginBottom: 10 }}>Date</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['recent', 'old'] as const).map(opt => (
                  <button
                    key={opt}
                    onClick={() => onChange({ ...filters, dateSort: opt })}
                    style={{ fontSize: 11, fontWeight: 600, padding: '5px 14px', borderRadius: 3, border: `1px solid ${filters.dateSort === opt ? navy : border}`, background: filters.dateSort === opt ? navy : 'none', color: filters.dateSort === opt ? white : muted, cursor: 'pointer', letterSpacing: '0.04em', textTransform: 'capitalize' }}
                  >{opt === 'recent' ? 'Recent first' : 'Oldest first'}</button>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { onChange(DEFAULT_FILTERS); setOpen(false) }}
                style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '5px 12px', border: `1px solid ${border}`, borderRadius: 3, background: 'none', color: muted, cursor: 'pointer' }}
              >Clear all</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function InboxPage({
  emails,
  onSelect,
  classifying,
  onClassify,
  apiError,
  onClearError,
  hasMore,
  onLoadMore,
  loadingMore,
}: {
  emails: GmailEmail[]
  onSelect: (id: string) => void
  classifying?: { active: boolean; current: number; total: number; error: string | null }
  onClassify?: () => void
  apiError?: string | null
  onClearError?: () => void
  hasMore?: boolean
  onLoadMore?: () => void
  loadingMore?: boolean
}) {
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_FILTERS)

  const isFiltered = search || filters.classifications.length || filters.blStatuses.length || filters.senderSearch

  const processed = emails
    .filter(e => {
      if (search && !e.subject.toLowerCase().includes(search.toLowerCase()) && !e.fromName.toLowerCase().includes(search.toLowerCase())) return false
      if (filters.senderSearch && !e.fromName.toLowerCase().includes(filters.senderSearch.toLowerCase()) && !e.from.toLowerCase().includes(filters.senderSearch.toLowerCase())) return false
      if (filters.classifications.length && !filters.classifications.includes(e.type)) return false
      if (filters.blStatuses.length && !filters.blStatuses.includes(e.status)) return false
      return true
    })
    .sort((a, b) => filters.dateSort === 'recent' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp)

  const showGrouped = !isFiltered
  const progressPercent = classifying?.total ? Math.round((classifying.current / classifying.total) * 100) : 0

  return (
    <div style={{ padding: 28 }}>
      <SectionLabel>Email Inbox</SectionLabel>

      {/* Active AI Classification Progress Banner */}
      {classifying?.active && (
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 4, padding: '14px 20px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, fontWeight: 600, color: '#1E40AF' }}>
              <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #2563EB', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
              AI CLASSIFICATION IN PROGRESS: Analyzing emails with Claude Haiku ({classifying.current} of {classifying.total} completed)…
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#2563EB' }}>
              {progressPercent}%
            </span>
          </div>
          <div style={{ width: '100%', height: 4, background: '#DBEAFE', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${progressPercent}%`, height: '100%', background: '#2563EB', transition: 'width 0.3s ease' }} />
          </div>
        </div>
      )}

      {/* Explicit Backend Error Banner (No Silent Fallback) */}
      {(classifying?.error || apiError) && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#991B1B', fontWeight: 500 }}>
            <span style={{ fontSize: 14 }}>⚠</span>
            <span><strong>AI Backend Error:</strong> {classifying?.error || apiError}</span>
          </div>
          {onClearError && (
            <button onClick={onClearError} style={{ background: 'none', border: 'none', color: '#991B1B', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>✕ Dismiss</button>
          )}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: faint }}>
            <SearchIcon />
          </span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search emails…"
            style={{ width: '100%', paddingLeft: 32, paddingRight: 12, paddingTop: 8, paddingBottom: 8, fontSize: 13, border: `1px solid ${border}`, borderRadius: 4, background: white, color: ink, outline: 'none' }}
          />
        </div>
        <FilterDropdown filters={filters} onChange={setFilters} />
        {onClassify && (
          <button
            onClick={onClassify}
            disabled={classifying?.active}
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              background: classifying?.active ? borderLight : navy,
              color: white,
              border: 'none',
              borderRadius: 4,
              padding: '8px 14px',
              cursor: classifying?.active ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              opacity: classifying?.active ? 0.6 : 1,
            }}
          >
            {classifying?.active ? 'Classifying…' : '⚡ Classify with AI'}
          </button>
        )}
        {isFiltered && (
          <button
            onClick={() => { setSearch(''); setFilters(DEFAULT_FILTERS) }}
            style={{ fontSize: 11, fontWeight: 600, color: muted, background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.04em' }}
          >✕ Clear</button>
        )}
        <div style={{ marginLeft: 'auto', fontSize: 12, color: faint }}>{processed.length} email{processed.length !== 1 ? 's' : ''}</div>
      </div>

      {showGrouped ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {CATEGORY_ORDER.map(cat => {
            const group = processed.filter(e => e.type === cat)
            if (!group.length) return null
            return (
              <div key={cat}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ color: muted, fontSize: 13 }}>—</span>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted }}>{cat}</span>
                  <span style={{ fontSize: 11, color: faint }}>({group.length})</span>
                </div>
                <EmailTable rows={group} onSelect={onSelect} />
              </div>
            )
          })}
        </div>
      ) : (
        <EmailTable rows={processed} onSelect={onSelect} />
      )}

      {hasMore && (
        <div style={{ marginTop: 28, textAlign: 'center' }}>
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            style={{
              padding: '10px 24px',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: navy,
              background: white,
              border: `1px solid ${border}`,
              borderRadius: 4,
              cursor: loadingMore ? 'not-allowed' : 'pointer',
              opacity: loadingMore ? 0.6 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {loadingMore && <span style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${navy}`, borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />}
            {loadingMore ? 'Loading more emails…' : 'Load More Emails (25)'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Email Detail ─────────────────────────────────────────────────────────────

function EmailDetailPage({ email, onBack, onProcess }: { email: GmailEmail; onBack: () => void; onProcess: () => void }) {
  const isDoc = email.type === 'Document Comparison'
  return (
    <div style={{ padding: 28 }}>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: navy, border: `1px solid ${border}`, background: white, cursor: 'pointer', padding: '7px 14px', borderRadius: 4, marginBottom: 24 }}>← Back to Inbox</button>

      <div style={{ border: `1px solid ${border}`, borderRadius: 4, background: white, padding: '24px 28px', marginBottom: 16 }}>
        <h2 style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: ink, margin: '0 0 18px' }}>{email.subject}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: '8px 12px', fontSize: 14, marginBottom: 16 }}>
          <span style={{ color: muted, fontWeight: 600, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', paddingTop: 2 }}>From</span><span style={{ color: ink }}>{email.fromName} &lt;{email.from}&gt;</span>
          <span style={{ color: muted, fontWeight: 600, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', paddingTop: 2 }}>Date</span><span style={{ color: ink }}>{email.date}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, paddingTop: 12, borderTop: `1px solid ${borderLight}` }}>
          <Badge label={email.type} />
          {isDoc && <Badge label={email.status} />}
        </div>
      </div>

      {email.body && (
        <div style={{ border: `1px solid ${border}`, borderRadius: 4, background: white, padding: '20px 24px', marginBottom: 16 }}>
          <SectionLabel>Message</SectionLabel>
          <p style={{ fontSize: 14, color: ink, lineHeight: 1.7, whiteSpace: 'pre-line', margin: 0 }}>{email.body}</p>
        </div>
      )}

      {email.hasAttachments && (
        <div style={{ border: `1px solid ${border}`, borderRadius: 4, background: white, padding: '20px 24px', marginBottom: 16 }}>
          <SectionLabel>Attachments</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <AttRow name="Shipping_Instruction.pdf" />
            {isDoc && <AttRow name="Draft_Bill_of_Lading.pdf" warn={email.status === 'Needs Review'} />}
          </div>
        </div>
      )}

      {isDoc ? (
        <div style={{ border: `1px solid ${border}`, borderRadius: 4, background: '#EEF2FF', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1E1B4B' }}>Compare SI vs Bill of Lading</div>
            <div style={{ fontSize: 11, color: '#3730A3', marginTop: 2 }}>Analyse 7 fields and surface discrepancies</div>
          </div>
          <button onClick={onProcess} style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '10px 20px', background: navy, color: white, border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            Process Documents
          </button>
        </div>
      ) : (
        <div style={{ border: `1px solid ${borderLight}`, borderRadius: 4, background: surface, padding: '16px 24px' }}>
          <p style={{ fontSize: 13, color: muted, margin: 0 }}>This email is classified as <strong style={{ color: ink }}>{email.type}</strong> and does not require document comparison.</p>
        </div>
      )}
    </div>
  )
}

function AttRow({ name, warn }: { name: string; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: `1px solid ${warn ? amberBdr : borderLight}`, borderRadius: 4, background: warn ? amberBg : surface }}>
      <span style={{ color: '#DC2626', fontSize: 16 }}>📄</span>
      <span style={{ fontSize: 12, fontWeight: 500, color: ink, flex: 1 }}>{name}</span>
      {warn
        ? <span style={{ fontSize: 10, fontWeight: 700, color: amber, textTransform: 'uppercase', letterSpacing: '0.06em' }}>⚠ Unreadable</span>
        : <span style={{ fontSize: 10, fontWeight: 700, color: navy, textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer' }}>View</span>
      }
    </div>
  )
}

// ─── Processing ───────────────────────────────────────────────────────────────

function ProcessingPage({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 800)
    const t2 = setTimeout(() => setStep(2), 1700)
    const t3 = setTimeout(() => { setStep(3); setTimeout(onDone, 600) }, 2600)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [])
  const steps = [
    { label: 'Email classified', done: true },
    { label: 'Shipping Instruction identified', done: true },
    { label: 'Bill of Lading identified', done: true },
    { label: 'Extracting shipment fields', done: step >= 1 },
    { label: 'Comparing SI and BL', done: step >= 2 },
    { label: 'Preparing report', done: step >= 3 },
  ]
  const cur = steps.findIndex(s => !s.done)
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ border: `1px solid ${border}`, borderRadius: 4, background: white, padding: '40px 48px', width: '100%', maxWidth: 400 }}>
        <SectionLabel>Processing Documents</SectionLabel>
        <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 22, fontWeight: 700, color: ink, marginBottom: 6 }}>Extracting fields</div>
        <p style={{ fontSize: 12, color: muted, marginBottom: 28 }}>Comparing 7 shipment fields across SI and BL</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {steps.map((s, i) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {s.done
                ? <span style={{ width: 18, height: 18, borderRadius: '50%', background: greenBg, border: `1px solid #86EFAC`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: green, flexShrink: 0 }}>✓</span>
                : i === cur
                  ? <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${navy}`, borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite', display: 'inline-block', flexShrink: 0 }} />
                  : <span style={{ width: 18, height: 18, borderRadius: '50%', border: `1px solid ${border}`, flexShrink: 0, display: 'block' }} />
              }
              <span style={{ fontSize: 13, color: s.done ? ink : i === cur ? navy : faint, fontWeight: i === cur ? 600 : 400 }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Comparison Result ────────────────────────────────────────────────────────

function ComparisonPage({ onBack }: { onBack: () => void }) {
  const mismatches = COMPARISON.filter(f => !f.match)
  return (
    <div style={{ padding: 28 }}>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: navy, border: `1px solid ${border}`, background: white, cursor: 'pointer', padding: '7px 14px', borderRadius: 4, marginBottom: 24 }}>← Back</button>
      <SectionLabel>Shipment Comparison — SI vs Bill of Lading</SectionLabel>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: 'Playfair Display, serif', fontSize: 26, fontWeight: 700, color: ink, margin: '0 0 6px' }}>Shipment #48291</h2>
          <p style={{ fontSize: 12, color: muted, margin: 0 }}>Shipping_Instruction.pdf · Draft_Bill_of_Lading.pdf</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: amberBg, border: `1px solid ${amberBdr}`, borderRadius: 4, fontSize: 12, fontWeight: 700, color: '#92400E' }}>
          ⚠ {mismatches.length} mismatch{mismatches.length !== 1 ? 'es' : ''} found
        </div>
      </div>

      <div style={{ border: `1px solid ${border}`, borderRadius: 4, overflow: 'hidden', background: white, marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: surface, borderBottom: `1px solid ${borderLight}` }}>
              {['Field', 'Shipping Instruction', 'Bill of Lading', 'Status'].map(h => (
                <th key={h} style={{ padding: '12px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARISON.map((f, i) => (
              <tr key={f.field} style={{ background: f.match ? 'white' : amberBg, borderBottom: i < COMPARISON.length - 1 ? `1px solid ${borderLight}` : 'none' }}>
                <td style={{ padding: '13px 20px', fontWeight: 600, color: ink }}>{f.field}</td>
                <td style={{ padding: '13px 20px', color: ink }}>{f.si}</td>
                <td style={{ padding: '13px 20px', fontWeight: f.match ? 400 : 700, color: f.match ? ink : '#92400E' }}>{f.bl}</td>
                <td style={{ padding: '13px 20px' }}>
                  {f.match
                    ? <span style={{ fontSize: 10, fontWeight: 700, color: green, letterSpacing: '0.06em', textTransform: 'uppercase' }}>✓ Match</span>
                    : <span style={{ fontSize: 10, fontWeight: 700, color: amber, letterSpacing: '0.06em', textTransform: 'uppercase' }}>⚠ Mismatch</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mismatches.length > 0 && (
        <div style={{ border: `1px solid ${amberBdr}`, borderRadius: 4, overflow: 'hidden', background: white }}>
          <div style={{ padding: '12px 20px', background: amberBg, borderBottom: `1px solid ${amberBdr}` }}>
            <SectionLabel>Attention Required</SectionLabel>
          </div>
          {mismatches.map(f => (
            <div key={f.field} style={{ padding: '20px 24px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: ink, marginBottom: 12 }}>{f.field}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ padding: '16px 20px', border: `1px solid ${border}`, borderRadius: 4, background: surface }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: muted, marginBottom: 8 }}>Shipping Instruction</div>
                  <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 36, fontWeight: 700, color: navy }}>{f.si}</div>
                </div>
                <div style={{ padding: '16px 20px', border: `1px solid ${amberBdr}`, borderRadius: 4, background: amberBg }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: amber, marginBottom: 8 }}>Bill of Lading</div>
                  <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 36, fontWeight: 700, color: '#92400E' }}>{f.bl}</div>
                </div>
              </div>
              <p style={{ fontSize: 11, color: faint, marginTop: 10 }}>Values do not match. Verify with issuing party before proceeding.</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Review ───────────────────────────────────────────────────────────────────

const REVIEW_ITEMS = [
  { id: 'r1', subject: 'RE: Draft BL #48300 – urgent review needed', reason: 'BL attachment could not be read', received: '08:22 AM' },
  { id: 'r2', subject: 'RE: BL #48290 – container count unreadable', reason: 'Container count could not be reliably extracted', received: 'Yesterday' },
]

function ReviewPage({ onSelect }: { onSelect: (id: string) => void }) {
  return (
    <div style={{ padding: 28 }}>
      <SectionLabel>Human Review Queue</SectionLabel>
      <div style={{ border: `1px solid ${amberBdr}`, borderRadius: 4, background: amberBg, padding: '10px 16px', marginBottom: 20, fontSize: 12, color: '#92400E' }}>
        ⚠ These cases could not be automatically processed and require manual verification.
      </div>
      <div style={{ border: `1px solid ${border}`, borderRadius: 4, overflow: 'hidden', background: white }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: surface, borderBottom: `1px solid ${borderLight}` }}>
              {['Email', 'Reason', 'Received', ''].map(h => (
                <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {REVIEW_ITEMS.map((r, i) => (
              <tr key={r.id} style={{ borderBottom: i < REVIEW_ITEMS.length - 1 ? `1px solid ${borderLight}` : 'none' }}>
                <td style={{ padding: '13px 20px', fontWeight: 600, color: ink, maxWidth: 280 }}>{r.subject}</td>
                <td style={{ padding: '13px 20px', color: muted }}>{r.reason}</td>
                <td style={{ padding: '13px 20px', fontSize: 11, color: faint }}>{r.received}</td>
                <td style={{ padding: '13px 20px', textAlign: 'right' }}>
                  <button onClick={() => onSelect(r.id)} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 14px', border: `1px solid ${border}`, borderRadius: 3, background: 'none', cursor: 'pointer', color: navy }}>
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ReviewDetailPage({ id, onBack }: { id: string; onBack: () => void }) {
  const item = REVIEW_ITEMS.find(r => r.id === id)!
  const [done, setDone] = useState(false)
  return (
    <div style={{ padding: 28 }}>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: navy, border: `1px solid ${border}`, background: white, cursor: 'pointer', padding: '7px 14px', borderRadius: 4, marginBottom: 24 }}>← Back to Review</button>
      <div style={{ border: `1px solid ${amberBdr}`, borderRadius: 4, background: amberBg, padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 18, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>⚠ Review Required</div>
        <p style={{ fontSize: 13, color: '#92400E', margin: 0 }}>{item.reason}.</p>
      </div>
      <SectionLabel>Source Evidence</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div style={{ border: `1px solid ${border}`, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ padding: '10px 20px', background: surface, borderBottom: `1px solid ${borderLight}`, fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: muted }}>Shipping Instruction</div>
          <div style={{ padding: '28px 24px' }}>
            <div style={{ fontSize: 10, color: faint, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Container Count</div>
            <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 52, fontWeight: 700, color: navy, lineHeight: 1 }}>3</div>
            <div style={{ fontSize: 11, color: green, marginTop: 10, fontWeight: 600 }}>✓ Extracted</div>
          </div>
        </div>
        <div style={{ border: `1px solid ${amberBdr}`, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ padding: '10px 20px', background: amberBg, borderBottom: `1px solid ${amberBdr}`, fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: amber }}>Bill of Lading</div>
          <div style={{ padding: '28px 24px' }}>
            <div style={{ fontSize: 10, color: faint, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Container Count</div>
            <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 52, fontWeight: 700, color: amber, lineHeight: 1 }}>—</div>
            <div style={{ fontSize: 11, color: amber, marginTop: 10, fontWeight: 600 }}>⚠ Unreadable</div>
          </div>
        </div>
      </div>
      {done ? (
        <div style={{ border: `1px solid #86EFAC`, borderRadius: 4, background: greenBg, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: green }}>✓</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: green }}>Case resolved and saved to reports.</span>
        </div>
      ) : (
        <div style={{ border: `1px solid ${border}`, borderRadius: 4, background: white, padding: '20px 24px' }}>
          <SectionLabel>Actions</SectionLabel>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setDone(true)} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '10px 20px', background: '#166534', color: white, border: 'none', borderRadius: 4, cursor: 'pointer' }}>✓ Confirm Match</button>
            <button onClick={() => setDone(true)} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '10px 20px', background: amberBg, color: amber, border: `1px solid ${amberBdr}`, borderRadius: 4, cursor: 'pointer' }}>⚠ Mark Mismatch</button>
            <button style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '10px 20px', background: 'none', color: muted, border: `1px solid ${border}`, borderRadius: 4, cursor: 'pointer' }}>↺ Retry</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Upload & Compare ─────────────────────────────────────────────────────────

async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map((item: any) => item.str).join(' '))
  }
  return pages.join('\n')
}

const FIELD_PATTERNS: { field: string; patterns: RegExp[] }[] = [
  { field: 'Shipper', patterns: [/shipper[:\s]+([^\n]{3,60})/i, /shipped by[:\s]+([^\n]{3,60})/i] },
  { field: 'Consignee', patterns: [/consignee[:\s]+([^\n]{3,60})/i, /to[:\s]+([^\n]{3,60})/i] },
  { field: 'Notify Party', patterns: [/notify\s*(?:party)?[:\s]+([^\n]{3,60})/i, /also notify[:\s]+([^\n]{3,60})/i] },
  { field: 'Port of Loading', patterns: [/port\s*of\s*load(?:ing)?[:\s]+([^\n]{3,40})/i, /pol[:\s]+([^\n]{3,40})/i, /loading\s*port[:\s]+([^\n]{3,40})/i] },
  { field: 'Port of Discharge', patterns: [/port\s*of\s*discharge[:\s]+([^\n]{3,40})/i, /pod[:\s]+([^\n]{3,40})/i, /discharge\s*port[:\s]+([^\n]{3,40})/i] },
  { field: 'Container Count', patterns: [/(\d+)\s*(?:x\s*)?(?:20|40)?(?:ft|')?\s*containers?/i, /no\.?\s*of\s*containers?[:\s]+(\d+)/i, /(\d+)\s*containers?/i] },
  { field: 'Gross Weight \(kg\)', patterns: [/gross\s*weight[:\s]+([0-9,.\s]+\s*kg)/i, /total\s*weight[:\s]+([0-9,.\s]+\s*kg)/i, /([0-9,]+)\s*kgs?/i] },
]

function extractField(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const m = text.match(pattern)
    if (m) return m[1].trim().replace(/\s+/g, ' ').slice(0, 60)
  }
  return ''
}

function compareDocuments(siText: string, blText: string): ComparisonField[] {
  return FIELD_PATTERNS.map(({ field, patterns }) => {
    const si = extractField(siText, patterns)
    const bl = extractField(blText, patterns)
    const match = !!si && !!bl && si.toLowerCase() === bl.toLowerCase()
    return { field, si: si || '—', bl: bl || '—', match }
  })
}

interface UploadedDoc { file: File; text: string }

function DropZone({ label, doc, onDrop, onClear }: {
  label: string; doc: UploadedDoc | null;
  onDrop: (f: File) => void; onClear: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const ref = { current: null as HTMLInputElement | null }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onDrop(f) }}
      style={{
        flex: 1, border: `2px dashed ${dragging ? navy : doc ? '#86EFAC' : border}`,
        borderRadius: 6, background: dragging ? '#EEF2FF' : doc ? greenBg : surface,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '40px 24px', cursor: 'pointer', transition: 'all 0.15s',
        minHeight: 200,
      }}
      onClick={() => !doc && ref.current?.click()}
    >
      <input ref={r => { ref.current = r }} type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onDrop(f) }} />
      {doc ? (
        <>
          <div style={{ fontSize: 28, marginBottom: 10 }}>✓</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: green, marginBottom: 4, textAlign: 'center' }}>{doc.file.name}</div>
          <div style={{ fontSize: 11, color: muted, marginBottom: 16 }}>{(doc.file.size / 1024).toFixed(0)} KB · PDF parsed</div>
          <button onClick={e => { e.stopPropagation(); onClear() }} style={{ fontSize: 11, color: muted, background: 'none', border: `1px solid ${border}`, borderRadius: 3, padding: '4px 10px', cursor: 'pointer' }}>Remove</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>📄</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: ink, marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 12, color: muted, marginBottom: 4 }}>Drop PDF here or click to browse</div>
          <div style={{ fontSize: 11, color: faint }}>PDF files only</div>
        </>
      )}
    </div>
  )
}

function UploadPage({ onCompare }: { onCompare: (result: ComparisonField[], siName: string, blName: string) => void }) {
  const [si, setSi] = useState<UploadedDoc | null>(null)
  const [bl, setBl] = useState<UploadedDoc | null>(null)
  const [parsing, setParsing] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [error, setError] = useState('')

  async function handleDrop(type: 'si' | 'bl', file: File) {
    setParsing(true)
    setError('')
    try {
      const text = await extractPdfText(file)
      if (type === 'si') setSi({ file, text })
      else setBl({ file, text })
    } catch {
      setError(`Could not parse ${file.name}. Make sure it's a valid PDF.`)
    } finally {
      setParsing(false)
    }
  }

  async function handleCompare() {
    if (!si || !bl) return
    setComparing(true)
    setError('')
    try {
      const res = await compareFilesApi(si.file, bl.file)
      onCompare(res.fields, si.file.name, bl.file.name)
    } catch (err: any) {
      setError(`AI Backend Comparison Failed: ${err.message || String(err)}. Please verify the FastAPI service is running at http://localhost:8000.`)
    } finally {
      setComparing(false)
    }
  }

  return (
    <div style={{ padding: 28 }}>
      <SectionLabel>Upload & Compare Documents</SectionLabel>
      <h2 style={{ fontFamily: 'Playfair Display, serif', fontSize: 26, fontWeight: 700, color: ink, margin: '0 0 6px' }}>SI vs Bill of Lading</h2>
      <p style={{ fontSize: 13, color: muted, marginBottom: 28 }}>Upload both documents as PDFs. ShipCheck sends them to the FastAPI AI service to extract and compare the 7 shipping fields using Claude & Vision models.</p>

      {parsing && (
        <div style={{ border: `1px solid ${border}`, borderRadius: 4, background: white, padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid ${navy}`, borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
          <span style={{ fontSize: 13, color: muted }}>Parsing PDF…</span>
        </div>
      )}
      {comparing && (
        <div style={{ border: `1px solid #BFDBFE`, borderRadius: 4, background: '#EFF6FF', padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 16, height: 16, borderRadius: '50%', border: `2px solid #2563EB`, borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
          <span style={{ fontSize: 13, color: '#1E40AF', fontWeight: 600 }}>Comparing documents with AI backend (extracting & verifying 7 shipment fields)…</span>
        </div>
      )}
      {error && (
        <div style={{ border: `1px solid #FECACA`, borderRadius: 4, background: '#FEF2F2', padding: '12px 16px', marginBottom: 20, fontSize: 13, color: '#991B1B' }}>⚠ {error}</div>
      )}

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <DropZone label="Shipping Instruction (SI)" doc={si} onDrop={f => handleDrop('si', f)} onClear={() => setSi(null)} />
        <DropZone label="Draft Bill of Lading (BL)" doc={bl} onDrop={f => handleDrop('bl', f)} onClear={() => setBl(null)} />
      </div>

      <button
        disabled={!si || !bl || parsing || comparing}
        onClick={handleCompare}
        style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '13px 32px', background: si && bl && !parsing && !comparing ? navy : border, color: white, border: 'none', borderRadius: 4, cursor: si && bl && !parsing && !comparing ? 'pointer' : 'not-allowed', opacity: si && bl && !parsing && !comparing ? 1 : 0.7 }}
      >
        {comparing ? 'Comparing with AI…' : 'Compare Documents →'}
      </button>

      <div style={{ marginTop: 32, border: `1px solid ${borderLight}`, borderRadius: 4, background: surface, padding: '16px 20px' }}>
        <SectionLabel>Fields Compared</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {FIELD_PATTERNS.map(f => (
            <div key={f.field} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: muted }}>
              <span style={{ color: green, fontWeight: 700, fontSize: 11 }}>✓</span> {f.field}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function UploadComparisonPage({ result, siName, blName, onBack }: {
  result: ComparisonField[]; siName: string; blName: string; onBack: () => void
}) {
  const mismatches = result.filter(f => !f.match)
  const unextracted = result.filter(f => f.si === '—' || f.bl === '—')

  return (
    <div style={{ padding: 28 }}>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: navy, border: `1px solid ${border}`, background: white, cursor: 'pointer', padding: '7px 14px', borderRadius: 4, marginBottom: 24 }}>← Upload New</button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontFamily: 'Playfair Display, serif', fontSize: 26, fontWeight: 700, color: ink, margin: '0 0 6px' }}>Comparison Result</h2>
          <p style={{ fontSize: 12, color: muted, margin: 0 }}>{siName} · {blName}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {mismatches.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: amberBg, border: `1px solid ${amberBdr}`, borderRadius: 4, fontSize: 12, fontWeight: 700, color: '#92400E' }}>
              ⚠ {mismatches.length} mismatch{mismatches.length !== 1 ? 'es' : ''}
            </div>
          )}
          {mismatches.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: greenBg, border: '1px solid #86EFAC', borderRadius: 4, fontSize: 12, fontWeight: 700, color: green }}>
              ✓ All fields match
            </div>
          )}
        </div>
      </div>

      {unextracted.length > 0 && (
        <div style={{ border: `1px solid ${border}`, borderRadius: 4, background: surface, padding: '12px 16px', marginBottom: 20, fontSize: 12, color: muted }}>
          ℹ {unextracted.length} field{unextracted.length !== 1 ? 's' : ''} could not be extracted — the PDF may use a non-standard format or scanned image text.
        </div>
      )}

      <div style={{ border: `1px solid ${border}`, borderRadius: 4, overflow: 'hidden', background: white }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: surface, borderBottom: `1px solid ${borderLight}` }}>
              {['Field', 'Shipping Instruction', 'Bill of Lading', 'Status'].map(h => (
                <th key={h} style={{ padding: '12px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.map((f, i) => {
              const unread = f.si === '—' || f.bl === '—'
              return (
                <tr key={f.field} style={{ background: f.match ? 'white' : unread ? surface : amberBg, borderBottom: i < result.length - 1 ? `1px solid ${borderLight}` : 'none' }}>
                  <td style={{ padding: '14px 20px', fontWeight: 600, color: ink }}>{f.field}</td>
                  <td style={{ padding: '14px 20px', color: ink }}>{f.si}</td>
                  <td style={{ padding: '14px 20px', fontWeight: f.match ? 400 : 700, color: f.match ? ink : f.bl === '—' ? faint : '#92400E' }}>{f.bl}</td>
                  <td style={{ padding: '14px 20px' }}>
                    {unread
                      ? <span style={{ fontSize: 11, fontWeight: 700, color: faint, letterSpacing: '0.06em', textTransform: 'uppercase' }}>— Unextracted</span>
                      : f.match
                        ? <span style={{ fontSize: 11, fontWeight: 700, color: green, letterSpacing: '0.06em', textTransform: 'uppercase' }}>✓ Match</span>
                        : <span style={{ fontSize: 11, fontWeight: 700, color: amber, letterSpacing: '0.06em', textTransform: 'uppercase' }}>⚠ Mismatch</span>
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Reports ──────────────────────────────────────────────────────────────────

const REPORTS = [
  { id: 'h1', subject: 'RE: Draft BL for Shipment #48291', type: 'Document Comparison', result: 'Mismatch', date: '20 Sep 2026' },
  { id: 'h2', subject: 'RE: BL Confirmation #48288', type: 'Document Comparison', result: 'Match', date: '20 Sep 2026' },
  { id: 'h3', subject: 'Invoice #39281', type: 'Invoice Query', result: 'Classified', date: '20 Sep 2026' },
  { id: 'h4', subject: 'New SI – Order #047', type: 'New SI Request', result: 'Classified', date: '19 Sep 2026' },
  { id: 'h5', subject: 'Draft BL #48285', type: 'Document Comparison', result: 'Match', date: '19 Sep 2026' },
]

function ReportsPage() {
  return (
    <div style={{ padding: 28 }}>
      <SectionLabel>Processing History</SectionLabel>
      <div style={{ border: `1px solid ${border}`, borderRadius: 4, overflow: 'hidden', background: white }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: surface, borderBottom: `1px solid ${borderLight}` }}>
              {['Email', 'Type', 'Result', 'Date'].map(h => (
                <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {REPORTS.map((r, i) => (
              <tr key={r.id} style={{ borderBottom: i < REPORTS.length - 1 ? `1px solid ${borderLight}` : 'none' }}>
                <td style={{ padding: '13px 20px', fontWeight: 500, color: ink }}>{r.subject}</td>
                <td style={{ padding: '13px 20px' }}><Badge label={r.type} /></td>
                <td style={{ padding: '13px 20px' }}><Badge label={r.result} /></td>
                <td style={{ padding: '13px 20px', fontSize: 11, color: faint }}>{r.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Login ────────────────────────────────────────────────────────────────────

const hasClientId = !!import.meta.env.VITE_GOOGLE_CLIENT_ID

function GoogleLoginButton({ onLogin }: { onLogin: (token: string) => void }) {
  const googleLogin = useGoogleLogin({
    scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    onSuccess: res => onLogin(res.access_token),
    onError: err => console.error('Login failed', err),
  })
  return (
    <button
      onClick={() => googleLogin()}
      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 20px', background: navy, color: white, border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}
    >
      <GoogleIcon /> Continue with Google
    </button>
  )
}

function LoginPage({ onLogin, onDemo }: { onLogin: (token: string) => void; onDemo: () => void }) {
  return (
    <div style={{ minHeight: '100vh', background: bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: faint, marginBottom: 16 }}>— Est. 2026</div>
        <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 36, fontWeight: 700, color: ink, lineHeight: 1 }}>Ship<em style={{ color: navy }}>Check</em></div>
        <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: faint, marginTop: 6 }}>by Averis · Shipping Operations</div>
      </div>

      <div style={{ width: '100%', maxWidth: 380, border: `1px solid ${border}`, borderRadius: 4, background: white, overflow: 'hidden' }}>
        <div style={{ padding: '28px 32px 0' }}>
          <SectionLabel>Connect Inbox</SectionLabel>
          <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 22, fontWeight: 700, color: ink, marginBottom: 6 }}>Sign in to continue</div>
          <p style={{ fontSize: 12, color: muted, marginBottom: 24, lineHeight: 1.6 }}>Connect your Gmail account to retrieve and classify your latest 100 shipping emails automatically.</p>
        </div>

        <div style={{ padding: '0 32px 28px' }}>
          {hasClientId ? (
            <GoogleLoginButton onLogin={onLogin} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 11, color: '#92400E', background: amberBg, border: `1px solid ${amberBdr}`, borderRadius: 4, padding: '10px 12px' }}>
                <strong>VITE_GOOGLE_CLIENT_ID not set.</strong> Add it to .env to enable real Gmail login.
              </div>
              <button onClick={onDemo} style={{ width: '100%', padding: '12px', background: navy, color: white, border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer' }}>
                Continue with Demo Data
              </button>
            </div>
          )}

          <div style={{ marginTop: 20, paddingTop: 20, borderTop: `1px solid ${borderLight}` }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: muted, marginBottom: 10 }}>Access Scope</div>
            {['Read-only Gmail access', 'Last 100 inbox emails', 'Automatic email classification'].map(f => (
              <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: muted, marginBottom: 6 }}>
                <span style={{ color: green, fontWeight: 700 }}>✓</span> {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      <p style={{ fontSize: 10, color: faint, marginTop: 20, textAlign: 'center', maxWidth: 340 }}>
        ShipCheck requests read-only access only. It does not send, delete, or modify any messages.
      </p>
    </div>
  )
}

// ─── App Root ─────────────────────────────────────────────────────────────────

const CRUMBS: Record<Page, string> = {
  dashboard: 'ShipCheck Dashboard / Published Continuously',
  inbox: 'Inbox / Averis ShipCheck',
  'email-detail': 'Email Detail / Inbox',
  processing: 'Processing / Document Comparison',
  comparison: 'Shipment Comparison / SI vs BL',
  review: 'Human Review / Queue',
  'review-detail': 'Human Review / Detail',
  reports: 'Processing History / Reports',
  upload: 'Upload & Compare / SI vs BL',
  'upload-comparison': 'Upload Comparison / Result',
}

export default function App() {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<UserInfo | null>(null)
  const [emails, setEmails] = useState<GmailEmail[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  const [selectedEmailId, setSelectedEmailId] = useState('')
  const [selectedReviewId, setSelectedReviewId] = useState('')
  const [uploadResult, setUploadResult] = useState<{ fields: ComparisonField[]; siName: string; blName: string } | null>(null)
  const [classifying, setClassifying] = useState<{ active: boolean; current: number; total: number; error: string | null }>({
    active: false,
    current: 0,
    total: 0,
    error: null,
  })
  const [apiError, setApiError] = useState<string | null>(null)

  const runAiClassification = useCallback(async (targets: GmailEmail[]) => {
    if (!targets.length) return
    setClassifying({ active: true, current: 0, total: targets.length, error: null })
    setApiError(null)

    await classifyEmailsBatch(
      targets,
      (_index, result, item) => {
        setClassifying(prev => ({ ...prev, current: prev.current + 1 }))
        setEmails(prev => prev.map(e => {
          if (e.id === item.id) {
            return {
              ...e,
              type: result.type,
              status: result.type === 'Document Comparison' ? (e.status === 'Processing' ? 'Needs Review' : e.status) : 'Classified',
            }
          }
          return e
        }))
      },
      (_index, error, item) => {
        console.error(`Classification failed for email ${item.id}:`, error)
        const msg = `Failed to classify "${item.subject.slice(0, 32)}…": ${error.message}`
        setClassifying(prev => ({
          ...prev,
          current: prev.current + 1,
          error: msg,
        }))
        setApiError(msg)
      },
      2
    )

    setClassifying(prev => ({ ...prev, active: false }))
  }, [])

  const loadEmails = useCallback(async (t: string) => {
    setLoading(true)
    setApiError(null)
    try {
      const res = await fetchEmailsPage(t, undefined, 25)
      setEmails(res.emails)
      setNextPageToken(res.nextPageToken || null)
      setLoading(false)
      await runAiClassification(res.emails)
    } catch (err: any) {
      setLoading(false)
      setApiError(`Failed to fetch emails: ${err.message || String(err)}`)
    }
  }, [runAiClassification])

  const loadMoreEmails = useCallback(async () => {
    if (!token || !nextPageToken || loadingMore) return
    setLoadingMore(true)
    setApiError(null)
    try {
      const res = await fetchEmailsPage(token, nextPageToken, 25)
      setEmails(prev => [...prev, ...res.emails])
      setNextPageToken(res.nextPageToken || null)
      setLoadingMore(false)
      await runAiClassification(res.emails)
    } catch (err: any) {
      setLoadingMore(false)
      setApiError(`Failed to load more emails: ${err.message || String(err)}`)
    }
  }, [token, nextPageToken, loadingMore, runAiClassification])

  async function handleLogin(t: string) {
    setToken(t)
    try { setUser(await getUserInfo(t)) } catch {}
    await loadEmails(t)
    setPage('dashboard')
  }

  function handleDemo() {
    setUser({ email: 'demo@averis.com', name: 'Demo User' })
    setEmails(MOCK)
    setNextPageToken(null)
    setPage('dashboard')
  }

  function selectEmail(id: string) { setSelectedEmailId(id); setPage('email-detail') }

  if (!token && !emails.length) return <LoginPage onLogin={handleLogin} onDemo={handleDemo} />

  const selectedEmail = emails.find(e => e.id === selectedEmailId)

  return (
    <div className="app-shell" style={{ background: bg }}>
      <Sidebar page={page} onNav={setPage} user={user} emails={emails} />
      <div className="app-main">
        <TopBar
          crumb={CRUMBS[page]}
          onRefresh={page === 'inbox' && token ? () => loadEmails(token) : undefined}
          loading={loading}
          classifying={classifying}
        />
        <main className="app-page-content">
          {page === 'dashboard' && <DashboardPage emails={emails} user={user} onNav={setPage} onSelect={selectEmail} />}
          {page === 'inbox' && (
            <InboxPage
              emails={emails}
              onSelect={selectEmail}
              classifying={classifying}
              onClassify={() => runAiClassification(emails)}
              apiError={apiError}
              onClearError={() => { setApiError(null); setClassifying(prev => ({ ...prev, error: null })) }}
              hasMore={!!nextPageToken}
              onLoadMore={loadMoreEmails}
              loadingMore={loadingMore}
            />
          )}
          {page === 'email-detail' && selectedEmail && <EmailDetailPage email={selectedEmail} onBack={() => setPage('inbox')} onProcess={() => setPage('processing')} />}
          {page === 'processing' && <ProcessingPage onDone={() => setPage('comparison')} />}
          {page === 'comparison' && <ComparisonPage onBack={() => setPage('email-detail')} />}
          {page === 'review' && <ReviewPage onSelect={id => { setSelectedReviewId(id); setPage('review-detail') }} />}
          {page === 'review-detail' && <ReviewDetailPage id={selectedReviewId} onBack={() => setPage('review')} />}
          {page === 'reports' && <ReportsPage />}
          {page === 'upload' && <UploadPage onCompare={(fields, siName, blName) => { setUploadResult({ fields, siName, blName }); setPage('upload-comparison') }} />}
          {page === 'upload-comparison' && uploadResult && <UploadComparisonPage result={uploadResult.fields} siName={uploadResult.siName} blName={uploadResult.blName} onBack={() => setPage('upload')} />}
        </main>
      </div>
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function SettingsIcon() { return <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg> }
function SearchIcon() { return <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4"/><path d="M10 10l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg> }
function GoogleIcon() { return <svg width="15" height="15" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/><path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"/></svg> }
