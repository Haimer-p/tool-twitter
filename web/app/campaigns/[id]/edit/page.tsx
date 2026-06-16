'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client';

export default function EditCampaignPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const [campaign, setCampaign] = useState<Record<string, unknown> | null>(null);
  const [keywordsText, setKeywordsText] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch(`/api/campaigns/${id}`).then((d) => {
      setCampaign(d.campaign);
      const acc = d.campaign?.accounts?.[0];
      setKeywordsText((acc?.keywords || []).join('\n'));
    });
  }, [id]);

  const save = async () => {
    if (!campaign) return;
    try {
      const keywords = keywordsText.split('\n').map((k) => k.trim()).filter(Boolean);
      const accounts = (campaign.accounts as { name: string; keywords?: string[] }[]).map(
        (a, i) => (i === 0 ? { ...a, keywords } : a)
      );
      await apiFetch(`/api/campaigns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ accounts, status: 'active' }),
      });
      router.push('/campaigns');
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Error');
    }
  };

  if (!campaign) return <p className="text-surface-muted">Loading...</p>;

  return (
    <div className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold">
          Edit: ${String(campaign.symbol)} — {String(campaign.name)}
        </h1>
        <div className="card space-y-3 text-sm">
          <div>
            <span className="text-surface-muted">Dex: </span>
            <a href={String(campaign.dexUrl)} className="text-accent" target="_blank" rel="noreferrer">
              {String(campaign.dexUrl)}
            </a>
          </div>
          <div>
            <span className="text-surface-muted">Accounts: </span>
            {(campaign.accounts as { name: string }[])?.map((a) => a.name).join(', ')}
          </div>
        </div>
        <div>
          <label className="label">Keywords (account đầu tiên — mỗi dòng 1 keyword)</label>
          <textarea
            className="input min-h-[300px] font-mono text-xs"
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
          />
        </div>
        {err && <p className="text-accent-red text-sm">{err}</p>}
        <button className="btn btn-primary" onClick={save}>
          Lưu & Activate
        </button>
      </div>
  );
}
