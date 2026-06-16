'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client';

export default function NewAccountPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [cookiesJson, setCookiesJson] = useState('[]');
  const [err, setErr] = useState('');

  const submit = async () => {
    try {
      const cookies = JSON.parse(cookiesJson);
      await apiFetch('/api/accounts', {
        method: 'POST',
        body: JSON.stringify({ name, cookies, enabled: true }),
      });
      router.push('/accounts');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Error');
    }
  };

  return (
    <div className="max-w-xl space-y-4">
        <h1 className="text-2xl font-bold">Thêm Account</h1>
        <div>
          <label className="label">Tên account</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Cookies JSON (paste từ accounts/*.json)</label>
          <textarea
            className="input min-h-[200px] font-mono text-xs"
            value={cookiesJson}
            onChange={(e) => setCookiesJson(e.target.value)}
          />
        </div>
        {err && <p className="text-accent-red text-sm">{err}</p>}
        <button className="btn btn-primary" onClick={submit}>
          Lưu
        </button>
      </div>
  );
}
