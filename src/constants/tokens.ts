import type { GmailEmail, ComparisonField, Page } from '../types'

// ─── Design Tokens ────────────────────────────────────────────────────────────

export const bg = '#EDEAE2'        // warm beige main bg
export const surface = '#F7F5EF'   // slightly warmer surface
export const white = '#FFFFFF'
export const navy = '#1B3652'
export const navyMid = '#264D76'
export const border = '#D8D3C8'
export const borderLight = '#E5E1D8'
export const ink = '#1A1612'
export const muted = '#6B6560'
export const faint = '#A8A298'
export const amber = '#B45309'
export const amberBg = '#FEF3C7'
export const amberBdr = '#F6D860'
export const green = '#166534'
export const greenBg = '#DCFCE7'

// ─── Mock Data ────────────────────────────────────────────────────────────────

export const MOCK_EMAILS: GmailEmail[] = [
  { id: 'e1', threadId: 't1', fromName: 'Operations Dept', from: 'operations@shipping.com', subject: 'RE: Draft BL for Shipment #48291', snippet: 'Please review the attached draft Bill of Lading against our SI...', date: '10:42 AM', timestamp: Date.now() - 3600000, type: 'Document Comparison', status: 'Mismatch', hasAttachments: true },
  { id: 'e2', threadId: 't2', fromName: 'Klang Freight', from: 'freight@klangport.my', subject: 'RE: BL Confirmation #48288 – Port Klang', snippet: 'Attaching revised BL draft. Please confirm container count matches SI...', date: '10:18 AM', timestamp: Date.now() - 5400000, type: 'Document Comparison', status: 'Match', hasAttachments: true },
  { id: 'e3', threadId: 't3', fromName: 'XYZ Trading', from: 'accounts@xyztrading.com', subject: 'Invoice #39281 – Query on freight charges', snippet: 'Please clarify the additional freight surcharge added to invoice #39281...', date: '09:54 AM', timestamp: Date.now() - 7200000, type: 'Invoice Query', status: 'Classified', hasAttachments: false },
  { id: 'e4', threadId: 't4', fromName: 'Global Freight', from: 'ops@globalfreight.com', subject: 'New Shipping Instruction – Order #2026-09-047', snippet: 'Please find enclosed the new Shipping Instruction for Order #2026-09-047...', date: '09:31 AM', timestamp: Date.now() - 9000000, type: 'New SI Request', status: 'Classified', hasAttachments: true },
  { id: 'e5', threadId: 't5', fromName: 'Promotions', from: 'no-reply@promotions.biz', subject: 'Special Offer: Freight rates reduced 30%!', snippet: 'Limited time offer on freight forwarding services. Click here...', date: '08:47 AM', timestamp: Date.now() - 11000000, type: 'Spam', status: 'Classified', hasAttachments: false },
  { id: 'e6', threadId: 't6', fromName: 'ABC Logistics', from: 'logistics@abcltd.com', subject: 'RE: Draft BL #48300 – urgent review needed', snippet: 'BL attachment could not be read by our system. Human review required...', date: '08:22 AM', timestamp: Date.now() - 13000000, type: 'Document Comparison', status: 'Needs Review', hasAttachments: true },
  { id: 'e7', threadId: 't7', fromName: 'Port Ops', from: 'ops@shipping.com', subject: 'Operational update – route change advisory', snippet: 'Tanjung Pelepas terminal operates reduced capacity 22–25 Sep 2026...', date: 'Yesterday', timestamp: Date.now() - 86400000, type: 'General', status: 'Classified', hasAttachments: false },
]

export const COMPARISON_ROWS: ComparisonField[] = [
  { field: 'Shipper', si: 'ABC Logistics Ltd.', bl: 'ABC Logistics Ltd.', match: true },
  { field: 'Consignee', si: 'XYZ Trading Pte Ltd.', bl: 'XYZ Trading Pte Ltd.', match: true },
  { field: 'Notify Party', si: 'XYZ Trading Pte Ltd.', bl: 'XYZ Trading Pte Ltd.', match: true },
  { field: 'Port of Loading', si: 'Port Klang', bl: 'Port Klang', match: true },
  { field: 'Port of Discharge', si: 'Singapore', bl: 'Singapore', match: true },
  { field: 'Container Count', si: '3', bl: '4', match: false },
  { field: 'Gross Weight (kg)', si: '22,000', bl: '22,000', match: true },
]

// ─── Breadcrumbs ──────────────────────────────────────────────────────────────

export const CRUMBS: Record<Page, string> = {
  dashboard: 'ShipCheck Dashboard / Published Continuously',
  inbox: 'Inbox / Averis ShipCheck',
  'email-detail': 'Email Detail / Inbox',
  processing: 'Processing / Document Comparison',
  comparison: 'Shipment Comparison / SI vs BL',
  review: 'Human Review / Queue',
  'review-detail': 'Human Review / Detail',
  reports: 'Processing History / Reports',
  upload: 'Upload & Compare / SI vs BL',
  'upload-comparison': 'Upload Comparison / Result',
  settings: 'Account & Settings / ShipCheck',
}

