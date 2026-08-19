import { Suspense } from "react";
import AccountSettingsPageInner from "./account-inner";

export default function AccountSettingsPage() {
  return (
    <Suspense fallback={<p className="p-6 text-muted">Carregando...</p>}>
      <AccountSettingsPageInner />
    </Suspense>
  );
}
