import { useState, useEffect, useCallback } from 'react'
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
        (syncedItem) => {
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
          // Revert status so item isn't stuck in 'Processing'
          setEmails(prev => prev.map(e => e.id === originalItem.id ? { ...e, status: e.status === 'Processing' ? 'New' : e.status } : e))
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
            <ComparisonPage
              onBack={() => setPage('email-detail')}
              onGoToUpload={() => setPage('upload')}
              subject={selectedEmail?.subject}
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
