import { useState, useEffect, useCallback, useRef } from 'react'
import type { Page, GmailEmail, UserInfo, ComparisonField, ClassifyingState } from '../types'
import { bg, CRUMBS } from '../constants/tokens'
import { Sidebar } from '../components/layout/Sidebar'
import { TopBar } from '../components/layout/TopBar'
import {
  supabase,
  signOutSupabase,
  setSupabaseCustomToken,
  getSupabaseCustomToken,
  clearSupabaseCustomToken,
} from '../services/supabase'
import {
  getCachedEmailsApi,
  syncEmailBatchProgressive,
  classifyEmailsBatch,
  syncUserWithBackendApi,
  compareEmailAttachmentsApi,
  uploadEmlApi,
  getComparisonsApi,
  mapEmailRecordToGmailEmail,
} from '../services/api'
import { fetchEmailsPage, fetchMessageAttachments, fetchMessageAttachmentRefs, fetchInBatches, getUserInfo } from '../services/gmail'

// Pages
import { LoginPage } from '../pages/LoginPage'
import { DashboardPage } from '../pages/DashboardPage'
import { InboxPage } from '../pages/InboxPage'
import { EmailDetailPage } from '../pages/EmailDetailPage'
import { ProcessingPage } from '../pages/ProcessingPage'
import { ComparisonPage } from '../pages/ComparisonPage'
import { ReviewPage } from '../pages/ReviewPage'
import { ReviewDetailPage } from '../pages/ReviewDetailPage'
import { ReportsPage } from '../pages/ReportsPage'
import { UploadPage } from '../pages/UploadPage'
import { UploadComparisonPage } from '../pages/UploadComparisonPage'
import { SettingsPage } from '../pages/SettingsPage'

const GMAIL_TOKEN_STORAGE_KEY = 'shipcheck_gmail_token'

