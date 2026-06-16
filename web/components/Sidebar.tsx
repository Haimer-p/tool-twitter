'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Coins,
  Sparkles,
  Play,
  Stethoscope,
  Bot,
  X,
} from 'lucide-react';

const nav = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/campaigns', label: 'Campaigns', icon: Coins, group: 'campaigns' as const },
  { href: '/campaigns/new', label: 'New Token', icon: Sparkles, exact: true },
  { href: '/accounts', label: 'Accounts', icon: Users },
  { href: '/health', label: 'Health Check', icon: Stethoscope },
  { href: '/control', label: 'Control', icon: Play },
];

function isNavActive(
  pathname: string,
  href: string,
  opts?: { exact?: boolean; group?: 'campaigns' }
) {
  if (opts?.exact) return pathname === href;
  if (opts?.group === 'campaigns') {
    if (pathname === '/campaigns/new') return false;
    return pathname === '/campaigns' || pathname.startsWith('/campaigns/');
  }
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

type SidebarProps = {
  open?: boolean;
  onClose?: () => void;
};

export default function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();

  const linkClass = (active: boolean) =>
    `flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition ${
      active ? 'bg-accent/20 text-accent font-medium' : 'text-gray-300 hover:bg-surface-border'
    }`;

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2 px-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="w-7 h-7 text-accent shrink-0" />
          <div className="min-w-0">
            <div className="font-bold text-sm truncate">Twitter Farm</div>
            <div className="text-xs text-surface-muted">Remote Control</div>
          </div>
        </div>
        {onClose && (
          <button type="button" className="lg:hidden btn btn-ghost p-2" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
      <nav className="flex flex-col gap-1">
        {nav.map(({ href, label, icon: Icon, exact, group }) => {
          const active = isNavActive(pathname, href, { exact, group });
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={linkClass(active)}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 shrink-0 border-r border-surface-border bg-surface-card min-h-screen p-4 flex-col gap-4">
        {inner}
      </aside>

      {/* Mobile drawer */}
      <aside
        className={`lg:hidden fixed top-0 left-0 z-50 h-full w-[80vw] max-w-xs border-r border-surface-border bg-surface-card p-4 flex flex-col gap-4 transform transition-transform duration-200 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {inner}
      </aside>
    </>
  );
}
