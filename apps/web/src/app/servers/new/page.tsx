"use client";

import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ConnectServerWizard } from "@/components/connect-server-wizard";

export default function NewServerPage() {
  const router = useRouter();
  return (
    <AppShell title="Adicionar servidor">
      <div className="mx-auto max-w-2xl">
        <ConnectServerWizard variant="add" onFinished={() => router.push("/servers")} />
      </div>
    </AppShell>
  );
}
