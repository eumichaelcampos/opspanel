import { Global, Module } from "@nestjs/common";
import { PrismaClient } from "@opspanel/database";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: () => new PrismaService(new PrismaClient()),
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
