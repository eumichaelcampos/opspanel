import { Suspense } from "react";
import ServerDetailPageInner from "./server-detail-inner";

export default function ServerDetailPage() {
  return (
    <Suspense fallback={<p className="p-6 text-muted">Carregando...</p>}>
      <ServerDetailPageInner />
    </Suspense>
  );
}
