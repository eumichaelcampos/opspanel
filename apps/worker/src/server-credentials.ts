import { loadEnv } from "@opspanel/config";
import { prisma } from "@opspanel/database";
import { decryptJson, EncryptedPayload } from "@opspanel/security";
import { SshTarget } from "./ssh-executor.js";

export async function loadSshTargetForServer(serverId: string): Promise<SshTarget & { server: { organizationId: string; host: string; port: number } }> {
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    include: { credential: true },
  });
  if (!server?.credential) {
    throw new Error("Server credential missing");
  }

  const env = loadEnv();
  const payload: EncryptedPayload = {
    ciphertext: server.credential.ciphertext,
    iv: server.credential.iv,
    authTag: server.credential.authTag,
    keyVersion: server.credential.keyVersion,
  };
  const cred = decryptJson<{
    type: string;
    username: string;
    privateKey?: string;
    password?: string;
  }>(payload, env.CREDENTIALS_ENCRYPTION_KEY);

  return {
    server: { organizationId: server.organizationId, host: server.host, port: server.port },
    host: server.host,
    port: server.port,
    username: cred.username,
    privateKey: cred.type === "ssh_private_key" ? cred.privateKey : undefined,
    password: cred.type === "ssh_password" ? cred.password : undefined,
  };
}
