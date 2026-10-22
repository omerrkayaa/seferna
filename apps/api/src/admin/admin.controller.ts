import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import {
  adminDisputeListSchema,
  pageSchema,
  adminReportListSchema,
  resolveDisputeSchema,
  resolveReportSchema,
  suspendUserSchema,
  type AdminReportListInput,
  type ResolveDisputeInput,
  type ResolveReportInput,
  type SuspendUserInput,
} from "@nakliye/shared";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import { AuthGuard, CurrentUser, Roles } from "../auth/auth.guard.js";
import type { AccessPayload } from "../auth/auth.service.js";
import { ZodPipe } from "../common/zod.pipe.js";
import { JobsService } from "../jobs/jobs.service.js";
import { AdminService } from "./admin.service.js";
import { MetricsService } from "./metrics.service.js";

const uuid = new ParseUUIDPipe({ version: "4" });
const userSearchSchema = z.object({ q: z.string().max(80).optional(), page: z.coerce.number().int().min(1).default(1) });

/** Y3 şikayet kuyruğu (FR-51) */
@Controller("admin/reports")
@UseGuards(AuthGuard)
@Roles("admin")
export class AdminReportsController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  list(@Query(new ZodPipe(adminReportListSchema)) q: AdminReportListInput) {
    return this.admin.listReports(q);
  }

  @Post(":id/resolve")
  @HttpCode(200)
  resolve(@CurrentUser() user: AccessPayload, @Param("id", uuid) id: string, @Body(new ZodPipe(resolveReportSchema)) body: ResolveReportInput) {
    return this.admin.resolveReport(user.sub, id, body);
  }
}

/** Y5 / FR-53 platform metrikleri */
@Controller("admin/metrics")
@UseGuards(AuthGuard)
@Roles("admin")
export class AdminMetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  get() {
    return this.metrics.metrics();
  }
}

/** İtirazlı işler (BR-32 sonrası): kuyruk ve karar */
@Controller("admin/disputes")
@UseGuards(AuthGuard)
@Roles("admin")
export class AdminDisputesController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@Query(new ZodPipe(adminDisputeListSchema)) q: AdminReportListInput) {
    return this.jobs.listDisputes(q);
  }

  @Post(":id/resolve")
  @HttpCode(200)
  resolve(@CurrentUser() user: AccessPayload, @Param("id", uuid) id: string, @Body(new ZodPipe(resolveDisputeSchema)) body: ResolveDisputeInput) {
    return this.jobs.resolveDispute(user.sub, id, body);
  }
}

/** Y2 kullanıcılar: arama, askıya alma (FR-51) */
@Controller("admin/users")
@UseGuards(AuthGuard)
@Roles("admin")
export class AdminUsersController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  list(@Query(new ZodPipe(userSearchSchema)) q: { q?: string; page: number }) {
    return this.admin.listUsers(q.q, q.page);
  }

  @Post(":id/suspend")
  @HttpCode(200)
  suspend(@CurrentUser() user: AccessPayload, @Param("id", uuid) id: string, @Body(new ZodPipe(suspendUserSchema)) body: SuspendUserInput) {
    return this.admin.suspend(user.sub, id, body.reason);
  }

  @Post(":id/unsuspend")
  @HttpCode(200)
  unsuspend(@CurrentUser() user: AccessPayload, @Param("id", uuid) id: string) {
    return this.admin.unsuspend(user.sub, id);
  }
}

/** NFR-05 yönetici işlem kaydı: kim, ne zaman, hangi kayıt üzerinde ne yaptı (yeniden eskiye) */
@Controller("admin/audit")
@UseGuards(AuthGuard)
@Roles("admin")
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query(new ZodPipe(pageSchema)) q: { page: number }) {
    return this.audit.list(q.page);
  }
}
