import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { UuidPipe } from "../common/uuid.pipe";
import { CurrentUser } from "../auth/auth.guards";
import type { UserIdentity } from "../auth/auth-store";
import { RateLimited } from "../service-controls/service-controls";
import { WorkspacesService } from "./workspaces.service";
import {
  AddResourceDto,
  CreateWorkspaceDto,
  InviteMemberDto,
  UpdateMemberRoleDto,
  UpdateWorkspaceDto,
  WorkspaceMemberItemDto,
  WorkspaceResponseDto,
} from "./dto/workspace.dto";

@ApiTags("Workspaces")
@Controller("workspaces")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: "Requires authentication" })
export class WorkspacesController {
  constructor(private readonly service: WorkspacesService) {}

  @Post()
  @RateLimited("write")
  @ApiOperation({ summary: "Create a new collaborative workspace" })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  @ApiConflictResponse({ description: "Slug already exists" })
  create(
    @Body() body: CreateWorkspaceDto,
    @CurrentUser() user: UserIdentity,
  ): Promise<WorkspaceResponseDto> {
    return this.service.create(body, user);
  }

  @Get()
  @ApiOperation({ summary: "List workspaces the user is a member of" })
  @ApiOkResponse({ type: [WorkspaceResponseDto] })
  list(@CurrentUser() user: UserIdentity): Promise<WorkspaceResponseDto[]> {
    return this.service.list(user);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get workspace details by ID" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  @ApiNotFoundResponse({ description: "Workspace not found" })
  @ApiForbiddenResponse({ description: "Not a member of this workspace" })
  get(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() user: UserIdentity,
  ): Promise<WorkspaceResponseDto> {
    return this.service.get(id, user);
  }

  @Patch(":id")
  @RateLimited("write")
  @ApiOperation({ summary: "Update workspace name and description (Owner only)" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: WorkspaceResponseDto })
  @ApiForbiddenResponse({ description: "Requires Owner role" })
  update(
    @Param("id", UuidPipe) id: string,
    @Body() body: UpdateWorkspaceDto,
    @CurrentUser() user: UserIdentity,
  ): Promise<WorkspaceResponseDto> {
    return this.service.update(id, body, user);
  }

  @Delete(":id")
  @HttpCode(204)
  @RateLimited("write")
  @ApiOperation({ summary: "Soft delete a workspace (Owner only)" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiForbiddenResponse({ description: "Requires Owner role" })
  delete(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() user: UserIdentity,
  ): Promise<void> {
    return this.service.delete(id, user);
  }

  @Get(":id/members")
  @ApiOperation({ summary: "List all members of the workspace" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({ type: [WorkspaceMemberItemDto] })
  listMembers(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() user: UserIdentity,
  ): Promise<WorkspaceMemberItemDto[]> {
    return this.service.listMembers(id, user);
  }

  @Patch(":id/members/:userId")
  @RateLimited("write")
  @ApiOperation({
    summary: "Update member role (Owner only; protected against demoting last owner)",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiParam({ name: "userId", format: "uuid" })
  @ApiConflictResponse({ description: "Cannot demote last remaining owner" })
  updateRole(
    @Param("id", UuidPipe) id: string,
    @Param("userId", UuidPipe) userId: string,
    @Body() body: UpdateMemberRoleDto,
    @CurrentUser() user: UserIdentity,
  ): Promise<void> {
    return this.service.updateMemberRole(id, userId, body, user);
  }

  @Delete(":id/members/:userId")
  @HttpCode(204)
  @RateLimited("write")
  @ApiOperation({
    summary: "Remove member or self-leave (Protected against removing last owner)",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiParam({ name: "userId", format: "uuid" })
  @ApiConflictResponse({ description: "Cannot remove last remaining owner" })
  removeMember(
    @Param("id", UuidPipe) id: string,
    @Param("userId", UuidPipe) userId: string,
    @CurrentUser() user: UserIdentity,
  ): Promise<void> {
    return this.service.removeMember(id, userId, user);
  }

  @Post(":id/invites")
  @RateLimited("write")
  @ApiOperation({ summary: "Generate an invite token (Owner only)" })
  @ApiParam({ name: "id", format: "uuid" })
  createInvite(
    @Param("id", UuidPipe) id: string,
    @Body() body: InviteMemberDto,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.createInvite(id, body, user);
  }

  @Post("invites/:token/accept")
  @ApiOperation({ summary: "Accept a workspace invitation" })
  acceptInvite(
    @Param("token") token: string,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.acceptInvite(token, user);
  }

  @Post(":id/resources")
  @RateLimited("write")
  @ApiOperation({ summary: "Share a template into workspace (Owner or Editor)" })
  @ApiParam({ name: "id", format: "uuid" })
  shareResource(
    @Param("id", UuidPipe) id: string,
    @Body() body: AddResourceDto,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.shareTemplate(id, body, user);
  }

  @Get(":id/resources")
  @ApiOperation({ summary: "List templates shared in workspace" })
  @ApiParam({ name: "id", format: "uuid" })
  listResources(
    @Param("id", UuidPipe) id: string,
    @CurrentUser() user: UserIdentity,
  ) {
    return this.service.listResources(id, user);
  }
}

