import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MiikaCord',
  description: 'Chat premium com servidores, voz, DMs e comunidade'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
