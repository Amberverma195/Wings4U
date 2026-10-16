import type { Prisma } from "@prisma/client";

/** Stable preference shared by admin customer and support views. */
export const primaryIdentityOrder = [
  { isPrimary: "desc" }, { isVerified: "desc" }, { createdAt: "asc" }, { id: "asc" },
] satisfies Prisma.UserIdentityOrderByWithRelationInput[];

export function primaryContacts(identities: Array<{ phoneE164: string | null; emailNormalized: string | null }>) {
  return {
    primary_phone: identities.find(identity => identity.phoneE164)?.phoneE164 ?? null,
    primary_email: identities.find(identity => identity.emailNormalized)?.emailNormalized ?? null,
  };
}
