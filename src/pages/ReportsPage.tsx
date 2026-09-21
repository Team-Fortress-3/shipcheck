import { useState, useEffect } from 'react'
import {
  surface,
  white,
  border,
  borderLight,
  ink,
  muted,
  faint,
} from '../constants/tokens'
import { SectionLabel, Badge } from '../components/primitives'
import { getComparisonsApi, type ComparisonRecord } from '../services/api'

const DEFAULT_REPORTS = [
  { id: 'h1', subject: 'RE: Draft BL for Shipment #48291', type: 'Document Comparison', result: 'Mismatch', date: '20 Sep 2026' },
  { id: 'h2', subject: 'RE: BL Confirmation #48288', type: 'Document Comparison', result: 'Match', date: '20 Sep 2026' },
  { id: 'h3', subject: 'Invoice #39281', type: 'Invoice Query', result: 'Classified', date: '20 Sep 2026' },
  { id: 'h4', subject: 'New SI – Order #047', type: 'New SI Request', result: 'Classified', date: '19 Sep 2026' },
  { id: 'h5', subject: 'Draft BL #48285', type: 'Document Comparison', result: 'Match', date: '19 Sep 2026' },
]

export function ReportsPage() {
  const [dbComparisons, setDbComparisons] = useState<ComparisonRecord[]>([])

  useEffect(() => {
    getComparisonsApi(50)
      .then(data => {
        if (data && data.length > 0) {
          setDbComparisons(data)
        }
      })
      .catch(() => {})
  }, [])

  return (
    <div style={{ padding: 28 }}>
      <SectionLabel>Processing History & Reports</SectionLabel>
      <div style={{ border: `1px solid ${border}`, borderRadius: 4, overflow: 'hidden', background: white }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: surface, borderBottom: `1px solid ${borderLight}` }}>
              {['Document / Subject', 'Type', 'Result', 'Date'].map(h => (
                <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dbComparisons.length > 0 ? (
              dbComparisons.map((c, i) => (
                <tr key={c.id} style={{ borderBottom: i < dbComparisons.length - 1 ? `1px solid ${borderLight}` : 'none' }}>
                  <td style={{ padding: '13px 20px', fontWeight: 500, color: ink }}>
                    {c.si_name || 'Shipping Instruction'} vs {c.bl_name || 'Bill of Lading'}
                  </td>
                  <td style={{ padding: '13px 20px' }}><Badge label="Document Comparison" /></td>
                  <td style={{ padding: '13px 20px' }}><Badge label={c.status} /></td>
                  <td style={{ padding: '13px 20px', fontSize: 11, color: faint }}>
                    {c.created_at ? new Date(c.created_at).toLocaleDateString() : 'Recent'}
                  </td>
                </tr>
              ))
            ) : (
              DEFAULT_REPORTS.map((r, i) => (
                <tr key={r.id} style={{ borderBottom: i < DEFAULT_REPORTS.length - 1 ? `1px solid ${borderLight}` : 'none' }}>
                  <td style={{ padding: '13px 20px', fontWeight: 500, color: ink }}>{r.subject}</td>
                  <td style={{ padding: '13px 20px' }}><Badge label={r.type} /></td>
                  <td style={{ padding: '13px 20px' }}><Badge label={r.result} /></td>
                  <td style={{ padding: '13px 20px', fontSize: 11, color: faint }}>{r.date}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

