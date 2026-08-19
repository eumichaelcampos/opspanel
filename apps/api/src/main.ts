import "reflect-metadata";
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), "../../.env"), override: true });

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyWebsocket from "@fastify/websocket";
import helmet from "@fastify/helmet";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { loadEnv } from "@opspanel/config";
import { createLogger } from "@opspanel/observability";
import { AppModule } from "./app.module";
import { TerminalService } from "./terminal/terminal.service";

async function bootstrap() {
  const env = loadEnv();
  const logger = createLogger("api");

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  await app.register(helmet);
  // Tráfego do browser passa pelo rewrite do Next (:3000 → :3001) como 127.0.0.1;
  // sem allowList, todo o painel compartilha um único bucket de 120 req/min.
  await app.register(fastifyRateLimit, {
    max: 1000,
    timeWindow: "1 minute",
    allowList: ["127.0.0.1", "::1", "::ffff:127.0.0.1"],
  });
  await app.register(fastifyCors, {
    origin: env.WEB_URL,
    credentials: true,
  });
  await app.register(fastifyCookie, {
    secret: env.SESSION_SECRET,
  });
  await app.register(fastifyMultipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  });
  await app.register(fastifyWebsocket);

  app.setGlobalPrefix("api/v1");

  await app.init();

  const fastify = app.getHttpAdapter().getInstance();
  const terminalService = app.get(TerminalService);
  fastify.get("/api/v1/servers/:serverId/terminal", { websocket: true }, (socket, req) => {
    terminalService.handleConnection(socket, req);
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle("OpsPanel API")
    .setVersion("1.0")
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  if (env.NODE_ENV !== "production") {
    SwaggerModule.setup("api/docs", app, document);
  }

  await app.listen(env.API_PORT, "0.0.0.0");
  logger.info({ port: env.API_PORT }, "API listening");
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
