'use client';

import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import AuthGate from '@/components/AuthGate';
import { Bot, Menu } from 'lucide-react';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <AuthGate>
      <div className="min-h-screen bg-surface">
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 flex items-center gap-3 border-b border-surface-border bg-surface-card px-4 py-3">
        <button
          type="button"
          className="btn btn-ghost p-2"
          onClick={() => setOpen(true)}
          aria-label="Mở menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <Bot className="w-6 h-6 text-accent shrink-0" />
        <span className="font-semibold text-sm truncate">Twitter Farm</span>
      </header>

      {/* Backdrop */}
      {open && (
        <button
          type="button"
          className="lg:hidden fixed inset-0 z-40 bg-black/60"
          aria-label="Đóng menu"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="flex">
        <Sidebar open={open} onClose={() => setOpen(false)} />
        <main className="flex-1 min-w-0 p-4 sm:p-6 max-w-6xl w-full mx-auto">{children}</main>
      </div>
    </div>
    </AuthGate>
  );
}
