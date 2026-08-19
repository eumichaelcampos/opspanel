"use client";

import Link from "next/link";
import { ConnectServerWizard } from "@/components/connect-server-wizard";

export default function SetupServersPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="glass-panel w-full max-w-2xl space-y-6 p-8">
        <div>
          <p className="text-xs uppercase tracking-widest text-accent">Passo final</p>
          <h1 className="text-2xl font-semibold text-ink">Seu primeiro servidor</h1>
          <p className="mt-1 text-sm text-muted">
            O painel já está instalado. Agora conecte a VPS onde ficam (ou vão ficar) os sites.
          </p>
        </div>
        <ConnectServerWizard variant="first-run" />
        <p className="text-center text-xs text-muted">
          Depois você também adiciona servidores em{" "}
          <Link href="/servers/new" className="text-accent hover:underline">
            Servidores
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
