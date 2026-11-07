import { Injectable, Inject, OnModuleDestroy } from "@nestjs/common";
import { createTransport } from "nodemailer";
import type { AppConfig } from "../config";
export const ACCOUNT_EMAIL_CONFIG = Symbol("ACCOUNT_EMAIL_CONFIG");
export type AccountEmailConfig = AppConfig["accountEmail"] &
  Pick<AppConfig["queue"], "smtpHost" | "smtpPort">;
@Injectable()
export class AccountEmailMailer implements OnModuleDestroy {
  private readonly transport;
  private readonly pending = new Set<Promise<void>>();
  private closing = false;
  constructor(
    @Inject(ACCOUNT_EMAIL_CONFIG) private readonly config: AccountEmailConfig,
  ) {
    this.transport = config.enabled
      ? createTransport({
          host: config.smtpHost,
          port: config.smtpPort,
          secure: false,
          ignoreTLS: true,
          connectionTimeout: 3000,
          greetingTimeout: 3000,
          socketTimeout: 5000,
        })
      : null;
  }
  available() {
    return !!this.transport && !this.closing && this.pending.size < 16;
  }
  send(email: string, purpose: "verify" | "reset" | "changed", token?: string) {
    if (!this.available()) return;
    const verify = purpose === "verify",
      changed = purpose === "changed";
    const title = changed
      ? "Mật khẩu đã được đổi / Password changed"
      : verify
        ? "Xác minh email / Verify email"
        : "Đặt lại mật khẩu / Reset password";
    const link = token
      ? this.config.appUrl + "/#account-action=" + purpose + "&token=" + token
      : "";
    const text = changed
      ? "Mật khẩu EruSentia đã được đổi. Các phiên đăng nhập cũ đã được thu hồi. Nếu bạn không thực hiện, hãy liên hệ hỗ trợ.\nYour password was changed and previous sessions were revoked."
      : `${verify ? "Xác nhận địa chỉ email của bạn. Mã có hiệu lực 24 giờ." : "Đặt lại mật khẩu. Mã có hiệu lực 15 phút."}\n${verify ? "Confirm your email address. Expires in 24 hours." : "Reset your password. Expires in 15 minutes."}\n\n${link}\n\nMã một lần / One-time code: ${token}\n\nNếu không yêu cầu, bỏ qua thư này. / If you did not request this, ignore this message.`;
    const html = `<html lang="vi"><meta charset="utf-8"><body style="margin:0;padding:32px 16px;background:#fff8fa;color:#352b32;font:15px/1.7 system-ui,sans-serif"><main style="max-width:560px;margin:auto;background:white;border:1px solid #eedde4;border-radius:18px;padding:32px;font-family:Arial,sans-serif;line-height:1.7"><p style="font-weight:750;font-size:20px;color:#ba1d49">EruSentia</p><h1 style="font-size:25px;line-height:1.4;font-family:Arial,sans-serif">${title}</h1>${changed ? "<p>Mật khẩu đã được đổi và các phiên cũ đã bị thu hồi.</p><p>Your password was changed and previous sessions were revoked.</p>" : `<p>${verify ? "Xác nhận địa chỉ email để hoàn tất thông tin tài khoản." : "Tạo mật khẩu mới cho tài khoản của bạn."}</p><p style="color:#73636b">${verify ? "Confirm the email address for your account." : "Choose a new password for your account."}</p><p><a href="${link}" style="display:inline-block;background:#ba1d49;color:white;text-decoration:none;padding:12px 20px;border-radius:8px">${verify ? "Xác minh email / Verify email" : "Đặt lại mật khẩu / Reset password"}</a></p><p>Hoặc nhập mã trong App / Or enter this code in the App:</p><code style="display:block;overflow-wrap:anywhere;background:#fff0f5;padding:14px;border-radius:8px">${token}</code><p style="color:#73636b">${verify ? "Hiệu lực 24 giờ / Expires in 24 hours" : "Hiệu lực 15 phút / Expires in 15 minutes"}. Chỉ dùng một lần / Single use.</p><p>Nếu không yêu cầu, bạn có thể bỏ qua thư. / If you did not request this, ignore it.</p>`}<hr style="border:0;border-top:1px solid #eedde4"><small>Email thử nghiệm local / Local test email · EruSentia</small></main></body></html>`;
    const operation = (async () => {
      try {
        const info = await this.transport!.sendMail({
          from: "EruSentia <noreply@erusentia.local>",
          to: { address: email, name: "" },
          subject: "EruSentia — " + title,
          text,
          html,
          disableFileAccess: true,
          disableUrlAccess: true,
        });
        if (!info.accepted?.length || info.rejected?.length)
          throw Error("SMTP_NOT_ACCEPTED");
      } catch {
        console.warn("ACCOUNT_EMAIL_DELIVERY_FAILED");
      }
    })();
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation));
  }
  async onModuleDestroy() {
    this.closing = true;
    await Promise.allSettled(this.pending);
    this.transport?.close();
  }
}
