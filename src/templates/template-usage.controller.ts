import { Controller, Get, Header, Inject } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/auth.guards";
import type { UserIdentity } from "../auth/auth-store";
import {
  SERVICE_CONTROL_SETTINGS,
  ServiceControlSettings,
} from "../service-controls/settings";
import { retainedLimits } from "./template-quota";
import { TEMPLATE_STORE, TemplateStore } from "./template-store";
class UsageValuesDto {
  @ApiProperty({ minimum: 0 }) templates!: number;
  @ApiProperty({
    minimum: 0,
    description:
      "Server-accounted UTF-8 JSON bytes for active templates; not disk usage or vault size",
  })
  contentBytes!: number;
}
class RetainedValuesDto extends UsageValuesDto {
  @ApiProperty({ minimum: 0 }) revisions!: number;
}
class RetainedBudgetDto {
  @ApiProperty({ type: RetainedValuesDto }) used!: RetainedValuesDto;
  @ApiProperty({ type: RetainedValuesDto }) limits!: RetainedValuesDto;
  @ApiProperty({ type: RetainedValuesDto }) remaining!: RetainedValuesDto;
}
class AccountUsageDto {
  @ApiProperty({ type: RetainedBudgetDto }) retained!: RetainedBudgetDto;
  @ApiProperty({ type: UsageValuesDto }) used!: UsageValuesDto;
  @ApiProperty({ type: UsageValuesDto }) limits!: UsageValuesDto;
  @ApiProperty({ type: UsageValuesDto }) remaining!: UsageValuesDto;
}
@ApiTags("Account usage")
@ApiBearerAuth()
@Controller("account")
export class TemplateUsageController {
  constructor(
    @Inject(TEMPLATE_STORE) private readonly store: TemplateStore,
    @Inject(SERVICE_CONTROL_SETTINGS)
    private readonly settings: ServiceControlSettings,
  ) {}
  @Get("usage")
  @Header("Cache-Control", "no-store")
  @ApiOkResponse({ type: AccountUsageDto })
  async usage(@CurrentUser() user: UserIdentity) {
    const used = await this.store.usage(user.id),
      limits = {
        templates: this.settings.maxTemplates,
        contentBytes: this.settings.maxContentBytes,
      };
    const retainedUsed = await this.store.retainedUsage(user.id),
      retainedBudget = retainedLimits(this.settings);
    return {
      retained: {
        used: retainedUsed,
        limits: retainedBudget,
        remaining: {
          templates: Math.max(
            0,
            retainedBudget.templates - retainedUsed.templates,
          ),
          revisions: Math.max(
            0,
            retainedBudget.revisions - retainedUsed.revisions,
          ),
          contentBytes: Math.max(
            0,
            retainedBudget.contentBytes - retainedUsed.contentBytes,
          ),
        },
      },
      used,
      limits,
      remaining: {
        templates: Math.max(0, limits.templates - used.templates),
        contentBytes: Math.max(0, limits.contentBytes - used.contentBytes),
      },
    };
  }
}
