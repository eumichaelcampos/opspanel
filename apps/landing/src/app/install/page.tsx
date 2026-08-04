import { InstallOnboardingWizard } from "@/components/install-onboarding-wizard";

export const metadata = {
  title: "Instalar OpsPanel — Wizard de configuração",
  description:
    "Configure IP, domínio ou subdomínio, gere .env, Nginx/Caddy e comandos de instalação para o OpsPanel.",
};

export default function InstallPage() {
  return <InstallOnboardingWizard />;
}
