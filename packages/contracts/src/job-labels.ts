/** Labels amigáveis para operationKey (UI e dashboard). */
const LABELS: Record<string, string> = {
  "server.connection.test": "Testar conexão SSH",
  "server.inventory.sync": "Sincronizar inventário",
  "server.health.collect": "Coletar saúde do servidor",
  "server.stack.action": "Ação no stack",
  "server.maintenance.run": "Manutenção do servidor",
  "server.system.update": "Atualizar sistema",
  "server.metrics.collect": "Coletar métricas",
  "server.wordops.install": "Instalar WordOps",
  "server.wordops.dashboard.recover": "Recuperar dashboard WordOps",
  "server.stack.migrate": "Migrar stack",
  "server.ufw.configure": "Configurar UFW",
  "server.delete": "Excluir servidor",
  "server.reboot": "Reiniciar servidor",
  "server.stack.restart": "Reiniciar stack",
  "site.info": "Atualizar info do site",
  "site.create": "Criar site",
  "site.manage": "Gerenciar site",
  "site.backup": "Backup do site",
  "site.restore": "Restaurar backup",
  "site.delete": "Excluir site",
  "site.update.domain": "Alterar domínio",
  "site.ftp.user.create": "Criar usuário FTP",
  "site.ftp.user.delete": "Excluir usuário FTP",
  "site.migrate.ftp": "Migrar site via FTP",
  "site.email.domain.provision": "Ativar e-mail do domínio",
  "site.email.dns.publish": "Publicar DNS de e-mail",
  "site.email.mailbox.create": "Criar caixa de e-mail",
  "site.email.mailbox.delete": "Excluir caixa de e-mail",
  "site.email.health.check": "Verificar saúde do e-mail",
};

export function jobOperationLabel(operationKey: string): string {
  return LABELS[operationKey] ?? operationKey;
}
