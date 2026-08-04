import { Suspense } from "react";
import NewSitePageInner from "./new-site-inner";

export default function NewSitePage() {
  return (
    <Suspense fallback={<p className="p-6 text-muted">Carregando...</p>}>
      <NewSitePageInner />
    </Suspense>
  );
}
