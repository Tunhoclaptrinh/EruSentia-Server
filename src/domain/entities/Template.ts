import { BaseEntity } from './BaseEntity';

export interface TemplateProps {
  id: string;
  authorId: string;
  categoryId: string;
  title: string;
  slug: string;
  description: string;
  contentJson: Record<string, unknown>;
  thumbnailUrl?: string | null;
  version?: string;
  isPublic?: boolean;
  isFeatured?: boolean;
  forksCount?: number;
  viewsCount?: number;
  ratingAvg?: number;
  ratingsCount?: number;
  tags?: string[];
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}

export class Template extends BaseEntity {
  private readonly _authorId: string;
  private _categoryId: string;
  private _title: string;
  private _slug: string;
  private _description: string;
  private _contentJson: Record<string, unknown>;
  private _thumbnailUrl: string | null;
  private _version: string;
  private _isPublic: boolean;
  private _isFeatured: boolean;
  private _forksCount: number;
  private _viewsCount: number;
  private _ratingAvg: number;
  private _ratingsCount: number;
  private _tags: string[];

  constructor(props: TemplateProps) {
    super(props.id, props.createdAt, props.updatedAt, props.deletedAt);
    this.validateTitle(props.title);
    this.validateRating(props.ratingAvg ?? 0);

    this._authorId = props.authorId;
    this._categoryId = props.categoryId;
    this._title = props.title.trim();
    this._slug = props.slug.toLowerCase().trim();
    this._description = props.description.trim();
    this._contentJson = props.contentJson;
    this._thumbnailUrl = props.thumbnailUrl ?? null;
    this._version = props.version ?? '1.0.0';
    this._isPublic = props.isPublic ?? true;
    this._isFeatured = props.isFeatured ?? false;
    this._forksCount = Math.max(0, props.forksCount ?? 0);
    this._viewsCount = Math.max(0, props.viewsCount ?? 0);
    this._ratingAvg = Number((props.ratingAvg ?? 0).toFixed(2));
    this._ratingsCount = Math.max(0, props.ratingsCount ?? 0);
    this._tags = props.tags ?? [];
  }

  // Getters
  public get authorId(): string { return this._authorId; }
  public get categoryId(): string { return this._categoryId; }
  public get title(): string { return this._title; }
  public get slug(): string { return this._slug; }
  public get description(): string { return this._description; }
  public get contentJson(): Record<string, unknown> { return this._contentJson; }
  public get isPublic(): boolean { return this._isPublic; }
  public get forksCount(): number { return this._forksCount; }
  public get viewsCount(): number { return this._viewsCount; }
  public get ratingAvg(): number { return this._ratingAvg; }
  public get ratingsCount(): number { return this._ratingsCount; }
  public get tags(): string[] { return [...this._tags]; }

  // Domain Business Methods
  public publish(): void {
    this._isPublic = true;
    this.touch();
  }

  public unpublish(): void {
    this._isPublic = false;
    this.touch();
  }

  public recordView(): void {
    this._viewsCount += 1;
    this.touch();
  }

  public recordFork(): void {
    this._forksCount += 1;
    this.touch();
  }

  /**
   * Cập nhật điểm rating mới tính toán lại trung bình có trọng số (Incremental Mean)
   */
  public addRating(score: number): void {
    if (score < 1 || score > 5) {
      throw new Error(`Rating score must be between 1 and 5. Received: ${score}`);
    }
    const currentTotal = this._ratingAvg * this._ratingsCount;
    this._ratingsCount += 1;
    this._ratingAvg = Number(((currentTotal + score) / this._ratingsCount).toFixed(2));
    this.touch();
  }

  public updateContent(newContent: Record<string, unknown>, newVersion?: string): void {
    this._contentJson = newContent;
    if (newVersion) {
      this._version = newVersion;
    }
    this.touch();
  }

  private validateTitle(title: string): void {
    if (!title || title.trim().length < 3) {
      throw new Error('Template title must be at least 3 characters long.');
    }
  }

  private validateRating(rating: number): void {
    if (rating < 0 || rating > 5) {
      throw new Error(`Invalid average rating: ${rating}. Must be between 0.0 and 5.0`);
    }
  }
}
