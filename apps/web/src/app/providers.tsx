"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { SetupRedirect } from "@/components/setup-redirect";
import { ThemeProvider } from "@/components/theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              const msg = error instanceof Error ? error.message : "";
              if (msg.includes("Sessão inválida")) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <SetupRedirect>{children}</SetupRedirect>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
