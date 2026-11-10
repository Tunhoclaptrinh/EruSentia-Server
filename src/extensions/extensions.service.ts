import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ExtensionItem } from './extension.types';

@Injectable()
export class ExtensionsService {
  private readonly extensions: ExtensionItem[] = [
    {
      id: 'resource-gateway',
      name: 'Resource Gateway',
      version: 'v1.0.0',
      category: 'plugin',
      description: 'Đường kết nối an toàn cho template gọi API và tải tài nguyên ngoài mà không bị chặn CORS.',
      author: 'EruSentia Core',
      downloads: '5.2k',
      icon: 'api',
      status: 'available',
      isBuiltin: true,
      installable: true,
      payload: {
        type: 'plugin',
        manifest: {
          id: 'resource-gateway',
          name: 'Resource Gateway',
          permissions: ['network', 'relay', 'sandbox-bridge'],
          entrypoint: 'shared/resources/gateway.mjs',
        },
      },
    },
    {
      id: 'cornell-notes',
      name: 'Cornell Note Template',
      version: 'v1.2.0',
      category: 'template',
      description: 'Mẫu ghi chú khoa học chia làm 3 phần: Keywords, Notes, Summary tiện lợi cho việc ghi nhớ.',
      author: 'EduPro',
      downloads: '3.1k',
      icon: 'calendar',
      status: 'available',
      installable: true,
      payload: {
        type: 'template',
        title: 'Cornell Note Template (Installed)',
        desc: 'Mẫu ghi chép Cornell khoa học chia làm 3 cột tiện lợi cho việc ghi nhớ và tự vấn.',
        html: `<div class="eru-template-cornell" style="border:1px solid var(--border-normal); border-radius:var(--radius-md); padding:16px; margin:12px 0; background:var(--bg-editor); font-family:sans-serif;">
  <h3 style="margin-top:0; color:var(--text-primary); border-bottom:2px solid var(--accent); padding-bottom:6px;">📓 Ghi chú Cornell: Chủ đề bài học</h3>
  <div style="display:grid; grid-template-columns:1fr 2fr; gap:16px; margin-top:12px;">
    <div style="border-right:1px solid var(--border-subtle); padding-right:12px;">
      <strong style="font-size:0.85rem; color:var(--accent); display:block; margin-bottom:8px;">CUES / QUESTIONS</strong>
      <p style="font-size:0.8rem; font-weight:600; color:var(--text-primary); margin:6px 0;">- Từ khóa chính?</p>
      <p style="font-size:0.8rem; font-weight:600; color:var(--text-primary); margin:6px 0;">- Câu hỏi tự kiểm tra?</p>
    </div>
    <div>
      <strong style="font-size:0.85rem; color:var(--accent); display:block; margin-bottom:8px;">NOTES (Ghi chép chính)</strong>
      <ul style="font-size:0.8rem; color:var(--text-secondary); margin:0; padding-left:16px; line-height:1.6;">
        <li>Ghi lại các ý chính của bài giảng học phần này.</li>
        <li>Các ví dụ thực tiễn hoặc công thức đi kèm.</li>
      </ul>
    </div>
  </div>
  <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border-subtle); background:var(--bg-app); padding:10px; border-radius:var(--radius-sm);">
    <strong style="font-size:0.85rem; color:var(--accent); display:block; margin-bottom:4px;">SUMMARY (Tóm tắt bài học)</strong>
    <p style="font-size:0.8rem; color:var(--text-muted); margin:0; line-height:1.5;">Tóm tắt ngắn gọn toàn bộ bài học bằng 2-3 câu chính để ôn tập nhanh chóng.</p>
  </div>
</div>`,
        category: 'custom',
      },
    },
    {
      id: 'daily-planner',
      name: 'Daily Planner Template',
      version: 'v1.1.2',
      category: 'template',
      description: 'Tạo nhanh kế hoạch ngày mới chuẩn phương pháp Time Blocking kết hợp To-do list.',
      author: 'EruSentia',
      downloads: '4.2k',
      icon: 'calendar',
      status: 'available',
      installable: true,
      payload: {
        type: 'template',
        title: 'Daily Planner Template (Installed)',
        desc: 'Mẫu lập kế hoạch làm việc hàng ngày kết hợp To-do list và chỉ số theo dõi sức khỏe.',
        html: `<div class="eru-template-planner" style="border:1px solid var(--border-normal); border-radius:var(--radius-md); padding:16px; margin:12px 0; background:var(--bg-editor); font-family:sans-serif;">
  <h3 style="margin-top:0; color:var(--text-primary); border-bottom:2px solid var(--accent); padding-bottom:6px;">📅 Lập kế hoạch ngày</h3>
  <div style="display:grid; grid-template-columns:3fr 2fr; gap:16px; margin-top:12px;">
    <div>
      <strong style="font-size:0.85rem; color:var(--accent); display:block; margin-bottom:8px;">TO-DO LIST (Việc cần làm)</strong>
      <ul style="font-size:0.8rem; color:var(--text-secondary); margin:0; padding-left:16px; line-height:1.6;">
        <li>Nhiệm vụ ưu tiên số 1 trong ngày</li>
        <li>Nhiệm vụ số 2</li>
        <li>Nhiệm vụ số 3</li>
      </ul>
    </div>
    <div style="border-left:1px solid var(--border-subtle); padding-left:12px;">
      <strong style="font-size:0.85rem; color:var(--accent); display:block; margin-bottom:8px;">NOTES & HABITS</strong>
      <p style="font-size:0.8rem; color:var(--text-muted); margin:0;">Uống 2L nước • Tập thể dục 30p • Đọc sách 20 trang</p>
    </div>
  </div>
</div>`,
        category: 'custom',
      },
    },
    {
      id: 'ai-flashcard',
      name: 'AI Flashcard Generator',
      version: 'v1.0.4',
      category: 'plugin',
      description: 'Tự động tạo flashcard ôn tập từ nội dung ghi chú thông qua mô hình AI.',
      author: 'EruSentia AI',
      downloads: '2.4k',
      icon: 'brain',
      status: 'in_development',
      installable: false,
    },
    {
      id: 'marp-slides',
      name: 'Marp Markdown Exporter',
      version: 'v2.1.0',
      category: 'plugin',
      description: 'Xuất tài liệu của bạn thành slide trình chiếu chuyên nghiệp chuẩn Marp.',
      author: 'Marp Community',
      downloads: '1.8k',
      icon: 'presentation',
      status: 'in_development',
      installable: false,
    },
    {
      id: 'sleek-glass',
      name: 'Sleek Glassmorphism Theme',
      version: 'v0.9.5',
      category: 'theme',
      description: 'Giao diện mờ kính sang trọng chuẩn macOS phong cách Liquid Glass.',
      author: 'DesignLab',
      downloads: '850',
      icon: 'palette',
      status: 'in_development',
      installable: false,
    },
  ];

  findAll(query?: { category?: string; search?: string }): ExtensionItem[] {
    let result = [...this.extensions];
    if (query?.category && query.category !== 'all') {
      result = result.filter(item => item.category === query.category);
    }
    if (query?.search && query.search.trim()) {
      const q = query.search.toLowerCase().trim();
      result = result.filter(
        item => item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
      );
    }
    return result;
  }

  findOne(id: string): ExtensionItem {
    const item = this.extensions.find(ext => ext.id === id);
    if (!item) {
      throw new NotFoundException(`Extension with ID '${id}' not found`);
    }
    return item;
  }

  install(id: string): { success: boolean; extension: ExtensionItem; payload?: any } {
    const item = this.findOne(id);
    if (!item.installable) {
      throw new BadRequestException(`Extension '${item.name}' is currently in development and cannot be installed yet.`);
    }
    return {
      success: true,
      extension: item,
      payload: item.payload,
    };
  }

  uninstall(id: string): { success: boolean; extensionId: string } {
    const item = this.findOne(id);
    return {
      success: true,
      extensionId: item.id,
    };
  }
}
