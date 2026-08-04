import { prisma, Prisma } from "@opspanel/database";
import type { OnboardingSnapshot, OnboardingStepId, ServerOnboardingContext } from "@opspanel/contracts";
import { isStepDone } from "@opspanel/contracts";

export async function mergeOnboardingStep(serverId: string, stepId: OnboardingStepId) {
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  const prev = (server?.onboardingSnapshot as OnboardingSnapshot | null) ?? {};
  const completed = new Set(prev.completedSteps ?? []);
  completed.add(stepId);
  const nextSnapshot: OnboardingSnapshot = {
    ...prev,
    completedSteps: [...completed],
    lastStepId: stepId,
  };

  await prisma.server.update({
    where: { id: serverId },
    data: { onboardingSnapshot: nextSnapshot as Prisma.InputJsonValue },
  });

  await maybeMarkOnboardingComplete(serverId);
}

async function maybeMarkOnboardingComplete(serverId: string) {
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  if (!server || server.onboardingCompletedAt) return;

  const health = server.healthSnapshot as { stackComponents?: ServerOnboardingContext["stackComponents"] } | null;
  const ctx: ServerOnboardingContext = {
    credentialConfigured: true,
    status: server.status,
    lastConnectedAt: server.lastConnectedAt?.toISOString() ?? null,
    wordopsVersion: server.wordopsVersion,
    lastSyncedAt: server.lastSyncedAt?.toISOString() ?? null,
    siteCount: await prisma.site.count({ where: { serverId, deletedAt: null } }),
    stackComponents: health?.stackComponents,
    onboardingSnapshot: server.onboardingSnapshot as OnboardingSnapshot | null,
    onboardingCompletedAt: null,
  };

  if (isStepDone(ctx, "ready")) {
    await prisma.server.update({
      where: { id: serverId },
      data: { onboardingCompletedAt: new Date() },
    });
  }
}

export async function saveWordOpsDashboard(
  serverId: string,
  dashboard: { url?: string; username?: string; password?: string; capturedAt: string },
) {
  const server = await prisma.server.findUnique({ where: { id: serverId } });
  const prev = (server?.wordopsDashboard as Record<string, unknown> | null) ?? {};
  await prisma.server.update({
    where: { id: serverId },
    data: {
      wordopsDashboard: {
        ...prev,
        ...dashboard,
      } as Prisma.InputJsonValue,
    },
  });
}
