import type { EmailType, EmailStatus, ComparisonField, ComparisonRecord } from '../services/api'

export type Page =
  | 'dashboard'
  | 'inbox'
  | 'email-detail'
  | 'processing'
  | 'comparison'
  | 'review'
  | 'review-detail'
  | 'reports'
  | 'upload'
  | 'upload-comparison'
  | 'settings'

export interface AttachmentRef {
  filename: string
  attachmentId: string
}

export interface GmailEmail {
  id: string
  threadId: string
  from: string
  fromName: string
  subject: string
  snippet: string
  date: string
  timestamp: number
  type: EmailType
  status: EmailStatus
  hasAttachments: boolean
  body?: string
  attachmentRefs?: AttachmentRef[]
  comparisonId?: number
  fields?: ComparisonField[]
}

export interface UserInfo {
  id?: string
  email: string
  name: string
  picture?: string
  provider?: 'google' | 'supabase' | 'demo'
}

export interface ClassifyingState {
  active: boolean
  current: number
  total: number
  error: string | null
}

export type { EmailType, EmailStatus, ComparisonField, ComparisonRecord }

