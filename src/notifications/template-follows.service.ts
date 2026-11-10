import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { TEMPLATE_STORE, TemplateStore } from "../templates/template-store";
import type { UserIdentity } from "../auth/auth-store";
import { FollowStatusDto } from "./dto/notifications.dto";

@Injectable()
export class TemplateFollowsService {
  constructor(
    @Inject(TEMPLATE_STORE) private readonly templates: TemplateStore,
    @Optional() private readonly db?: DataSource,
  ) {}

  async follow(templateId: string, user: UserIdentity): Promise<FollowStatusDto> {
    const template = await this.templates.find(templateId);
    if (!template) throw new NotFoundException("Template not found");
    if (template.authorId === user.id) {
      throw new BadRequestException("You cannot follow your own template");
    }
    if (!template.isPublic && user.role !== "admin") {
      throw new NotFoundException("Template not found");
    }

    if (this.db) {
      await this.db.query(
        "INSERT INTO template_follows (user_id, template_id) VALUES ($1, $2) ON CONFLICT (user_id, template_id) DO NOTHING",
        [user.id, templateId],
      );
    }
    return this.getStatus(templateId, user);
  }

  async unfollow(templateId: string, user: UserIdentity): Promise<FollowStatusDto> {
    const template = await this.templates.find(templateId);
    if (!template) throw new NotFoundException("Template not found");

    if (this.db) {
      await this.db.query(
        "DELETE FROM template_follows WHERE user_id = $1 AND template_id = $2",
        [user.id, templateId],
      );
    }
    return this.getStatus(templateId, user);
  }

  async getStatus(templateId: string, user?: UserIdentity): Promise<FollowStatusDto> {
    if (!this.db) {
      return { isFollowing: false, followerCount: 0 };
    }
    const countRes = await this.db.query<{ count: string }[]>(
      "SELECT count(*)::int AS count FROM template_follows WHERE template_id = $1",
      [templateId],
    );
    const followerCount = countRes[0] ? Number(countRes[0].count) : 0;

    let isFollowing = false;
    if (user) {
      const followRes = await this.db.query(
        "SELECT 1 FROM template_follows WHERE template_id = $1 AND user_id = $2",
        [templateId, user.id],
      );
      isFollowing = followRes.length > 0;
    }

    return { isFollowing, followerCount };
  }
}
