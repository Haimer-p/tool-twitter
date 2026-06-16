'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { setAuth, clearAuth, hasStoredAuth, verifyStoredAuth } from '@/lib/client';
import { LogIn } from 'lucide-react';

const AuthContext = createContext(false);

export function useAuthed() {
  return useContext(AuthContext);
}

type AuthState = 'loading' | 'guest' | 'authed';

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [state, setState] = useState<AuthState>('loading');
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!hasStoredAuth()) {
        if (!cancelled) setState('guest');
        return;
      }
      const ok = await verifyStoredAuth();
      if (!cancelled) setState(ok ? 'authed' : 'guest');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center text-surface-muted text-sm">
        Đang kiểm tra đăng nhập...
      </div>
    );
  }

  if (state === 'authed') {
    return <AuthContext.Provider value={true}>{children}</AuthContext.Provider>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm card">
        <div className="flex items-center gap-2 mb-4">
          <LogIn className="w-5 h-5 text-accent" />
          <h2 className="font-semibold">Đăng nhập Dashboard</h2>
        </div>
        <div className="space-y-3">
          <div>
            <label className="label">User</label>
            <input
              className="input"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete="current-password"
              onKeyDown={(e) => e.key === 'Enter' && document.getElementById('login-btn')?.click()}
            />
          </div>
          <p className="text-xs text-surface-muted">
            Đăng nhập một lần — thông tin được lưu trên thiết bị này.
          </p>
          {err && <p className="text-accent-red text-sm">{err}</p>}
          <button
            id="login-btn"
            className="btn btn-primary w-full justify-center"
            onClick={() => {
              setErr('');
              setAuth(user, pass);
              fetch('/api/runtime', {
                headers: { Authorization: `Basic ${btoa(`${user}:${pass}`)}` },
              })
                .then((r) => {
                  if (!r.ok) throw new Error('Sai user/password hoặc server lỗi');
                  setState('authed');
                })
                .catch((e) => {
                  clearAuth();
                  setErr(e.message);
                });
            }}
          >
            Đăng nhập
          </button>
        </div>
      </div>
    </div>
  );
}
