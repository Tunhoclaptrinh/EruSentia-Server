import { BadRequestException } from "@nestjs/common";

/** Publisher assertions are not copyright verification; never log matching content. */
export function assertPublicTemplate(content: Record<string, unknown>) {
  if (typeof content.html !== "string" || content.html.length > 980_000)
    throw new BadRequestException(
      "Public HTML allows up to 980000 characters, reserving space for attribution in offline copies",
    );
  const sharing = content.sharing as Record<string, unknown> | undefined;
  if (
    !sharing ||
    !["MIT", "CC-BY-4.0"].includes(String(sharing.license)) ||
    typeof sharing.attribution !== "string" ||
    !sharing.attribution.trim() ||
    sharing.permissionConfirmed !== true
  )
    throw new BadRequestException(
      "Public templates require an explicit license, attribution and permission confirmation in contentJson.sharing",
    );
  const serialized = JSON.stringify(content);
  if (
    /(?:github_pat_[a-z0-9_]{20,}|gh[pousr]_[a-z0-9]{20,}|sk-[a-z0-9_-]{20,}|npg_[a-z0-9]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\/|https?:\/\/[^\s\/<>"']+:[^\s\/<>"']+@)/i.test(
      serialized,
    )
  )
    throw new BadRequestException(
      "Remove credential-like content before publishing; the private draft can still be saved",
    );
}
