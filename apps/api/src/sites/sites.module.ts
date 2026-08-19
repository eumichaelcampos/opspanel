import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";

import { AuthModule } from "../auth/auth.module";

import { JobsModule } from "../jobs/jobs.module";

import { ServersModule } from "../servers/servers.module";

import { SitesController } from "./sites.controller";

import { SiteFilesController } from "./site-files.controller";

import { SiteFilesService } from "./site-files.service";
import { SitesService } from "./sites.service";
import { GoogleDriveModule } from "../google-drive/google-drive.module";



@Module({

  imports: [AuthModule, AuditModule, JobsModule, ServersModule, GoogleDriveModule],

  controllers: [SitesController, SiteFilesController],

  providers: [SitesService, SiteFilesService],
  exports: [SitesService],
})
export class SitesModule {}
