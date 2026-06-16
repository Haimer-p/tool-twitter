'use client';

import { useApiPoll } from '@/lib/client';
import { Heart, Repeat2, MessageCircle, UserPlus, Wifi, WifiOff } from 'lucide-react';

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="card flex items-center gap-4">
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-surface-muted">{label}</div>
      </div>
    </div>
  );
}

function DashboardContent() {
  const { data: stats } = useApiPoll<{ totals: Record<string, number> }>('/api/stats');
  const { data: runtime } = useApiPoll<{ online: boolean; runtime: Record<string, unknown> }>(
    '/api/runtime',
    5000
  );

  const t = stats?.totals || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-surface-muted text-sm">Thống kê tương tác & trạng thái worker</p>
        </div>
        <div
          className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border ${
            runtime?.online
              ? 'border-green-700 text-green-400 bg-green-900/20'
              : 'border-gray-600 text-gray-400'
          }`}
        >
          {runtime?.online ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
          Worker {runtime?.online ? 'online' : 'offline'}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Heart} label="Likes" value={t.likes || 0} color="bg-pink-900/40 text-pink-400" />
        <StatCard icon={Repeat2} label="Retweets" value={t.retweets || 0} color="bg-blue-900/40 text-blue-400" />
        <StatCard
          icon={MessageCircle}
          label="Replies"
          value={t.replies || 0}
          color="bg-purple-900/40 text-purple-400"
        />
        <StatCard
          icon={UserPlus}
          label="Follows"
          value={t.follows || 0}
          color="bg-green-900/40 text-green-400"
        />
      </div>
    </div>
  );
}

export default function HomePage() {
  return <DashboardContent />;
}
