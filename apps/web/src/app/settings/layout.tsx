"use client";

import { AppShell } from "@/components/app-shell";
import { SettingsSubNav } from "@/components/settings-sub-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell title="Conta">
      <SettingsSubNav />
      {children}
    </AppShell>
  );
}
