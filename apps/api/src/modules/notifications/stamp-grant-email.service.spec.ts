import { StampGrantEmailService, renderStampGrantEmail, stampOrderUrl } from "./stamp-grant-email.service";

const GRANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function fixture() {
  const row: any = { grantId: GRANT, status: "PENDING", payloadJson: null, firstAttemptAt: null, leaseUntil: null, attemptToken: null,
    grant: { customerUserId: "customer", deltaStamps: 2, balanceAfterStamps: 6 } };
  let customer: any = { displayName: '<Tina & "Brown">', identities: [{ emailNormalized: "tina@example.com" }] };
  const prisma: any = {
    wingsStampGrantEmail: {
      findUniqueOrThrow: jest.fn(async () => structuredClone(row)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.status && row.status === where.status.not) return { count: 0 };
        if (where.OR && row.leaseUntil && row.leaseUntil >= where.OR[1].leaseUntil.lt) return { count: 0 };
        if (where.attemptToken && row.attemptToken !== where.attemptToken) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      }),
    },
    user: { findFirst: jest.fn(async () => customer) },
  };
  return { row, prisma, service: new StampGrantEmailService(prisma), customer: (value: any) => { customer = value; } };
}

describe("Stamp grant transactional email", () => {
  const originalFetch = global.fetch;
  const env = { ...process.env };
  beforeEach(() => {
    process.env.RESEND_API_KEY = "test-key"; process.env.RESEND_FROM = "Wings <hello@example.com>";
    process.env.PUBLIC_SITE_URL = "https://orders.example.com";
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ id: "email-one" }) })) as any;
  });
  afterEach(() => { global.fetch = originalFetch; process.env = { ...env }; });

  it("uses only the current verified primary email, escaped name, public ordering URL and grant-specific key", async () => {
    const s = fixture(); const result = await s.service.send(GRANT);
    expect(result.status).toBe("SENT");
    expect(s.prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "customer", role: "CUSTOMER", isActive: true, archivedAt: null },
      select: expect.objectContaining({ identities: expect.objectContaining({ where: { isPrimary: true, isVerified: true, emailNormalized: { not: null } } }) }) }));
    const [url, request] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(request.headers["Idempotency-Key"]).toBe(`stamp-grant/${GRANT}`);
    const payload = JSON.parse(request.body);
    expect(payload.to).toEqual(["tina@example.com"]);
    expect(payload.html).toContain("&lt;Tina &amp; &quot;Brown&quot;&gt;"); expect(payload.html).not.toContain('<Tina & "Brown">');
    expect(payload.html).toContain('href="https://orders.example.com/menu"');
    expect(payload.text).toContain("2 bonus stamps"); expect(payload.text).toContain("6 out of 8");
    expect(payload.text).not.toContain(GRANT); expect(payload.html).not.toContain("customer");
    expect(s.row.sentAt).toBeInstanceOf(Date); expect(s.row.providerEmailId).toBe("email-one");
    await s.service.send(GRANT); expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([null, { displayName: "Tina", identities: [] }])("missing or unverified primary email skips safely", async customer => {
    const s = fixture(); s.customer(customer);
    expect((await s.service.send(GRANT)).status).toBe("SKIPPED"); expect(global.fetch).not.toHaveBeenCalled();
    expect(s.row.status).toBe("SKIPPED");
  });
  it("persists provider failures and reuses the same frozen request on retry", async () => {
    const s = fixture();
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503 });
    expect((await s.service.send(GRANT)).status).toBe("FAILED");
    const first = (global.fetch as jest.Mock).mock.calls[0][1];
    process.env.RESEND_FROM = "Changed <other@example.com>";
    s.customer({ displayName: "Changed name", identities: [{ emailNormalized: "tina@example.com" }] });
    expect((await s.service.send(GRANT)).status).toBe("SENT");
    expect((global.fetch as jest.Mock).mock.calls[1][1].body).toBe(first.body);
    expect((global.fetch as jest.Mock).mock.calls[1][1].headers["Idempotency-Key"]).toBe(first.headers["Idempotency-Key"]);
    await s.service.send(GRANT); expect(global.fetch).toHaveBeenCalledTimes(2);
  });
  it("a network timeout reports uncertainty and an explicit retry uses the same key", async () => {
    const s = fixture(); (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("timeout"));
    expect(await s.service.send(GRANT)).toEqual(expect.objectContaining({ status: "UNKNOWN", retryable: true }));
    expect((await s.service.send(GRANT)).status).toBe("SENT");
  });
  it("parallel workers use one delivery lease", async () => {
    const s = fixture(); await Promise.all([s.service.send(GRANT), s.service.send(GRANT)]);
    expect(global.fetch).toHaveBeenCalledTimes(1); expect(s.row.status).toBe("SENT");
  });
  it("an expired lease can resume the persisted payload after an API crash", async () => {
    const s = fixture(); s.row.leaseUntil = new Date(Date.now() - 1000); s.row.attemptToken = "old-worker";
    expect((await s.service.send(GRANT)).status).toBe("SENT"); expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  it("does not send to a formerly verified email after the contact changes", async () => {
    const s = fixture(); (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("timeout"));
    await s.service.send(GRANT);
    s.customer({ displayName: "Tina", identities: [{ emailNormalized: "new@example.com" }] });
    expect((await s.service.send(GRANT)).status).toBe("SKIPPED"); expect(global.fetch).toHaveBeenCalledTimes(1);
  });
  it("stops uncertain retries before the provider idempotency window expires", async () => {
    const s = fixture(); s.row.firstAttemptAt = new Date(Date.now() - 23 * 3600_000);
    expect(await s.service.send(GRANT)).toEqual(expect.objectContaining({ status: "UNKNOWN", retryable: false }));
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it.each(["RESEND_API_KEY", "RESEND_FROM", "PUBLIC_SITE_URL"])("missing %s is reported honestly and remains retryable", async key => {
    const s = fixture(); delete process.env[key]; delete process.env.NEXT_PUBLIC_SITE_URL;
    expect(await s.service.send(GRANT)).toEqual(expect.objectContaining({ status: "SKIPPED", retryable: true }));
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it.each(["http://orders.example.com", "https://localhost", "https://127.0.0.1", "https://10.0.0.1", "https://user:pass@example.com", "https://example.com/?redirect=https://evil.com", "https://example.com/path", "https://example.com/#redirect"])("rejects unsafe CTA configuration %s", value => {
    process.env.PUBLIC_SITE_URL = value; expect(() => stampOrderUrl()).toThrow();
  });
  it("uses configured canonical NEXT_PUBLIC_SITE_URL when the API-specific value is absent", () => {
    delete process.env.PUBLIC_SITE_URL; process.env.NEXT_PUBLIC_SITE_URL = "https://canonical.example.com/";
    expect(stampOrderUrl()).toBe("https://canonical.example.com/menu");
  });
  it("renders singular/plural grants and a reward-ready full card without internal metadata", () => {
    expect(renderStampGrantEmail("Tina", 1, 7, "https://example.com/menu").text).toContain("1 bonus stamp to");
    const full = renderStampGrantEmail("", 2, 8, "https://example.com/menu");
    expect(full.text).toContain("2 bonus stamps"); expect(full.text).toContain("Hello, fellow wing lover! 🍗");
    expect(full.text).toContain("Your stamp card is full! 🎉"); expect(full.text).toContain("next eligible order");
  });
});
