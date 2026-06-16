'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, useApiPoll } from '@/lib/client';
import { Stethoscope, RefreshCw, Play } from 'lucide-react';

type HealthResult = {
  accountName: string;
  status: string;
  profile?: { username?: string; displayName?: string };
  checks?: Record<string, { ok?: boolean }>;
  durationMs?: number;
};

type HealthRun = {
  startedAt?: string;
  completedAt?: string;
  summary?: { alive?: number; partial?: number; suspended?: number; dead?: number; total?: number };
  results?: HealthResult[];
};

type Account = { name: string; lastHealthStatus?: string };

function statusBadge(s?: string) {
  if (!s) return <span className="badge bg-gray-800 text-gray-400">unknown</span>;
  return <span className={`badge badge-${s}`}>{s}</span>;
}

function HealthContent() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState('');

  const { data: health, reload } = useApiPoll<{ latest: HealthRun | null }>('/api/health', 8000);
  const { data: runtime } = useApiPoll<{ online: boolean }>('/api/runtime', 8000);

  const loadAccounts = useCallback(async () => {
    const data = await apiFetch('/api/accounts');
    const list = data.accounts || [];
    setAccounts(list);
    setSelected(list.map((a: Account) => a.name));
  }, []);

  useEffect(() => {
    loadAccounts().catch(console.error);
  }, [loadAccounts]);

  const toggle = (name: string) => {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const runCheck = async () => {
    if (!runtime?.online) {
      setMsg('Worker offline — chạy npm run worker trước');
      return;
    }
    setRunning(true);
    setMsg('');
    try {
      await apiFetch('/api/commands', {
        method: 'POST',
        body: JSON.stringify({
          action: 'health_check',
          accountNames: selected.length ? selected : undefined,
        }),
      });
      setMsg('Đã gửi lệnh health check — đợi worker xử lý (1–3 phút)...');
      setTimeout(() => reload(), 15000);
      setTimeout(() => reload(), 45000);
      setTimeout(() => {
        reload();
        loadAccounts();
      }, 90000);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Lỗi');
    } finally {
      setRunning(false);
    }
  };

  const latest = health?.latest;
  const results = latest?.results || [];
  const summary = latest?.summary;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Stethoscope className="w-6 h-6 text-accent" />
            Health Check
          </h1>
          <p className="text-surface-muted text-sm mt-1">
            Worker:{' '}
            <span className={runtime?.online ? 'text-green-400' : 'text-red-400'}>
              {runtime?.online ? 'online' : 'offline'}
            </span>
          </p>
        </div>
        <button type="button" className="btn btn-ghost w-full sm:w-auto justify-center" onClick={() => reload()}>
          <RefreshCw className="w-4 h-4" />
          <span>Refresh</span>
        </button>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-sm">Chọn account</h2>
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => (
            <label
              key={a.name}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm cursor-pointer max-w-full ${
                selected.includes(a.name)
                  ? 'border-accent bg-accent/10'
                  : 'border-surface-border'
              }`}
            >
              <input
                type="checkbox"
                checked={selected.includes(a.name)}
                onChange={() => toggle(a.name)}
              />
              <span className="truncate max-w-[120px] sm:max-w-none">{a.name}</span>
              {statusBadge(a.lastHealthStatus)}
            </label>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-primary w-full sm:w-auto justify-center"
          disabled={running || !selected.length}
          onClick={runCheck}
        >
          <Play className="w-4 h-4" />
          {running ? 'Đang gửi lệnh...' : 'Chạy Health Check'}
        </button>
        {msg && <p className="text-sm text-surface-muted">{msg}</p>}
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            ['alive', summary.alive, 'text-green-400'],
            ['partial', summary.partial, 'text-yellow-400'],
            ['suspended', summary.suspended, 'text-orange-400'],
            ['dead', summary.dead, 'text-red-400'],
          ].map(([label, val, color]) => (
            <div key={String(label)} className="card text-center py-3">
              <div className={`text-2xl font-bold ${color}`}>{val ?? 0}</div>
              <div className="text-xs text-surface-muted capitalize">{label}</div>
            </div>
          ))}
        </div>
      )}

      {latest?.completedAt && (
        <p className="text-xs text-surface-muted">
          Lần cuối: {new Date(latest.completedAt).toLocaleString('vi-VN')}
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold">Kết quả</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {results.map((r) => (
              <div key={r.accountName} className="card space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{r.accountName}</div>
                    <div className="text-xs text-surface-muted">
                      @{r.profile?.username || '?'}
                    </div>
                  </div>
                  {statusBadge(r.status)}
                </div>
                {r.checks && (
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {Object.entries(r.checks).map(([k, v]) => (
                      <span
                        key={k}
                        className={`badge ${v?.ok ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function HealthPage() {
  return <HealthContent />;
}
