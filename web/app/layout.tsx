import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Portal do Afiliado',
  description: 'Painel SaaS para gerenciar automacoes entre Telegram e WhatsApp.',
  icons: {
    icon: '/brand/portal-icon.svg',
    shortcut: '/brand/portal-icon.svg'
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
