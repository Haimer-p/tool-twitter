'use client';

import { useEffect, useState } from 'react';
import { apiFetch, useApiPoll } from '@/lib/client';
import { Play, Square, Stethoscope } from 'lucide-react';

type Campaign = { _id: string; slug: string; symbol: string; status: string };

export default function ControlPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [runProfile, setRunProfile] = useState('vua');
  const [msg, setMsg] = useState('');
  const { data: runtime, reload } = useApiPoll<{
    online: boolean;
    runtime: { running?: boolean; stopping?: boolean; campaignId?: string };
    commands: { action: string; status: string; createdAt: string }[];
  }>('/api/runtime', 5000);

  useEffect(() => {
    apiFetch('/api/campaigns?status=active')
      .then((d) => {
        const list = d.campaigns || [];
        setCampaigns(list);
        if (list[0]) setCampaignId(list[0]._id);
      })
      .catch(() =>
        apiFetch('/api/campaigns').then((d) => {
          const list = (d.campaigns || []).filter(
            (c: Campaign) => c.status !== 'archived'
          );
          setCampaigns(list);
          if (list[0]) setCampaignId(list[0]._id);
        })
      );
  }, []);

  const send = async (action: string) => {
    setMsg('');
    try {
      await apiFetch('/api/commands', {
        method: 'POST',
        body: JSON.stringify({
          action,
          campaignId: action === 'start' ? campaignId : undefined,
          runProfile,
        }),
      });
      setMsg(
        action === 'stop'
          ? 'Đã gửi lệnh stop — bot sẽ dừng sau khi xong action hiện tại (có thể vài phút)'
          : `Đã gửi lệnh ${action} — worker sẽ xử lý trong vài giây`
      );
      reload();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Error');
    }
  };

  return (
    <div className="max-w-xl space-y-6">
        <h1 className="text-2xl font-bold">Bot Control</h1>

        <div className="card space-y-2">
          <div className="flex justify-between text-sm">
            <span>Worker</span>
            <span className={runtime?.online ? 'text-green-400' : 'text-gray-500'}>
              {runtime?.online ? 'Online' : 'Offline — chạy npm run worker trên máy local'}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Bot running</span>
            <span>
              {runtime?.runtime?.stopping
                ? 'Đang dừng...'
                : runtime?.runtime?.running
                  ? 'Yes'
                  : 'No'}
            </span>
          </div>
        </div>

        <div className="card space-y-4">
          <div>
            <label className="label">Token Campaign</label>
            <select className="input" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              {campaigns.map((c) => (
                <option key={c._id} value={c._id}>
                  ${c.symbol} — {c.slug} ({c.status})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Run profile</label>
            <select className="input" value={runProfile} onChange={(e) => setRunProfile(e.target.value)}>
              <option value="yeu">Yếu (chậm)</option>
              <option value="vua">Vừa</option>
              <option value="manh">Mạnh (nhanh)</option>
            </select>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-primary" onClick={() => send('start')}>
              <Play className="w-4 h-4" /> Start
            </button>
            <button className="btn btn-danger" onClick={() => send('stop')}>
              <Square className="w-4 h-4" /> Stop
            </button>
            <button className="btn btn-ghost" onClick={() => send('health_check')}>
              <Stethoscope className="w-4 h-4" /> Health Check
            </button>
          </div>
          {msg && <p className="text-sm text-accent-green">{msg}</p>}
        </div>

        {runtime?.commands?.length ? (
          <div className="card">
            <h3 className="font-semibold mb-2 text-sm">Lệnh gần đây</h3>
            <ul className="text-xs space-y-1 text-surface-muted">
              {runtime.commands.slice(0, 5).map((c, i) => (
                <li key={i}>
                  {c.action} — {c.status} — {new Date(c.createdAt).toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
  );
}
