import type { GmailEmail } from '../types'
import {
  surface,
  white,
  border,
  borderLight,
  navy,
  ink,
  muted,
  amber,
  amberBg,
  amberBdr,
} from '../constants/tokens'
import { SectionLabel, Badge } from '../components/primitives'

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

interface EmailDetailPageProps {
  email: GmailEmail
  onBack: () => void
  onProcess: () => void
}

export function EmailDetailPage({ email, onBack, onProcess }: EmailDetailPageProps) {
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

