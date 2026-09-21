import { useState } from 'react'
import type { GmailEmail, ClassifyingState } from '../types'
import {
  surface,
  white,
  border,
  borderLight,
  navy,
  ink,
  muted,
  faint,
  amber,
} from '../constants/tokens'
import { SectionLabel, Badge, Spinner, SearchIcon } from '../components/primitives'

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
      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
        <Badge label={e.status === 'Processing' && e.type === 'General' ? 'Processing' : e.type} />
      </td>
      <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
        {e.status === 'Processing' ? (
          <Badge label="Processing" />
        ) : e.type === 'Document Comparison' ? (
          <Badge label={e.status} />
        ) : (
          <span style={{ color: faint, fontSize: 13 }}>—</span>
        )}
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

interface InboxPageProps {
  emails: GmailEmail[]
  onSelect: (id: string) => void
  classifying?: ClassifyingState
  onClassify?: () => void
  apiError?: string | null
  onClearError?: () => void
  hasMore?: boolean
  onLoadMore?: () => void
  loadingMore?: boolean
}

export function InboxPage({
  emails,
  onSelect,
  classifying,
  onClassify,
  apiError,
  onClearError,
  hasMore,
  onLoadMore,
  loadingMore,
}: InboxPageProps) {
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
              <Spinner size={14} color="#2563EB" />
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

      {/* Explicit Backend Error Banner */}
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
            {loadingMore && <Spinner size={12} color={navy} />}
            {loadingMore ? 'Loading more emails…' : 'Load More Emails (25)'}
          </button>
        </div>
      )}
    </div>
  )
}

