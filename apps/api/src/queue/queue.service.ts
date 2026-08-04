import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { loadEnv } from "@opspanel/config";

export const OPERATIONS_QUEUE = "operations";

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection: Redis;
  readonly operationsQueue: Queue;

  constructor() {
    const env = loadEnv();
    this.connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    this.operationsQueue = new Queue(OPERATIONS_QUEUE, { connection: this.connection });
  }

  async onModuleDestroy() {
    await this.operationsQueue.close();
    await this.connection.quit();
  }
}
