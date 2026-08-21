import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { JobsModule } from "../jobs/jobs.module";
import { WordpressController } from "./wordpress.controller";
import { WordpressService } from "./wordpress.service";

@Module({
  imports: [AuthModule, JobsModule],
  controllers: [WordpressController],
  providers: [WordpressService],
  exports: [WordpressService],
})
export class WordpressModule {}
