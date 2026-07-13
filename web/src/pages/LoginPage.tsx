import { useState, type FormEvent } from 'react'
import { api } from '../api'

export default function LoginPage({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password.trim()) return
    setLoading(true)
    setError(null)
    try {
      await api.login(password)
      onLoginSuccess()
    } catch (err: any) {
      setError(err.message || '密码验证失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fade-in" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '75dvh',
      padding: '20px'
    }}>
      <div className="capture-hero" style={{ marginBottom: '28px' }}>
        <div className="big" style={{ fontSize: '48px' }}>乱写</div>
        <div className="hint" style={{ fontSize: '13px', marginTop: '6px', color: 'var(--ink-soft)' }}>
          丢进来，慢慢长
        </div>
      </div>
      
      <div className="card" style={{
        width: '100%',
        maxWidth: '360px',
        padding: '24px 20px',
        border: '1px solid var(--line)',
        borderRadius: '16px',
        background: 'var(--paper-card)',
        boxShadow: '0 4px 16px rgba(43,38,32,0.1)'
      }}>
        <h3 style={{
          fontFamily: 'var(--serif)',
          fontSize: '18px',
          fontWeight: 900,
          marginBottom: '16px',
          textAlign: 'center',
          letterSpacing: '1px'
        }}>
          验证身份
        </h3>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <input
              type="password"
              placeholder="请输入管理员密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoFocus
              style={{
                width: '100%',
                fontSize: '15px',
                padding: '10px 12px',
                border: '1px solid var(--line)',
                borderRadius: '8px',
                background: 'var(--paper-card)',
                color: 'var(--ink)',
                outline: 'none',
                textAlign: 'center',
                letterSpacing: password ? '3px' : 'normal'
              }}
            />
          </div>
          
          {error && (
            <div style={{
              fontSize: '12px',
              color: 'var(--cinnabar)',
              textAlign: 'center',
              background: 'var(--seal-bg)',
              padding: '6px 10px',
              borderRadius: '6px'
            }}>
              {error}
            </div>
          )}
          
          <button
            type="submit"
            className="btn primary"
            disabled={loading || !password.trim()}
            style={{ width: '100%', marginTop: '4px' }}
          >
            {loading ? '验证中…' : '登 入'}
          </button>
        </form>
      </div>
    </div>
  )
}
