'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/client';
import { Pencil, Trash2, Copy, Archive, Plus } from 'lucide-react';

type Campaign = {
  _id: string;
  slug: string;
  symbol: string;
  name: string;
  status: string;
  accounts: { name: string }[];
  updatedAt: string;
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [filter, setFilter] = useState('');

  const load = async () => {
    const q = filter ? `?status=${filter}` : '';
    const data = await apiFetch(`/api/campaigns${q}`);
    setCampaigns(data.campaigns || []);
  };

  useEffect(() => {
    load().catch(console.error);
  }, [filter]);

  const remove = async (id: string, slug: string) => {
    if (!confirm(`Xóa campaign ${slug}?`)) return;
    await apiFetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    load();
  };

  const duplicate = async (id: string) => {
    await apiFetch(`/api/campaigns/${id}/duplicate`, { method: 'POST' });
    load();
  };

  const archive = async (id: string) => {
    await apiFetch(`/api/campaigns/${id}/archive`, { method: 'POST' });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="page-header">
        <h1 className="text-xl sm:text-2xl font-bold">Campaigns / Configs</h1>
        <div className="page-actions">
          <select
            className="input w-full sm:w-auto"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
              <option value="">Tất cả</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
          </select>
          <Link href="/campaigns/new" className="btn btn-primary w-full sm:w-auto justify-center">
            <Plus className="w-4 h-4" /> New Token
          </Link>
        </div>
      </div>

      <div className="grid gap-3 md:hidden">
        {campaigns.map((c) => (
          <div key={c._id} className="card space-y-3">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="font-mono font-medium">${c.symbol}</div>
                <div className="text-sm break-words">{c.name}</div>
              </div>
              <span className="badge bg-gray-800 shrink-0">{c.status}</span>
            </div>
            <div className="text-xs text-surface-muted">
              Accounts: {c.accounts?.length || 0}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/campaigns/${c._id}/edit`} className="btn btn-ghost py-1.5 px-2 inline-flex">
                <Pencil className="w-4 h-4" />
              </Link>
              <button className="btn btn-ghost py-1.5 px-2" onClick={() => duplicate(c._id)}>
                <Copy className="w-4 h-4" />
              </button>
              <button className="btn btn-ghost py-1.5 px-2" onClick={() => archive(c._id)}>
                <Archive className="w-4 h-4" />
              </button>
              <button className="btn btn-danger py-1.5 px-2" onClick={() => remove(c._id, c.slug)}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card table-wrap hidden md:block">
        <table className="table-base">
            <thead>
              <tr className="text-surface-muted border-b border-surface-border">
                <th className="text-left py-2">Symbol</th>
                <th className="text-left py-2">Name</th>
                <th className="text-left py-2">Accounts</th>
                <th className="text-left py-2">Status</th>
                <th className="text-right py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c._id} className="border-b border-surface-border/50">
                  <td className="py-3 font-mono">${c.symbol}</td>
                  <td className="py-3">{c.name}</td>
                  <td className="py-3">{c.accounts?.length || 0}</td>
                  <td className="py-3">
                    <span className="badge bg-gray-800">{c.status}</span>
                  </td>
                  <td className="py-3 text-right space-x-1">
                    <Link href={`/campaigns/${c._id}/edit`} className="btn btn-ghost py-1 px-2 inline-flex">
                      <Pencil className="w-4 h-4" />
                    </Link>
                    <button className="btn btn-ghost py-1 px-2" onClick={() => duplicate(c._id)}>
                      <Copy className="w-4 h-4" />
                    </button>
                    <button className="btn btn-ghost py-1 px-2" onClick={() => archive(c._id)}>
                      <Archive className="w-4 h-4" />
                    </button>
                    <button className="btn btn-danger py-1 px-2" onClick={() => remove(c._id, c.slug)}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
        </table>
      </div>
    </div>
  );
}
