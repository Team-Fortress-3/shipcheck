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

export const REVIEW_ITEMS = [
  { id: 'r1', subject: 'RE: Draft BL #48300 – urgent review needed', reason: 'BL attachment could not be read', received: '08:22 AM' },
  { id: 'r2', subject: 'RE: BL #48290 – container count unreadable', reason: 'Container count could not be reliably extracted', received: 'Yesterday' },
]

interface ReviewPageProps {
  onSelect: (id: string) => void
}

export function ReviewPage({ onSelect }: ReviewPageProps) {
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

