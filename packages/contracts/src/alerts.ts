import { z } from "zod";

export const alertChannelTypeSchema = z.enum(["slack", "webhook", "email"]);
export type AlertChannelType = z.infer<typeof alertChannelTypeSchema>;

export const alertChannelCreateSchema = z
  .object({
    name: z.string().min(1).max(80),
    type: alertChannelTypeSchema,
    webhookUrl: z.string().url().max(2048).optional(),
    emailTo: z.string().email().max(256).optional(),
    enabled: z.boolean().optional().default(true),
  })
  .superRefine((data, ctx) => {
    if ((data.type === "slack" || data.type === "webhook") && !data.webhookUrl) {
      ctx.addIssue({ code: "custom", message: "webhookUrl obrigatório para slack/webhook", path: ["webhookUrl"] });
    }
    if (data.type === "email" && !data.emailTo) {
      ctx.addIssue({ code: "custom", message: "emailTo obrigatório para e-mail", path: ["emailTo"] });
    }
  });

export type AlertChannelCreateInput = z.infer<typeof alertChannelCreateSchema>;

export const alertChannelUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  webhookUrl: z.string().url().max(2048).nullable().optional(),
  emailTo: z.string().email().max(256).nullable().optional(),
  enabled: z.boolean().optional(),
});

export type AlertChannelUpdateInput = z.infer<typeof alertChannelUpdateSchema>;

export type AlertChannelDto = {
  id: string;
  name: string;
  type: AlertChannelType;
  webhookUrl?: string | null;
  emailTo?: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AlertEventDto = {
  id: string;
  channelId?: string | null;
  kind: string;
  title: string;
  body?: string | null;
  status: string;
  errorMessage?: string | null;
  createdAt: string;
};

export type AlertsHubResponse = {
  channels: AlertChannelDto[];
  recentEvents: AlertEventDto[];
};

export type AlertNotifyPayload = {
  kind: "job_failed" | "security_critical" | "test";
  title: string;
  body?: string;
  organizationId: string;
  metadata?: Record<string, unknown>;
};
