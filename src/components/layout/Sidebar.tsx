import type { Page, GmailEmail, UserInfo } from '../../types'
import { navy, ink } from '../../constants/tokens'
import { LogoutIcon } from '../primitives'

interface SidebarProps {
  page: Page
  onNav: (p: Page) => void
  user: UserInfo | null
  emails: GmailEmail[]
  onLogout: () => void
  accent?: 'success' | 'error' | null
}

const ACCENT_COLOR = { success: '#22C55E', error: '#EF4444' } as const

export function Sidebar({ page, onNav, user, emails, onLogout, accent }: SidebarProps) {
  const unread = emails.filter(e => e.status === 'New').length
  const reviewCount = emails.filter(e => e.status === 'Needs Review').length
  const accentColor = accent ? ACCENT_COLOR[accent] : 'transparent'

  const nav: { id: Page; label: string; count?: number }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'inbox', label: 'Inbox', count: unread || undefined },
    { id: 'upload', label: 'Upload & Compare' },
    { id: 'review', label: 'Review', count: reviewCount || undefined },
    { id: 'reports', label: 'Reports' },
    { id: 'settings', label: 'Settings' },
  ]

  return (
    <aside
      className="app-sidebar"
      style={{
        background: navy,
        borderRight: `3px solid ${accentColor}`,
        boxShadow: accent ? `inset -8px 0 16px -12px ${accentColor}` : 'none',
        transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
      }}
    >
      {/* Logo */}
      <div style={{ padding: '28px 20px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo.png" alt="" style={{ height: 32, width: 'auto', flexShrink: 0 }} />
          <div>
            <div style={{ fontFamily: 'Playfair Display, serif', color: 'white', fontSize: 16, fontWeight: 700, lineHeight: 1 }}>ShipCheck</div>
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '0 20px' }} />

      {/* Nav */}
      <nav style={{ flex: 1, padding: '16px 0' }}>
        <div style={{ fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', padding: '0 20px', marginBottom: 8, fontWeight: 600 }}>Navigation</div>
        {nav.map(({ id, label, count }) => {
          const active = page === id
          return (
            <button
              key={id}
              onClick={() => onNav(id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 20px', border: 'none', background: 'none',
                cursor: 'pointer', textAlign: 'left', position: 'relative',
                borderLeft: active ? '2px solid #F59E0B' : '2px solid transparent',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: active ? 600 : 400, color: active ? 'white' : 'rgba(255,255,255,0.5)', flex: 1 }}>{label}</span>
              {count ? (
                <span style={{ fontSize: 10, fontWeight: 700, minWidth: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3, background: '#F59E0B', color: ink, padding: '0 4px' }}>{count}</span>
              ) : null}
            </button>
          )
        })}
      </nav>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '0 20px' }} />

      {/* User Section & Logout */}
      <div style={{ padding: '14px 20px 20px' }}>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            {user.picture
              ? <img src={user.picture} style={{ width: 26, height: 26, borderRadius: '50%' }} alt="" />
              : <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'white' }}>{user.name?.[0] || 'U'}</div>
            }
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'white', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
            </div>
          </div>
        )}
        <button
          onClick={onLogout}
          title="Log Out"
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: 3, cursor: 'pointer', color: '#FCA5A5', fontSize: 11, padding: '6px 7px' }}
        >
          <LogoutIcon /> Log Out
        </button>
      </div>
    </aside>
  )
}

