import { useState } from 'react'
import {
  surface,
  white,
  border,
  borderLight,
  navy,
  muted,
  faint,
  amber,
  amberBg,
  amberBdr,
  green,
  greenBg,
} from '../constants/tokens'
import { SectionLabel } from '../components/primitives'
import { REVIEW_ITEMS } from './ReviewPage'

interface ReviewDetailPageProps {
  id: string
  onBack: () => void
}

export function ReviewDetailPage({ id, onBack }: ReviewDetailPageProps) {
  const item = REVIEW_ITEMS.find(r => r.id === id) || REVIEW_ITEMS[0]
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

