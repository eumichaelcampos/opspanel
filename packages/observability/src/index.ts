import { randomUUID } from "node:crypto";
import pino from "pino";

export function createLogger(service: string) {
  const isDev = process.env.NODE_ENV !== "production";
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service },
    transport: isDev
      ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        }
      : undefined,
  });
}

export function newRequestId(): string {
  return randomUUID();
}

export type AppLogger = ReturnType<typeof createLogger>;
