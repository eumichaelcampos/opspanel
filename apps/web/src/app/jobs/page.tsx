import { Suspense } from "react";
import JobsPageInner from "./jobs-inner";

export default function JobsPage() {
  return (
    <Suspense fallback={<p className="p-6 text-muted">Carregando...</p>}>
      <JobsPageInner />
    </Suspense>
  );
}
