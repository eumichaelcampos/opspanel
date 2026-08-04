import { apiUrl } from "./api";

export type JobStreamEvent = {
  sequence: number;
  type: string;
  message: string;
  progress?: number;
};

export function subscribeJobEvents(
  jobId: string,
  handlers: {
    onEvent: (event: JobStreamEvent) => void;
    onDone?: (payload: { status: string; progress?: number; errorMessage?: string | null }) => void;
    onError?: (error: Error) => void;
  },
): () => void {
  const controller = new AbortController();
  let lastEventId = 0;

  void (async () => {
    try {
      const res = await fetch(apiUrl(`/jobs/${jobId}/events`), {
        credentials: "include",
        headers: { Accept: "text/event-stream", "Last-Event-ID": String(lastEventId) },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error("Não foi possível acompanhar o job em tempo real.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          let eventName = "message";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            if (line.startsWith("data:")) data += line.slice(5).trim();
            if (line.startsWith("id:")) lastEventId = Number.parseInt(line.slice(3).trim(), 10) || lastEventId;
          }
          if (!data) continue;
          const parsed = JSON.parse(data) as Record<string, unknown>;
          if (eventName === "job.event") {
            handlers.onEvent(parsed as JobStreamEvent);
          }
          if (eventName === "job.done") {
            handlers.onDone?.({
              status: String(parsed.status),
              progress: typeof parsed.progress === "number" ? parsed.progress : undefined,
              errorMessage: typeof parsed.errorMessage === "string" ? parsed.errorMessage : null,
            });
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        handlers.onError?.(err as Error);
      }
    }
  })();

  return () => controller.abort();
}
