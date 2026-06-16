import AppShell from '@/components/AppShell';
import './globals.css';

export const metadata = {
  title: 'Twitter Bot Dashboard',
  description: 'Remote control for Twitter engagement bot',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className="dark">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
