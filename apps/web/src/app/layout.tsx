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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={inter.variable}><Providers>{children}</Providers></body>
    </html>
  );
}
