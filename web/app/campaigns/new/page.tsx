'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client';
import { Sparkles } from 'lucide-react';

type Account = { name: string; lastHealthStatus?: string };

const DEFAULT_RATIOS = {
  like: 0.03,
  retweet: 0.03,
  reply: 0.28,
  follow: 0.02,
  like_retweet: 0.03,
  like_reply: 0.32,
  like_retweet_reply: 0.25,
  like_follow: 0.02,
  like_retweet_follow: 0.02,
};

export default function NewCampaignPage() {
  const router = useRouter();
  const [dexUrl, setDexUrl] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [ratiosJson, setRatiosJson] = useState(JSON.stringify(DEFAULT_RATIOS, null, 2));
  const [keywordsPerRun, setKeywordsPerRun] = useState(25);
  const [tweetsPerKeyword, setTweetsPerKeyword] = useState(15);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    apiFetch('/api/accounts').then((d) => setAccounts(d.accounts || []));
  }, []);

  const toggle = (name: string) => {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const generate = async (save: boolean) => {
    setLoading(true);
    setErr('');
    try {
      let comboRatios = DEFAULT_RATIOS;
      try {
        comboRatios = JSON.parse(ratiosJson);
      } catch {
        throw new Error('comboRatios JSON không hợp lệ');
      }

      const data = await apiFetch('/api/campaigns/generate', {
        method: 'POST',
        body: JSON.stringify({
          dexUrl,
          accountNames: selected,
          save,
          defaults: {
            interactions: {
              keywordsPerRun,
              tweetsPerKeyword,
              comboRatios,
            },
          },
          parallel: { maxConcurrent: selected.length || 2 },
        }),
      });
      setPreview(data);
      if (save && data.campaign?._id) {
        router.push(`/campaigns/${data.campaign._id}/edit`);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-accent" />
          Generate Token Campaign
        </h1>

        <div className="card space-y-4">
          <div>
            <label className="label">DexScreener URL</label>
            <input
              className="input"
              placeholder="https://dexscreener.com/solana/..."
              value={dexUrl}
              onChange={(e) => setDexUrl(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Chọn accounts</label>
            <div className="flex flex-wrap gap-2">
              {accounts.map((a) => (
                <label
                  key={a.name}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer text-sm max-w-full ${
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
                  {a.lastHealthStatus === 'alive' && (
                    <span className="badge badge-alive">alive</span>
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="form-grid-2">
            <div>
              <label className="label">keywordsPerRun</label>
              <input
                className="input"
                type="number"
                value={keywordsPerRun}
                onChange={(e) => setKeywordsPerRun(+e.target.value)}
              />
            </div>
            <div>
              <label className="label">tweetsPerKeyword</label>
              <input
                className="input"
                type="number"
                value={tweetsPerKeyword}
                onChange={(e) => setTweetsPerKeyword(+e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label">comboRatios (JSON)</label>
            <textarea
              className="input font-mono text-xs min-h-[120px]"
              value={ratiosJson}
              onChange={(e) => setRatiosJson(e.target.value)}
            />
          </div>

          {err && <p className="text-accent-red text-sm">{err}</p>}

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              className="btn btn-ghost w-full sm:w-auto justify-center"
              disabled={loading || !dexUrl || !selected.length}
              onClick={() => generate(false)}
            >
              Preview
            </button>
            <button
              className="btn btn-primary w-full sm:w-auto justify-center"
              disabled={loading || !dexUrl || !selected.length}
              onClick={() => generate(true)}
            >
              {loading ? 'Generating...' : 'Generate & Save'}
            </button>
          </div>
        </div>

        {preview && (
          <div className="card">
            <h3 className="font-semibold mb-2">Preview</h3>
            <pre className="text-xs overflow-auto max-h-96 text-surface-muted">
              {JSON.stringify(preview, null, 2)}
            </pre>
          </div>
        )}
      </div>
  );
}
