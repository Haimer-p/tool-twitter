'use client';

import { useEffect, useState } from 'react';
import { apiFetch, useApiPoll } from '@/lib/client';
import { Play, Square, Stethoscope, UserCheck } from 'lucide-react';

type Campaign = { _id: string; slug: string; symbol: string; status: string };
type Account = { name: string; enabled?: boolean };

export default function ControlPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [loginAccountName, setLoginAccountName] = useState('');
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

    apiFetch('/api/accounts')
      .then((d) => {
        const list = (d.accounts || []).filter((a: Account) => a.enabled !== false);
        setAccounts(list);
        if (list[0]) setLoginAccountName(list[0].name);
      })
      .catch(() => {
        setAccounts([]);
      });
  }, []);

  const send = async (action: string, payload: Record<string, unknown> = {}) => {
    setMsg('');
    try {
      await apiFetch('/api/commands', {
        method: 'POST',
        body: JSON.stringify({
          action,
          campaignId: action === 'start' ? campaignId : undefined,
          runProfile,
          ...payload,
        }),
      });
      setMsg(
        action === 'stop'
          ? 'Đã gửi lệnh stop — bot sẽ dừng sau khi xong action hiện tại (có thể vài phút)'
          : action === 'login_account'
            ? 'Đã mở browser login. Browser sẽ giữ nguyên đến khi bạn bấm Stop hoặc tự tắt browser.'
          : `Đã gửi lệnh ${action} — worker sẽ xử lý trong vài giây`
      );
      reload();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Error');
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold">Bot Control</h1>

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
        <div className="flex flex-col sm:flex-row gap-2">
          <button className="btn btn-primary w-full sm:w-auto justify-center" onClick={() => send('start')}>
            <Play className="w-4 h-4" /> Start
          </button>
          <button className="btn btn-danger w-full sm:w-auto justify-center" onClick={() => send('stop')}>
            <Square className="w-4 h-4" /> Stop
          </button>
          <button className="btn btn-ghost w-full sm:w-auto justify-center" onClick={() => send('health_check')}>
            <Stethoscope className="w-4 h-4" /> Health Check
          </button>
        </div>
        {msg && <p className="text-sm text-accent-green">{msg}</p>}
      </div>

      <div className="card space-y-4">
        <h3 className="font-semibold">Login 1 account (giữ browser mở)</h3>
        <div>
          <label className="label">Account</label>
          <select
            className="input"
            value={loginAccountName}
            onChange={(e) => setLoginAccountName(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn btn-ghost w-full sm:w-auto justify-center"
          disabled={!loginAccountName}
          onClick={() => send('login_account', { accountNames: [loginAccountName] })}
        >
          <UserCheck className="w-4 h-4" /> Login Account
        </button>
        <p className="text-xs text-surface-muted">
          Sau khi login thành công, browser sẽ không tự đóng. Bấm Stop để đóng hoặc tự đóng cửa sổ browser.
        </p>
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