function readStoredGmailToken(): string | null {
  try {
    return sessionStorage.getItem(GMAIL_TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

export default function App() {
  // The Google OAuth access token only lives ~1hr and has no refresh token
  // (implicit flow, no backend token exchange) - but persisting it to
  // sessionStorage at least survives a page reload within the same tab,
  // instead of silently losing Gmail connectivity on every refresh.
  const [gmailToken, setGmailTokenState] = useState<string | null>(readStoredGmailToken)
  const setGmailToken = useCallback((token: string | null) => {
    setGmailTokenState(token)
    try {
      if (token) sessionStorage.setItem(GMAIL_TOKEN_STORAGE_KEY, token)
      else sessionStorage.removeItem(GMAIL_TOKEN_STORAGE_KEY)
    } catch {
      // sessionStorage unavailable (private mode, etc.) - token just won't survive reloads
    }
  }, [])
  const [user, setUser] = useState<UserInfo | null>(null)
  const [emails, setEmails] = useState<GmailEmail[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextPageToken, setNextPageToken] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  const [selectedEmailId, setSelectedEmailId] = useState('')
  const [selectedReviewId, setSelectedReviewId] = useState('')
  const [uploadResult, setUploadResult] = useState<{ fields: ComparisonField[]; siName: string; blName: string } | null>(null)
  const [classifying, setClassifying] = useState<ClassifyingState>({
    active: false,
    current: 0,
    total: 0,
    error: null,
  })
  const [apiError, setApiError] = useState<string | null>(null)
  const [authChecking, setAuthChecking] = useState(true)

  // 1. Check for active Supabase cookie session on initial mount
  useEffect(() => {
    async function checkSession() {
      try {
        let activeUser: UserInfo | null = null
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          const u = session.user
          activeUser = {
            id: u.id,
            email: u.email || '',
            name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'User',
            provider: 'supabase',
          }
          setUser(activeUser)
        } else {
          // Check if custom Supabase JWT is in cookie
          const customToken = getSupabaseCustomToken()
          if (customToken) {
            try {
              const base64Url = customToken.split('.')[1]
              const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
              const payload = JSON.parse(decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')))
              if (payload.exp * 1000 > Date.now()) {
                activeUser = {
                  id: payload.sub,
                  email: payload.email,
                  name: payload.user_metadata?.full_name || payload.email.split('@')[0],
                  picture: payload.user_metadata?.avatar_url,
                  provider: 'google',
                }
                setUser(activeUser)
              } else {
                clearSupabaseCustomToken()
              }
            } catch {
              clearSupabaseCustomToken()
            }
          }
        }

        // Unblock auth checking immediately if a user is found so the skeleton layout renders
        if (activeUser) {
          setAuthChecking(false)
          setLoading(true)
          try {
            const cached = await getCachedEmailsApi(100)
            if (cached && cached.length > 0) {
              setEmails(cached)
            }
          } catch {
            // Backend offline or no cached records yet
          } finally {
            setLoading(false)
          }
        } else {
          setAuthChecking(false)
        }
      } catch (err) {
        console.error('Session check failed:', err)
        setAuthChecking(false)
      }
    }
    checkSession()
  }, [])

  // Tracks emails currently mid-comparison so the UI can show a spinner only
  // while a request is genuinely in flight - never inferred from status
  // alone, otherwise an email that never got auto-compared (e.g. classified
  // in an earlier session, before auto-compare existed, or whose Gmail
  // attachment fetch silently failed) would show "Comparing…" forever with
  // nothing actually running and no way to retry.
  const [comparingIds, setComparingIds] = useState<Set<string>>(new Set())

  // Per-email compare failure reasons, so EmailDetailPage (which doesn't
  // render the global apiError banner) can show exactly why a specific
  // email's comparison didn't run, instead of a click that looks like a
  // no-op.
  const [compareErrors, setCompareErrors] = useState<Record<string, string>>({})

  // Fetches an email's Gmail attachments (looking them up fresh if this
  // GmailEmail object doesn't already carry them, e.g. it came from the
  // backend cache rather than a live Gmail page fetch) and runs the compare
  // pipeline against them. Used both as the automatic post-classify trigger
  // and as the manual "Compare Now" retry button.
  const compareEmailNow = useCallback(async (email: GmailEmail) => {
    setCompareErrors(prev => {
      if (!(email.id in prev)) return prev
      const { [email.id]: _drop, ...rest } = prev
      return rest
    })
    if (!gmailToken) {
      const msg = 'Gmail is not connected in this session. Reconnect it in Settings to fetch this email\'s attachments.'
      setApiError(msg)
      setCompareErrors(prev => ({ ...prev, [email.id]: msg }))
      return null
    }
    setComparingIds(prev => new Set(prev).add(email.id))
    try {
      let refs = email.attachmentRefs
      if (!refs || !refs.length) {
        refs = await fetchMessageAttachmentRefs(gmailToken, email.id)
      }
      const files = refs.length ? await fetchMessageAttachments(gmailToken, email.id, refs) : []
      const result = await compareEmailAttachmentsApi(email.id, files)
      setEmails(prev => prev.map(e => (
        e.id === email.id ? { ...e, status: result.status, fields: result.fields, comparisonId: result.comparison_id, attachmentRefs: refs } : e
      )))
      return result
    } catch (err: any) {
      console.warn(`Compare failed for email ${email.id}:`, err)
      const msg = err.message || String(err)
      setApiError(`Comparison failed for "${email.subject.slice(0, 40)}": ${msg}`)
      setCompareErrors(prev => ({ ...prev, [email.id]: msg }))
      return null
    } finally {
      setComparingIds(prev => {
        const next = new Set(prev)
        next.delete(email.id)
        return next
      })
    }
  }, [gmailToken])

  // Progressive synchronization with backend Postgres
  const syncEmailsWithBackend = useCallback(async (targets: GmailEmail[]) => {
    if (!targets.length) return
    setClassifying({ active: true, current: 0, total: targets.length, error: null })
    setApiError(null)

    // Mark targets in state with status 'Processing' so user sees real-time indicators
    setEmails(prev => {
      const targetIds = new Set(targets.map(t => t.id))
      return prev.map(e => (targetIds.has(e.id) ? { ...e, status: 'Processing' } : e))
    })

    try {
      await syncEmailBatchProgressive(
        targets,
        (syncedItem, originalItem) => {
          setClassifying(prev => ({ ...prev, current: prev.current + 1 }))
          // Keep the attachmentRefs captured during the Gmail page fetch -
          // the backend's EmailRecord doesn't store them, so syncedItem alone
          // would lose them. The auto-compare backlog sweeper (below) picks
          // this email up and runs the comparison once it lands in state.
          const merged = { ...syncedItem, attachmentRefs: originalItem.attachmentRefs }
          setEmails(prev => {
            const exists = prev.some(e => e.id === merged.id)
            if (exists) {
              return prev.map(e => (e.id === merged.id ? merged : e))
            } else {
              return [...prev, merged]
            }
          })
        },
        (error, originalItem) => {
          console.error(`Sync failed for email ${originalItem.id}:`, error)
          const msg = `Backend error on "${originalItem.subject.slice(0, 32)}…": ${error.message}`
          setClassifying(prev => ({
            ...prev,
            current: prev.current + 1,
            error: msg,
          }))
          setApiError(msg)
          // Revert status so item isn't stuck in 'Processing'
          setEmails(prev => prev.map(e => e.id === originalItem.id ? { ...e, status: e.status === 'Processing' ? 'New' : e.status } : e))
        },
        4,
        5
      )
      setClassifying(prev => ({ ...prev, active: false }))
    } catch (err: any) {
      console.error('Batch sync failed:', err)
      const msg = `Backend Sync Failed: ${err.message || String(err)}`
      setClassifying(prev => ({ ...prev, active: false, error: msg }))
      setApiError(msg)
    }
  }, [])

  // Sweeps the full email list for any Document Comparison email still
  // sitting at "New" - whether it just got classified, came back from the
  // cache on initial load, or was uploaded as .eml - and auto-compares it.
  // Runs once per email id (tracked in a ref, not state, so it doesn't
  // itself retrigger this effect) so a failed attempt doesn't loop forever;
  // the "Compare Now" button on EmailDetailPage covers manual retry.
  const autoCompareAttempted = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!gmailToken) return
    const candidates = emails.filter(e =>
      e.type === 'Document Comparison' &&
      e.status === 'New' &&
      e.hasAttachments &&
      !e.id.startsWith('eml_') &&
      !autoCompareAttempted.current.has(e.id)
    )
    if (!candidates.length) return
    candidates.forEach(e => autoCompareAttempted.current.add(e.id))
    fetchInBatches(candidates, compareEmailNow, 8)
  }, [emails, gmailToken, compareEmailNow])

  // Load Gmail messages (called when Gmail is connected)
  const loadGmailEmails = useCallback(async (token: string) => {
    setLoading(true)
    setApiError(null)
    try {
      // 1. Instant cache retrieval from Supabase Postgres (<100ms)
      let cached: GmailEmail[] = []
      try {
        cached = await getCachedEmailsApi(100)
        if (cached && cached.length > 0) {
          setEmails(cached)
          // Unblock UI immediately so the user can interact with their inbox with 0 load time
          setLoading(false)
        }
      } catch (err) {
        console.warn('Cache retrieval note:', err)
      }

      // 2. Fetch latest 25 messages from Gmail in the background
      const res = await fetchEmailsPage(token, undefined, 25)
      setNextPageToken(res.nextPageToken || null)

      // Identify emails that are NOT yet in the cache/database
      const knownIds = new Set(cached.map(e => e.id))
      const trulyNew = res.emails.filter(item => !knownIds.has(item.id))

      if (trulyNew.length > 0) {
        setEmails(prev => {
          const currentIds = new Set(prev.map(e => e.id))
          const fresh = trulyNew.filter(item => !currentIds.has(item.id))
          return [...fresh, ...prev]
        })
        syncEmailsWithBackend(trulyNew)
      }
    } catch (err: any) {
      setApiError(`Failed to fetch emails: ${err.message || String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [syncEmailsWithBackend])

  // Pagination for Gmail emails
  const loadMoreEmails = useCallback(async () => {
    if (!gmailToken || !nextPageToken || loadingMore) return
    setLoadingMore(true)
    setApiError(null)
    try {
      const res = await fetchEmailsPage(gmailToken, nextPageToken, 25)
      setNextPageToken(res.nextPageToken || null)

      let trulyNew: GmailEmail[] = []
      setEmails(prev => {
        const existingMap = new Map(prev.map(e => [e.id, e]))
        const fresh: GmailEmail[] = []
        for (const item of res.emails) {
          if (!existingMap.has(item.id)) {
            fresh.push(item)
          }
        }
        trulyNew = fresh
        return [...fresh, ...prev]
      })

      if (trulyNew.length > 0) {
        syncEmailsWithBackend(trulyNew)
      }
    } catch (err: any) {
      setApiError(`Failed to load more emails: ${err.message || String(err)}`)
    } finally {
      setLoadingMore(false)
    }
  }, [gmailToken, nextPageToken, loadingMore, syncEmailsWithBackend])

  // Handlers
  async function handleGoogleLogin(t: string) {
    setGmailToken(t)
    setPage('dashboard')
    setLoading(true)
    let u: UserInfo = { email: 'user@gmail.com', name: 'Google User', provider: 'google' }
    try {
      u = await getUserInfo(t)
      setUser(u)
    } catch {
      setUser(u)
    }

    // Automatically sync Google user into Supabase auth.users & store cookie session
    try {
      const syncRes = await syncUserWithBackendApi({
        email: u.email,
        name: u.name,
        picture: u.picture,
        provider: 'google',
      })
      setSupabaseCustomToken(syncRes.token)
      setUser({
        id: syncRes.user_id,
        email: syncRes.email,
        name: syncRes.name || u.name,
        picture: u.picture,
        provider: 'google',
      })
    } catch (err) {
      console.warn('Backend user sync notice:', err)
    }

    loadGmailEmails(t)
  }

  function handleSupabaseLogin(userInfo: UserInfo) {
    setUser(userInfo)
    setPage('dashboard')
    setLoading(true)
    // Fetch cached emails for this user from Postgres
    getCachedEmailsApi(50)
      .then(cached => {
        if (cached && cached.length > 0) {
          setEmails(cached)
        }
      })
      .catch(err => {
        console.error('Failed to load cached emails:', err)
        setApiError(err.message || 'Failed to load cached emails from backend.')
      })
      .finally(() => {
        setLoading(false)
      })
  }

  async function handleLogout() {
    try {
      await signOutSupabase()
    } catch (err) {
      console.error('Logout error:', err)
    }
    clearSupabaseCustomToken()
    setUser(null)
    setGmailToken(null)
    setEmails([])
    setNextPageToken(null)
    setPage('dashboard')
    setSelectedEmailId('')
    setSelectedReviewId('')
  }

  function selectEmail(id: string) {
    setSelectedEmailId(id)
    setPage('email-detail')
  }

  // Uploads a raw .eml file: backend parses/classifies/auto-compares it,
  // then it's added straight into the inbox list like a synced Gmail message.
  async function handleUploadEml(file: File) {
    try {
      const created = await uploadEmlApi(file)
      const mapped = mapEmailRecordToGmailEmail(created)
      setEmails(prev => {
        const exists = prev.some(e => e.id === mapped.id)
        return exists ? prev.map(e => (e.id === mapped.id ? mapped : e)) : [mapped, ...prev]
      })
    } catch (err: any) {
      setApiError(`EML upload failed: ${err.message || String(err)}`)
    }
  }

  // Opens the comparison report for an email whose auto-compare already ran.
  // If the fields aren't in local state yet (e.g. after a page reload),
  // fetches the saved ComparisonRecord for this email first.
  async function openComparison(id: string) {
    const email = emails.find(e => e.id === id)
    if (email && !email.fields) {
      try {
        const records = await getComparisonsApi(1, 0, id)
        if (records[0]) {
          setEmails(prev => prev.map(e => (
            e.id === id ? { ...e, fields: records[0].fields, comparisonId: records[0].id } : e
          )))
        }
      } catch (err) {
        console.warn(`Failed to fetch comparison for email ${id}:`, err)
      }
    }
    setPage('comparison')
  }

  // Show nothing or blank beige during initial session restore
  if (authChecking) {
    return <div style={{ minHeight: '100vh', background: bg }} />
  }

  // If not logged in, always show LoginPage
  if (!user) {
    return (
      <LoginPage
        onGoogleLogin={handleGoogleLogin}
        onSupabaseLogin={handleSupabaseLogin}
      />
    )
  }

  const selectedEmail = emails.find(e => e.id === selectedEmailId)

  return (
    <div className="app-shell" style={{ background: bg }}>
      <Sidebar
        page={page}
        onNav={setPage}
        user={user}
        emails={emails}
        onLogout={handleLogout}
      />
      <div className="app-main">
        <TopBar
          crumb={CRUMBS[page] || 'ShipCheck Operations'}
          onRefresh={page === 'inbox' && gmailToken ? () => loadGmailEmails(gmailToken) : undefined}
          loading={loading}
          classifying={classifying}
        />
        <main className="app-page-content">
          {page === 'dashboard' && (
            <DashboardPage
              emails={emails}
              user={user}
              onNav={setPage}
              onSelect={selectEmail}
              loading={loading}
              classifying={classifying}
              apiError={apiError}
            />
          )}
          {page === 'inbox' && (
            <InboxPage
              emails={emails}
              onSelect={selectEmail}
              loading={loading}
              classifying={classifying}
              onClassify={() => syncEmailsWithBackend(emails)}
              apiError={apiError}
              onClearError={() => { setApiError(null); setClassifying(prev => ({ ...prev, error: null })) }}
              hasMore={!!nextPageToken}
              onLoadMore={loadMoreEmails}
              loadingMore={loadingMore}
              onUploadEml={handleUploadEml}
            />
          )}
          {page === 'email-detail' && selectedEmail && (
            <EmailDetailPage
              email={selectedEmail}
              onBack={() => setPage('inbox')}
              isComparing={comparingIds.has(selectedEmail.id)}
              gmailConnected={!!gmailToken}
              onGoToSettings={() => setPage('settings')}
              compareError={compareErrors[selectedEmail.id] || null}
              onProcess={async () => {
                if (selectedEmail.status === 'New' || selectedEmail.status === 'Processing') {
                  const result = await compareEmailNow(selectedEmail)
                  if (!result) return
                  setPage('comparison')
                } else {
                  openComparison(selectedEmail.id)
                }
              }}
            />
          )}
          {page === 'processing' && (
            <ProcessingPage onDone={() => setPage('comparison')} />
          )}
          {page === 'comparison' && (
            <ComparisonPage
              onBack={() => setPage('email-detail')}
              onGoToUpload={() => setPage('upload')}
              subject={selectedEmail?.subject}
              fields={selectedEmail?.fields}
            />
          )}
          {page === 'review' && (
            <ReviewPage
              emails={emails}
              onSelect={id => { setSelectedReviewId(id); setPage('review-detail') }}
              loading={loading}
            />
          )}
          {page === 'review-detail' && (
            <ReviewDetailPage
              id={selectedReviewId}
              emails={emails}
              user={user}
              onBack={() => setPage('review')}
              onResolve={(id, status) => {
                setEmails(prev => prev.map(e => e.id === id ? { ...e, status } : e))
                setPage('review')
              }}
            />
          )}
          {page === 'reports' && (
            <ReportsPage />
          )}
          {page === 'upload' && (
            <UploadPage
              onCompare={(fields, siName, blName) => {
                setUploadResult({ fields, siName, blName })
                setPage('upload-comparison')
              }}
            />
          )}
          {page === 'upload-comparison' && uploadResult && (
            <UploadComparisonPage
              result={uploadResult.fields}
              siName={uploadResult.siName}
              blName={uploadResult.blName}
              onBack={() => setPage('upload')}
            />
          )}
          {page === 'settings' && (
            <SettingsPage
              user={user}
              gmailToken={gmailToken}
              onConnectGmail={t => {
                setGmailToken(t)
                loadGmailEmails(t)
              }}
              onDisconnectGmail={() => {
                setGmailToken(null)
              }}
              onLogout={handleLogout}
            />
          )}
        </main>
      </div>
    </div>
  )
}
