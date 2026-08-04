import { Suspense } from "react";
import SiteDetailPageInner from "./site-detail-inner";

export default function SiteDetailPage() {
  return (
    <Suspense fallback={<p className="p-6 text-muted">Carregando...</p>}>
      <SiteDetailPageInner />
    </Suspense>
  );
}
