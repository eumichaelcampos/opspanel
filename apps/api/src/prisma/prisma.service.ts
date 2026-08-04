import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@opspanel/database";

@Injectable()
export class PrismaService implements OnModuleDestroy {
  constructor(public readonly client: PrismaClient) {}

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
