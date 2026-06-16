'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/client';
import { Pencil, Trash2, Plus } from 'lucide-react';

type Account = {
  name: string;
  enabled: boolean;
  hasCookies: boolean;
  lastHealthStatus?: string;
  profile?: { username?: string };
};

function statusBadge(s?: string) {
  if (!s) return <span className="badge bg-gray-800 text-gray-400">unknown</span>;
  return <span className={`badge badge-${s}`}>{s}</span>;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const data = await apiFetch('/api/accounts');
    setAccounts(data.accounts || []);
    setLoading(false);
  };

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const remove = async (name: string) => {
    const confirm = prompt(`Gõ tên account để xóa: ${name}`);
    if (confirm !== name) return;
    await apiFetch(`/api/accounts/${encodeURIComponent(name)}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="space-y-4">
        <div className="page-header">
          <h1 className="text-xl sm:text-2xl font-bold">Accounts</h1>
          <div className="flex gap-2 shrink-0">
            <Link href="/health" className="btn btn-ghost">
              Health Check
            </Link>
            <Link href="/accounts/new" className="btn btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden xs:inline sm:inline">Thêm account</span>
            <span className="sm:hidden">Thêm</span>
            </Link>
          </div>
        </div>

        {loading ? (
          <p className="text-surface-muted">Đang tải...</p>
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="grid gap-3 md:hidden">
              {accounts.map((a) => (
                <div key={a.name} className="card space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-surface-muted">@{a.profile?.username || '?'}</div>
                    </div>
                    {statusBadge(a.lastHealthStatus)}
                  </div>
                  <div className="flex gap-3 text-xs text-surface-muted">
                    <span>Cookies: {a.hasCookies ? '✓' : '✗'}</span>
                    <span>Enabled: {a.enabled ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Link
                      href={`/accounts/${encodeURIComponent(a.name)}/edit`}
                      className="btn btn-ghost flex-1 justify-center py-2"
                    >
                      <Pencil className="w-4 h-4" /> Sửa
                    </Link>
                    <button
                      type="button"
                      className="btn btn-danger py-2 px-3"
                      onClick={() => remove(a.name)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="card overflow-x-auto hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-surface-muted border-b border-surface-border">
                    <th className="text-left py-2 pr-4">Name</th>
                    <th className="text-left py-2 pr-4">Twitter</th>
                    <th className="text-left py-2 pr-4">Health</th>
                    <th className="text-left py-2 pr-4">Cookies</th>
                    <th className="text-left py-2 pr-4">Enabled</th>
                    <th className="text-right py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.name} className="border-b border-surface-border/50">
                      <td className="py-3 pr-4 font-medium">{a.name}</td>
                      <td className="py-3 pr-4 text-surface-muted">@{a.profile?.username || '?'}</td>
                      <td className="py-3 pr-4">{statusBadge(a.lastHealthStatus)}</td>
                      <td className="py-3 pr-4">{a.hasCookies ? '✓' : '✗'}</td>
                      <td className="py-3 pr-4">{a.enabled ? 'Yes' : 'No'}</td>
                      <td className="py-3 text-right space-x-2">
                        <Link
                          href={`/accounts/${encodeURIComponent(a.name)}/edit`}
                          className="btn btn-ghost py-1 px-2 inline-flex"
                        >
                          <Pencil className="w-4 h-4" />
                        </Link>
                        <button
                          type="button"
                          className="btn btn-danger py-1 px-2"
                          onClick={() => remove(a.name)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
  );
}
