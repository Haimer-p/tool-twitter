'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client';

export default function EditAccountPage() {
  const params = useParams();
  const name = decodeURIComponent(params.name as string);
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);
  const [notes, setNotes] = useState('');
  const [cookiesJson, setCookiesJson] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch(`/api/accounts/${encodeURIComponent(name)}`).then((d) => {
      setEnabled(d.account.enabled !== false);
      setNotes(d.account.notes || '');
    });
  }, [name]);

  const save = async () => {
    try {
      const body: Record<string, unknown> = { enabled, notes };
      if (cookiesJson.trim()) body.cookies = JSON.parse(cookiesJson);
      await apiFetch(`/api/accounts/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      router.push('/accounts');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Error');
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl sm:text-2xl font-bold break-words">Sửa: {name}</h1>
      <div>
        <label className="label flex items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
      </div>
      <div>
        <label className="label">Ghi chú</label>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div>
        <label className="label">Cookies mới (optional, paste JSON)</label>
        <textarea
          className="input min-h-[150px] sm:min-h-[160px] font-mono text-xs"
          value={cookiesJson}
          onChange={(e) => setCookiesJson(e.target.value)}
          placeholder="Để trống nếu không đổi cookies"
        />
      </div>
      {err && <p className="text-accent-red text-sm">{err}</p>}
      <button className="btn btn-primary w-full sm:w-auto justify-center" onClick={save}>
        Lưu
      </button>
    </div>
  );
}
