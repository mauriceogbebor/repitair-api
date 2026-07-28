import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AccountDeletionRequest } from "../../entities/account-deletion-request.entity";
import { PrivacyRequest } from "../../entities/privacy-request.entity";
import { PrivacyJob } from "../../entities/privacy-job.entity";
import { PrivacyEvent } from "../../entities/privacy-event.entity";
import { User } from "../../entities/user.entity";
import { Repit } from "../../entities/repit.entity";
import { PushToken } from "../../entities/push-token.entity";
import { ContactSubmission } from "../../entities/contact-submission.entity";
import { AdminAuditLog } from "../../entities/admin-audit-log.entity";
import { UploadsModule } from "../uploads/uploads.module";
import { AdminAuditLogsService } from "../admin/audit-logs/admin-audit-logs.service";
import { PrivacyService } from "./privacy.service";
import { PrivacyWorkflowService } from "./privacy-workflow.service";
import { PrivacyExecutionService } from "./privacy-execution.service";
import { PrivacyQueryService } from "./privacy-query.service";
import { PrivacyJobHandlers } from "./privacy-job.handlers";
import { PrivacyIntakeController } from "./privacy-intake.controller";
import { PrivacyExportController } from "./privacy-export.controller";

@Module({
  imports: [
    UploadsModule,
    TypeOrmModule.forFeature([
      AccountDeletionRequest,
      PrivacyRequest,
      PrivacyJob,
      PrivacyEvent,
      User,
      Repit,
      PushToken,
      ContactSubmission,
      AdminAuditLog,
    ]),
  ],
  controllers: [PrivacyIntakeController, PrivacyExportController],
  providers: [
    PrivacyService,
    PrivacyWorkflowService,
    PrivacyExecutionService,
    PrivacyQueryService,
    PrivacyJobHandlers,
    // Own instance of the audit writer to avoid a circular dependency with AdminModule.
    AdminAuditLogsService,
  ],
  exports: [PrivacyService, PrivacyWorkflowService, PrivacyExecutionService, PrivacyQueryService],
})
export class PrivacyModule {}
