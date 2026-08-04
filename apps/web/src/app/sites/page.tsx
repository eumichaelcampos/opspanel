import { Suspense } from "react";
import SitesPageInner from "./sites-inner";

export default function SitesPage() {
  return (
    <Suspense fallback={<p className="p-6 text-muted">Carregando...</p>}>
      <SitesPageInner />
    </Suspense>
  );
}
