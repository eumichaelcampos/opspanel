"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { SetupRedirect } from "@/components/setup-redirect";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <SetupRedirect>{children}</SetupRedirect>
    </QueryClientProvider>
  );
}
