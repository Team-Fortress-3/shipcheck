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
} from '../constants/tokens'
import { SectionLabel } from '../components/primitives'
import type { ComparisonField } from '../types'

interface ComparisonPageProps {
  fields?: ComparisonField[]
  siName?: string
  blName?: string
  subject?: string
  onBack: () => void
  onGoToUpload?: () => void
}

export function ComparisonPage({ fields, siName, blName, subject, onBack, onGoToUpload }: ComparisonPageProps) {
  const comparisonRows = fields || []
  const mismatches = comparisonRows.filter(f => !f.match)

  if (comparisonRows.length === 0) {
    return (
      <div style={{ padding: 28 }}>
        <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: navy, border: `1px solid ${border}`, background: white, cursor: 'pointer', padding: '7px 14px', borderRadius: 4, marginBottom: 24 }}>← Back</button>
        <SectionLabel>Shipment Comparison — SI vs Bill of Lading</SectionLabel>

        <div style={{ border: `1px solid ${border}`, borderRadius: 4, background: white, padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>📊</div>
          <h3 style={{ fontFamily: 'Playfair Display, serif', fontSize: 20, fontWeight: 700, color: ink, margin: '0 0 8px' }}>No Comparison Data Found</h3>
          <p style={{ fontSize: 13, color: muted, maxWidth: 460, margin: '0 auto 20px', lineHeight: 1.5 }}>
            No comparison has been executed yet for this record. You can upload and compare custom Shipping Instructions and Bills of Lading in the Upload tool.
          </p>
          {onGoToUpload && (
            <button
              onClick={onGoToUpload}
              style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '11px 24px', background: navy, color: white, border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >
              Go to Upload & Compare →
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 28 }}>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: navy, border: `1px solid ${border}`, background: white, cursor: 'pointer', padding: '7px 14px', borderRadius: 4, marginBottom: 24 }}>← Back</button>
      <SectionLabel>Shipment Comparison — SI vs Bill of Lading</SectionLabel>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: 'Playfair Display, serif', fontSize: 26, fontWeight: 700, color: ink, margin: '0 0 6px' }}>{subject || 'Document Comparison'}</h2>
          <p style={{ fontSize: 12, color: muted, margin: 0 }}>{siName || 'Shipping_Instruction.pdf'} · {blName || 'Draft_Bill_of_Lading.pdf'}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: mismatches.length > 0 ? amberBg : '#DCFCE7', border: `1px solid ${mismatches.length > 0 ? amberBdr : '#86EFAC'}`, borderRadius: 4, fontSize: 12, fontWeight: 700, color: mismatches.length > 0 ? '#92400E' : green }}>
          {mismatches.length > 0 ? `⚠ ${mismatches.length} mismatch${mismatches.length !== 1 ? 'es' : ''} found` : '✓ All fields match'}
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
            {comparisonRows.map((f, i) => (
              <tr key={f.field} style={{ background: f.match ? 'white' : amberBg, borderBottom: i < comparisonRows.length - 1 ? `1px solid ${borderLight}` : 'none' }}>
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
                  <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 32, fontWeight: 700, color: navy }}>{f.si}</div>
                </div>
                <div style={{ padding: '16px 20px', border: `1px solid ${amberBdr}`, borderRadius: 4, background: amberBg }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: amber, marginBottom: 8 }}>Bill of Lading</div>
                  <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 32, fontWeight: 700, color: '#92400E' }}>{f.bl}</div>
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

