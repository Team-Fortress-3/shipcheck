import { useState } from 'react'
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
  greenBg,
} from '../constants/tokens'
import { SectionLabel } from '../components/primitives'
import type { GmailEmail } from '../types'

interface ReviewDetailPageProps {
  id: string
  emails: GmailEmail[]
  onBack: () => void
  onResolve?: (id: string, newStatus: 'Match' | 'Mismatch') => void
}

export function ReviewDetailPage({ id, emails, onBack, onResolve }: ReviewDetailPageProps) {
  const item = emails.find(e => e.id === id)
  const [resolvedStatus, setResolvedStatus] = useState<'Match' | 'Mismatch' | null>(null)

  if (!item) {
    return (
      <div style={{ padding: 28 }}>
        <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: navy, border: `1px solid ${border}`, background: white, cursor: 'pointer', padding: '7px 14px', borderRadius: 4, marginBottom: 24 }}>← Back to Review</button>
        <div style={{ border: '1px solid #FECACA', borderRadius: 4, background: '#FEF2F2', padding: '16px 20px', color: '#991B1B', fontSize: 13 }}>
          ⚠ Review item with ID <code>{id}</code> was not found. It may have already been resolved.
        </div>
      </div>
    )
  }

  function handleAction(status: 'Match' | 'Mismatch') {
    setResolvedStatus(status)
    if (onResolve) {
      onResolve(item!.id, status)
    }
  }

  return (
    <div style={{ padding: 28 }}>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: navy, border: `1px solid ${border}`, background: white, cursor: 'pointer', padding: '7px 14px', borderRadius: 4, marginBottom: 24 }}>← Back to Review</button>

      <div style={{ border: `1px solid ${amberBdr}`, borderRadius: 4, background: amberBg, padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 18, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>⚠ Review Required</div>
        <p style={{ fontSize: 13, color: '#92400E', margin: 0 }}>This email document requires manual operator verification and resolution.</p>
      </div>

      <div style={{ border: `1px solid ${border}`, borderRadius: 4, background: white, padding: '20px 24px', marginBottom: 20 }}>
        <SectionLabel>Email Details</SectionLabel>
        <h3 style={{ fontFamily: 'Playfair Display, serif', fontSize: 20, fontWeight: 700, color: navy, margin: '0 0 10px' }}>{item.subject}</h3>
        <div style={{ fontSize: 12, color: muted, marginBottom: 12 }}>
          From: <strong style={{ color: ink }}>{item.fromName}</strong> ({item.from}) · Date: {item.date}
        </div>
        <div style={{ padding: '12px 16px', background: surface, borderRadius: 4, fontSize: 13, color: ink, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {item.body || item.snippet || 'No message content available.'}
        </div>
      </div>

      {resolvedStatus ? (
        <div style={{ border: `1px solid #86EFAC`, borderRadius: 4, background: greenBg, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: green, fontWeight: 700 }}>✓</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: green }}>Case marked as {resolvedStatus} and resolved successfully.</span>
        </div>
      ) : (
        <div style={{ border: `1px solid ${border}`, borderRadius: 4, background: white, padding: '20px 24px' }}>
          <SectionLabel>Resolution Action</SectionLabel>
          <p style={{ fontSize: 12, color: muted, marginBottom: 16 }}>Select an outcome to update the shipment status:</p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => handleAction('Match')} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '10px 20px', background: '#166534', color: white, border: 'none', borderRadius: 4, cursor: 'pointer' }}>✓ Confirm Match</button>
            <button onClick={() => handleAction('Mismatch')} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '10px 20px', background: amberBg, color: amber, border: `1px solid ${amberBdr}`, borderRadius: 4, cursor: 'pointer' }}>⚠ Mark Mismatch</button>
          </div>
        </div>
      )}
    </div>
  )
}

