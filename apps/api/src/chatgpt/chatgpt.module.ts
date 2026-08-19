import { Module } from "@nestjs/common";
import { ChatGptController } from "./chatgpt.controller";

@Module({
  controllers: [ChatGptController],
})
export class ChatGptModule {}
