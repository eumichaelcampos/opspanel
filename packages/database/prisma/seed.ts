import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../src/index.js";
import { hashPassword } from "@opspanel/security";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@localhost";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  const passwordHash = await hashPassword(password);

  const org = await prisma.organization.upsert({
    where: { slug: "default" },
    update: {},
    create: {
      name: "Organização padrão",
      slug: "default",
    },
  });

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: {
      email,
      passwordHash,
      name: "Administrador",
    },
  });

  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: org.id,
        userId: user.id,
      },
    },
    update: { role: "owner" },
    create: {
      organizationId: org.id,
      userId: user.id,
      role: "owner",
    },
  });

  console.log(`Seed OK: org=${org.slug} admin=${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
