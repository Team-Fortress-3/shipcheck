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
  amberBg,
  amberBdr,
  green,
  COMPARISON_ROWS,
} from '../constants/tokens'
import { SectionLabel } from '../components/primitives'

interface ComparisonPageProps {
  onBack: () => void
}

export function ComparisonPage({ onBack }: ComparisonPageProps) {
  const mismatches = COMPARISON_ROWS.filter(f => !f.match)
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
            {COMPARISON_ROWS.map((f, i) => (
              <tr key={f.field} style={{ background: f.match ? 'white' : amberBg, borderBottom: i < COMPARISON_ROWS.length - 1 ? `1px solid ${borderLight}` : 'none' }}>
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

