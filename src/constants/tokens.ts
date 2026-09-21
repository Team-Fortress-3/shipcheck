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

