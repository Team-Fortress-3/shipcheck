import {
  surface,
  white,
  border,
  borderLight,
  navy,
  ink,
  muted,
  faint,
  amberBg,
  amberBdr,
} from '../constants/tokens'
import { SectionLabel } from '../components/primitives'
import type { GmailEmail } from '../types'

interface ReviewPageProps {
  emails: GmailEmail[]
  onSelect: (id: string) => void
}

export function ReviewPage({ emails, onSelect }: ReviewPageProps) {
  const reviewItems = emails.filter(e => e.status === 'Needs Review')

  return (
    <div style={{ padding: 28 }}>
      <SectionLabel>Human Review Queue</SectionLabel>

      {reviewItems.length > 0 && (
        <div style={{ border: `1px solid ${amberBdr}`, borderRadius: 4, background: amberBg, padding: '10px 16px', marginBottom: 20, fontSize: 12, color: '#92400E' }}>
          ⚠ {reviewItems.length} {reviewItems.length === 1 ? 'case requires' : 'cases require'} manual review and resolution.
        </div>
      )}

      <div style={{ border: `1px solid ${border}`, borderRadius: 4, overflow: 'hidden', background: white }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: surface, borderBottom: `1px solid ${borderLight}` }}>
              {['Email / Document', 'Sender', 'Received', ''].map(h => (
                <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reviewItems.length > 0 ? (
              reviewItems.map((r, i) => (
                <tr key={r.id} style={{ borderBottom: i < reviewItems.length - 1 ? `1px solid ${borderLight}` : 'none' }}>
                  <td style={{ padding: '13px 20px', fontWeight: 600, color: ink, maxWidth: 320 }}>
                    <div>{r.subject}</div>
                    <div style={{ fontSize: 11, color: muted, fontWeight: 400, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.snippet}</div>
                  </td>
                  <td style={{ padding: '13px 20px', color: muted, fontSize: 12 }}>{r.fromName || r.from}</td>
                  <td style={{ padding: '13px 20px', fontSize: 11, color: faint }}>{r.date}</td>
                  <td style={{ padding: '13px 20px', textAlign: 'right' }}>
                    <button onClick={() => onSelect(r.id)} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 14px', border: `1px solid ${border}`, borderRadius: 3, background: 'none', cursor: 'pointer', color: navy }}>
                      Review
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} style={{ padding: '48px 20px', textAlign: 'center', color: muted, fontSize: 13 }}>
                  ✓ All clear. No documents or emails currently require human review.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

