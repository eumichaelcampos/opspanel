import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "OpsPanel — Control plane WordOps para agências e hosts",
  description:
    "Site comercial do OpsPanel: plataforma self-hosted para gerenciar servidores Linux com WordOps, sites, SSL, monitoramento e IA.",
  openGraph: {
    title: "OpsPanel — Control plane WordOps",
    description:
      "Gerencie servidores WordOps em escala. Self-hosted, open source, com assistente de instalação e integração MCP.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={inter.variable}>{children}</body>
    </html>
  );
}
