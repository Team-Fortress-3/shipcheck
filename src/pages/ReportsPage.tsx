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

export function ReportsPage() {
  const [dbComparisons, setDbComparisons] = useState<ComparisonRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    getComparisonsApi(50)
      .then(data => {
        setDbComparisons(data || [])
      })
      .catch(err => {
        console.error('Failed to load comparison reports:', err)
        setError(err.message || 'Failed to connect to comparison reports service.')
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ padding: 28 }}>
      <SectionLabel>Processing History & Reports</SectionLabel>

      {error && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4, padding: '12px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#991B1B', fontWeight: 500 }}>
          <span style={{ fontSize: 16 }}>⚠</span>
          <span><strong>Failed to load reports:</strong> {error}</span>
        </div>
      )}

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
            {loading ? (
              <tr>
                <td colSpan={4} style={{ padding: '36px 20px', textAlign: 'center', color: muted, fontSize: 13 }}>
                  Loading comparison reports…
                </td>
              </tr>
            ) : dbComparisons.length > 0 ? (
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
              <tr>
                <td colSpan={4} style={{ padding: '48px 20px', textAlign: 'center', color: muted, fontSize: 13 }}>
                  No comparison reports found. Use <strong>Upload & Compare</strong> to process documents and generate reports.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

