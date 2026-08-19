import { Suspense } from "react";
import MigrateSitePageInner from "./migrate-site-inner";

export default function MigrateSitePage() {
  return (
    <Suspense fallback={<p className="p-6 text-muted">Carregando...</p>}>
      <MigrateSitePageInner />
    </Suspense>
  );
}
