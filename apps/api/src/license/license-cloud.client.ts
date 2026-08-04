import { loadEnv } from "@opspanel/config";
import type { Entitlements } from "@opspanel/licensing";

export type CloudLicenseResponse = {
  plan: string;
  status: string;
  entitlements: Entitlements;
  entitlementsJwt: string;
  validUntil: string;
  billing?: {
    enabled: boolean;
    subscriptionStatus: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    managedByStripe: boolean;
  };
};

export type BillingPlan = {
  id: string;
  name: string;
  description: string;
  priceMonthly: number | null;
  currency: string;
  features: string[];
  upgradable: boolean;
};

export type HeartbeatMetrics = {
  servers: number;
  sites: number;
  jobs_month: number;
  api_keys: number;
  members: number;
  ai_calls: number;
};

export class LicenseCloudClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  static fromEnv(): LicenseCloudClient | null {
    const env = loadEnv();
    if (!env.LICENSE_SERVER_URL) return null;
    return new LicenseCloudClient(env.LICENSE_SERVER_URL);
  }

  async activate(params: {
    licenseKey: string;
    instanceId: string;
    version?: string;
    hostname?: string;
  }): Promise<CloudLicenseResponse> {
    const res = await fetch(`${this.baseUrl}/v1/licenses/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(body.error?.message ?? `License activate failed (${res.status})`);
    }
    return res.json() as Promise<CloudLicenseResponse>;
  }

  async heartbeat(params: {
    licenseKey: string;
    instanceId: string;
    period: string;
    metrics: HeartbeatMetrics;
    version?: string;
    hostname?: string;
  }): Promise<CloudLicenseResponse> {
    const res = await fetch(`${this.baseUrl}/v1/licenses/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(body.error?.message ?? `License heartbeat failed (${res.status})`);
    }
    return res.json() as Promise<CloudLicenseResponse>;
  }

  async getBillingPlans(): Promise<{ enabled: boolean; plans: BillingPlan[] }> {
    const res = await fetch(`${this.baseUrl}/v1/billing/plans`);
    if (!res.ok) throw new Error(`Billing plans failed (${res.status})`);
    return res.json() as Promise<{ enabled: boolean; plans: BillingPlan[] }>;
  }

  async createCheckout(params: {
    licenseKey: string;
    plan: "pro" | "business";
    successUrl?: string;
    cancelUrl?: string;
    email?: string;
  }): Promise<{ url: string }> {
    const res = await fetch(`${this.baseUrl}/v1/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(body.error?.message ?? `Checkout failed (${res.status})`);
    }
    return res.json() as Promise<{ url: string }>;
  }

  async createPortal(params: { licenseKey: string; returnUrl?: string }): Promise<{ url: string }> {
    const res = await fetch(`${this.baseUrl}/v1/billing/portal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(body.error?.message ?? `Portal failed (${res.status})`);
    }
    return res.json() as Promise<{ url: string }>;
  }
}
