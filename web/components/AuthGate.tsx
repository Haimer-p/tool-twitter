'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import { setAuth, getAuthHeader } from '@/lib/client';
import { LogIn } from 'lucide-react';

const AuthContext = createContext(false);

export function useAuthed() {
  return useContext(AuthContext);
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [authed, setAuthed] = useState(() => !!getAuthHeader());
  const [err, setErr] = useState('');

  if (authed) {
    return <AuthContext.Provider value={true}>{children}</AuthContext.Provider>;
  }

  return (
    <div className="max-w-sm mx-auto mt-24 card">
      <div className="flex items-center gap-2 mb-4">
        <LogIn className="w-5 h-5 text-accent" />
        <h2 className="font-semibold">Đăng nhập Dashboard</h2>
      </div>
      <div className="space-y-3">
        <div>
          <label className="label">User</label>
          <input className="input" value={user} onChange={(e) => setUser(e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && document.getElementById('login-btn')?.click()}
          />
        </div>
        {err && <p className="text-accent-red text-sm">{err}</p>}
        <button
          id="login-btn"
          className="btn btn-primary w-full justify-center"
          onClick={() => {
            setAuth(user, pass);
            fetch('/api/runtime', {
              headers: { Authorization: `Basic ${btoa(`${user}:${pass}`)}` },
            })
              .then((r) => {
                if (!r.ok) throw new Error('Sai user/password hoặc server lỗi');
                setAuthed(true);
              })
              .catch((e) => {
                setErr(e.message);
                sessionStorage.removeItem('dash_auth');
              });
          }}
        >
          Đăng nhập
        </button>
      </div>
    </div>
  );
}
