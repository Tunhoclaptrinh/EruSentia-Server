# 📜 TEMPLATE & BLOCK JSON SCHEMA CONTRACT
> Hợp đồng giao tiếp (API Contract) giữa Server (Sentia Hub) và các Client (EruSentia App, Web, Extension).

---

## 🎯 1. NGUYÊN TẮC: DATA-FIRST, RENDERER-AGNOSTIC

Server lưu trữ template dưới định dạng **JSON tiêu chuẩn** (`templates.content_json`).  
Server không cần biết client sẽ render bằng công nghệ gì (TipTap, ProseMirror, Slate hay Canvas).  
Server chỉ chịu trách nhiệm:
1. Lưu trữ và phân phối template.
2. Kiểm tra tính hợp lệ của schema (Schema Validation).
3. Đếm lượt fork, lượt tải, và tính rating.

---

## 📦 2. CẤU TRÚC JSON SCHEMA CHUẨN

Mỗi template khi gửi lên (`POST /api/v1/templates`) hoặc tải về (`GET /api/v1/templates/:slug`) đều tuân thủ cấu trúc sau:

```json
{
  "schemaVersion": "1.0.0",
  "metadata": {
    "title": "Clean Architecture Backend Blueprint",
    "description": "Standard template for DDD services",
    "author": "alex_architect",
    "category": "software-engineering",
    "tags": ["clean-architecture", "typescript", "backend"],
    "version": "1.0.0"
  },
  "content": {
    "type": "doc",
    "content": [
      {
        "type": "heading",
        "attrs": { "level": 1 },
        "content": [{ "type": "text", "text": "Domain Model Blueprint" }]
      },
      {
        "type": "paragraph",
        "content": [
          { "type": "text", "text": "This template establishes clean boundaries between domain and infrastructure layers." }
        ]
      },
      {
        "type": "codeBlock",
        "attrs": { "language": "typescript" },
        "content": [{ "type": "text", "text": "export class User extends BaseEntity {}" }]
      }
    ]
  }
}
```

---

## 🔒 3. QUY TẮC AN TOÀN TRÊN SERVER (VALIDATION INVARIANTS)

1. **Giới hạn kích thước:** Payload `content_json` không được vượt quá **2MB** cho mỗi template.
2. **Không chứa Script độc hại:** Thuộc tính text không được chứa mã JavaScript thực thi trực tiếp (`<script>` tags, `javascript:` URLs).
3. **Immutability khi Fork:** Khi người dùng fork một template:
   - Server tạo 1 bản sao nội dung.
   - Gán `forks_count = 0`, `views_count = 0`.
   - Lưu lại `original_template_id` vào bảng `forks` để ghi nhận tác giả gốc.
