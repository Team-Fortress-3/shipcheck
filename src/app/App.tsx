import { useState, useEffect, useCallback } from 'react'
import type { Page, GmailEmail, UserInfo, ComparisonField, ClassifyingState } from '../types'
import { bg, CRUMBS, MOCK_EMAILS } from '../constants/tokens'
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
} from '../services/api'
import { fetchEmailsPage, getUserInfo } from '../services/gmail'

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

export default function App() {
  const [gmailToken, setGmailToken] = useState<string | null>(null)
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
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          const u = session.user
          setUser({
            id: u.id,
            email: u.email || '',
            name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'User',
            provider: 'supabase',
          })
        } else {
          // Check if custom Supabase JWT is in cookie
          const customToken = getSupabaseCustomToken()
          if (customToken) {
            try {
              const base64Url = customToken.split('.')[1]
              const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
              const payload = JSON.parse(decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')))
              if (payload.exp * 1000 > Date.now()) {
                setUser({
                  id: payload.sub,
                  email: payload.email,
                  name: payload.user_metadata?.full_name || payload.email.split('@')[0],
                  picture: payload.user_metadata?.avatar_url,
                  provider: 'google',
                })
              } else {
                clearSupabaseCustomToken()
              }
            } catch {
              clearSupabaseCustomToken()
            }
          }
        }

        // Load user's cached emails from Supabase Postgres
        try {
          const cached = await getCachedEmailsApi(50)
          if (cached && cached.length > 0) {
            setEmails(cached)
          }
        } catch {
          // Backend offline or no cached records yet
        }
      } catch (err) {
        console.error('Session check failed:', err)
      } finally {
        setAuthChecking(false)
      }
    }
    checkSession()
  }, [])

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
          setEmails(prev => {
            const exists = prev.some(e => e.id === syncedItem.id)
            if (exists) {
              return prev.map(e => (e.id === syncedItem.id ? syncedItem : e))
            } else {
              return [...prev, syncedItem]
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
        },
        2
      )
      setClassifying(prev => ({ ...prev, active: false }))
    } catch (err: any) {
      console.error('Batch sync failed:', err)
      const msg = `Backend Sync Failed: ${err.message || String(err)}`
      setClassifying(prev => ({ ...prev, active: false, error: msg }))
      setApiError(msg)
    }
  }, [])

  // Load Gmail messages (called when Gmail is connected)
  const loadGmailEmails = useCallback(async (token: string) => {
    setLoading(true)
    setApiError(null)
    try {
      // 1. Instant cache retrieval
      try {
        const cached = await getCachedEmailsApi(50)
        if (cached && cached.length > 0) {
          setEmails(cached)
        }
      } catch {}

      // 2. Fetch latest 25 messages from Gmail
      const res = await fetchEmailsPage(token, undefined, 25)
      setNextPageToken(res.nextPageToken || null)

      // Merge newly fetched emails into state immediately
      setEmails(prev => {
        const existingMap = new Map(prev.map(e => [e.id, e]))
        const combined = [...prev]
        for (const item of res.emails) {
          if (!existingMap.has(item.id)) {
            combined.push(item)
          }
        }
        return combined
      })

      // 3. Sync to Supabase Postgres cache progressively
      await syncEmailsWithBackend(res.emails)
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

      setEmails(prev => {
        const existingMap = new Map(prev.map(e => [e.id, e]))
        const combined = [...prev]
        for (const item of res.emails) {
          if (!existingMap.has(item.id)) {
            combined.push(item)
          }
        }
        return combined
      })

      await syncEmailsWithBackend(res.emails)
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
    // Fetch cached emails for this user from Postgres
    getCachedEmailsApi(50)
      .then(cached => {
        if (cached && cached.length > 0) {
          setEmails(cached)
        }
      })
      .catch(() => {})
  }

  function handleDemo() {
    setUser({ email: 'demo@averis.com', name: 'Demo User', provider: 'demo' })
    setEmails(MOCK_EMAILS)
    setNextPageToken(null)
    setPage('dashboard')
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

  // Show nothing or blank beige during initial session restore
  if (authChecking) {
    return <div style={{ minHeight: '100vh', background: bg }} />
  }

  // If not logged in and has no data, show LoginPage
  if (!user && !gmailToken && !emails.length) {
    return (
      <LoginPage
        onGoogleLogin={handleGoogleLogin}
        onSupabaseLogin={handleSupabaseLogin}
        onDemo={handleDemo}
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
              classifying={classifying}
              onClassify={() => syncEmailsWithBackend(emails)}
              apiError={apiError}
              onClearError={() => { setApiError(null); setClassifying(prev => ({ ...prev, error: null })) }}
              hasMore={!!nextPageToken}
              onLoadMore={loadMoreEmails}
              loadingMore={loadingMore}
            />
          )}
          {page === 'email-detail' && selectedEmail && (
            <EmailDetailPage
              email={selectedEmail}
              onBack={() => setPage('inbox')}
              onProcess={() => setPage('processing')}
            />
          )}
          {page === 'processing' && (
            <ProcessingPage onDone={() => setPage('comparison')} />
          )}
          {page === 'comparison' && (
            <ComparisonPage onBack={() => setPage('email-detail')} />
          )}
          {page === 'review' && (
            <ReviewPage onSelect={id => { setSelectedReviewId(id); setPage('review-detail') }} />
          )}
          {page === 'review-detail' && (
            <ReviewDetailPage id={selectedReviewId} onBack={() => setPage('review')} />
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
