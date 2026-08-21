import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "OpsPanel — Control plane WordOps",
  description:
    "Plataforma open source para gerenciar servidores Linux com WordOps: sites, SSL, stack, monitoramento, IA e MCP.",
  openGraph: {
    title: "OpsPanel — Control plane WordOps",
    description: "Gerencie servidores WordOps, crie sites e opere com jobs assíncronos e auditoria.",
    type: "website",
  },
};

const themeBootScript = `(function(){try{var t=localStorage.getItem('opspanel-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}var r=document.documentElement;if(t==='dark')r.classList.add('dark');else r.classList.remove('dark');r.style.colorScheme=t;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className={inter.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
