import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser, Roles } from "../auth/auth.guards";
import type { UserIdentity } from "../auth/auth-store";
import { UuidPipe } from "../common/uuid.pipe";
import { RateLimited } from "../service-controls/service-controls";
import { requireTemplateMatch } from "../templates/template-revisions";
import { TemplateCache } from "../cache/template-cache";
import {
  DecideReportDto,
  receipt,
  ReportQueryDto,
  SubmitReportDto,
} from "./contracts";
import { ReportStore } from "./report-store";
@ApiTags("Content reports")
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(
    private readonly store: ReportStore,
    private readonly cache: TemplateCache,
  ) {}
  @Post("templates/:id/reports")
  @HttpCode(202)
  @RateLimited("report")
  @ApiOperation({
    summary:
      "Report a currently public template; duplicate reports of the same revision return the existing receipt",
  })
  async submit(
    @Param("id", UuidPipe) id: string,
    @Body() input: SubmitReportDto,
    @CurrentUser() user: UserIdentity,
  ) {
    return receipt(await this.store.submit(id, input, user));
  }
  @Get("account/reports")
  @ApiOperation({
    summary: "Read your report receipts, without current private content",
  })
  async own(@Query() query: ReportQueryDto, @CurrentUser() user: UserIdentity) {
    const page = await this.store.list(query, user.id);
    return { ...page, data: page.data.map(receipt) };
  }
  @Get("admin/reports")
  @Roles("admin")
  @ApiOperation({ summary: "Paginate reports without loading template HTML" })
  list(@Query() query: ReportQueryDto) {
    return this.store.list(query);
  }
  @Get("admin/reports/:id")
  @Roles("admin")
  @ApiOperation({
    summary: "Read report, current resource and up to 100 audit entries",
  })
  detail(@Param("id", UuidPipe) id: string) {
    return this.store.detail(id);
  }
  @Post("admin/reports/:id/decision")
  @HttpCode(200)
  @Roles("admin")
  @RateLimited("write")
  @ApiHeader({
    name: "If-Match",
    required: true,
    description: "Current template ETag, alongside reportVersion in the body",
  })
  @ApiOperation({
    summary:
      "Decide with a reason; releasing a restriction keeps the template private",
  })
  async decide(
    @Param("id", UuidPipe) id: string,
    @Body() input: DecideReportDto,
    @Headers("if-match") match: string | undefined,
    @CurrentUser() user: UserIdentity,
  ) {
    const tag = requireTemplateMatch(match);
    const templateId = await this.store.templateIdForReport(id);
    const stamp = await this.cache.stamp(templateId);
    const result = await this.store.decide(id, input, tag, user);
    await this.cache.invalidate(templateId, stamp);
    return result;
  }
}
