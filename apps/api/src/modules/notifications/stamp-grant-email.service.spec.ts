import { StampGrantEmailService, renderStampGrantEmail } from "./stamp-grant-email.service";

const GRANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const emailIdentity = (emailNormalized: string | null = "tina@example.com", isVerified = true) => ({
  provider: "EMAIL", isPrimary: false, isVerified, emailNormalized,
});
function fixture() {
  const row: any = { grantId: GRANT, status: "PENDING", payloadJson: null, firstAttemptAt: null, leaseUntil: null, attemptToken: null,
    grant: { customerUserId: "customer", deltaStamps: 2, balanceAfterStamps: 6 } };
  let customer: any = { displayName: '<Tina & "Brown">', identities: [
    { provider: "PHONE_OTP", isPrimary: true, isVerified: true, emailNormalized: null }, emailIdentity(),
  ] };
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
    user: { findFirst: jest.fn(async ({ select }: any) => {
      if (!customer) return null;
      const { where, take } = select.identities;
      return { ...customer, identities: customer.identities.filter((identity: any) =>
        Object.entries(where).every(([key, value]) =>
          key === "emailNormalized" ? identity[key] != null : identity[key] === value),
      ).slice(0, take) };
    }) },
  };
  return { row, prisma, service: new StampGrantEmailService(prisma), customer: (value: any) => { customer = value; } };
}

describe("Stamp grant transactional email", () => {
  const originalFetch = global.fetch;
  const env = { ...process.env };
  beforeEach(() => {
    process.env.RESEND_API_KEY = "test-key"; process.env.RESEND_FROM = "Wings <hello@example.com>";
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ id: "email-one" }) })) as any;
  });
  afterEach(() => { global.fetch = originalFetch; process.env = { ...env }; });

  it("sends strictly informational email with verified nonprimary email, primary phone, escaped name, and grant key", async () => {
    const s = fixture(); const result = await s.service.send(GRANT);
    expect(result.status).toBe("SENT");
    expect(s.prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "customer", role: "CUSTOMER", isActive: true, archivedAt: null },
      select: expect.objectContaining({ identities: expect.objectContaining({ where: { provider: "EMAIL", isVerified: true, emailNormalized: { not: null } } }) }) }));
    const [url, request] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(request.headers["Idempotency-Key"]).toBe(`stamp-grant/${GRANT}`);
    const payload = JSON.parse(request.body);
    expect(payload.to).toEqual(["tina@example.com"]);
    expect(payload.subject).toBe("Wings4U — Bonus Stamps Added to Your Account");

    // HTML assertions
    expect(payload.html).toContain("&lt;Tina &amp; &quot;Brown&quot;&gt;");
    expect(payload.html).not.toContain('<Tina & "Brown">');
    expect(payload.html).toContain("We&#39;ve added 2 bonus stamps to your Wings4U rewards account.");
    expect(payload.html).toContain("Your updated stamp balance: 6 / 16");
    expect(payload.html).toContain("Your rewards account has been updated successfully. No action is required.");
    expect(payload.html).toContain("1544 Dundas St, London, ON N5W 3C1");

    // Verify ABSENCE of Order Now button, ordering links, or promotional language
    expect(payload.html).not.toContain("Order Now");
    expect(payload.html).not.toContain("<a ");
    expect(payload.html).not.toContain("href=");
    expect(payload.html).not.toContain("http://");
    expect(payload.html).not.toContain("https://");
    expect(payload.html).not.toContain("We can't wait to serve you again");

    // Plain text assertions
    expect(payload.text).toContain("Hello, <Tina & \"Brown\">!");
    expect(payload.text).toContain("We've added 2 bonus stamps to your Wings4U rewards account.");
    expect(payload.text).toContain("Your updated stamp balance: 6 / 16");
    expect(payload.text).toContain("Your rewards account has been updated successfully. No action is required.");
    expect(payload.text).toContain("Thank you,\nThe Wings4U Team ❤️\n\nWings 4 U\n1544 Dundas St, London, ON N5W 3C1");
    expect(payload.text).not.toContain("Order Now");
    expect(payload.text).not.toContain("http://");
    expect(payload.text).not.toContain("https://");
    expect(payload.text).not.toContain(GRANT);
    expect(payload.html).not.toContain("customer");

    expect(s.row.sentAt).toBeInstanceOf(Date);
    expect(s.row.providerEmailId).toBe("email-one");
    await s.service.send(GRANT);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([null, { displayName: "Tina", identities: [] },
    { displayName: "Tina", identities: [emailIdentity("tina@example.com", false)] },
    { displayName: "Tina", identities: [emailIdentity(null)] },
    { displayName: "Tina", identities: [{ ...emailIdentity(), provider: "PHONE_OTP", isPrimary: true }] },
  ])("missing, unverified or non-EMAIL identities skip safely", async customer => {
    const s = fixture(); s.customer(customer);
    expect((await s.service.send(GRANT)).status).toBe("SKIPPED"); expect(global.fetch).not.toHaveBeenCalled();
    expect(s.row.status).toBe("SKIPPED");
  });

  it("uses the current verified email after a contact change before submission", async () => {
    const s = fixture();
    s.customer({ displayName: "Tina", identities: [emailIdentity("current@example.com")] });
    expect((await s.service.send(GRANT)).status).toBe("SENT");
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).to).toEqual(["current@example.com"]);
  });

  it("persists provider failures and reuses the same frozen request on retry", async () => {
    const s = fixture();
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 503 });
    expect((await s.service.send(GRANT)).status).toBe("FAILED");
    expect(s.row.status).toBe("FAILED"); expect(s.row.lastError).toContain("503");
    expect(s.row.sentAt).toBeUndefined();
    const first = (global.fetch as jest.Mock).mock.calls[0][1];
    process.env.RESEND_FROM = "Changed <other@example.com>";
    s.customer({ displayName: "Changed name", identities: [emailIdentity()] });
    expect((await s.service.send(GRANT)).status).toBe("SENT");
    expect((global.fetch as jest.Mock).mock.calls[1][1].body).toBe(first.body);
    expect((global.fetch as jest.Mock).mock.calls[1][1].headers["Idempotency-Key"]).toBe(first.headers["Idempotency-Key"]);
    await s.service.send(GRANT); expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("a network timeout reports uncertainty and an explicit retry uses the same key", async () => {
    const s = fixture(); (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("timeout"));
    expect(await s.service.send(GRANT)).toEqual(expect.objectContaining({ status: "UNKNOWN", retryable: true }));
    expect(s.row.status).toBe("UNKNOWN"); expect(s.row.lastError).toContain("did not confirm");
    expect(s.row.sentAt).toBeUndefined();
    expect((await s.service.send(GRANT)).status).toBe("SENT");
    const requests = (global.fetch as jest.Mock).mock.calls.map(call => call[1]);
    expect(requests[1].headers["Idempotency-Key"]).toBe(requests[0].headers["Idempotency-Key"]);
    expect(requests[1].body).toBe(requests[0].body);
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
    s.customer({ displayName: "Tina", identities: [emailIdentity("new@example.com")] });
    expect((await s.service.send(GRANT)).status).toBe("SKIPPED"); expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("stops uncertain retries before the provider idempotency window expires", async () => {
    const s = fixture(); s.row.firstAttemptAt = new Date(Date.now() - 23 * 3600_000);
    expect(await s.service.send(GRANT)).toEqual(expect.objectContaining({ status: "UNKNOWN", retryable: false }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(["RESEND_API_KEY", "RESEND_FROM"])("missing %s is reported honestly and remains retryable", async key => {
    const s = fixture(); delete process.env[key];
    expect(await s.service.send(GRANT)).toEqual(expect.objectContaining({ status: "SKIPPED", retryable: true }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  describe("renderStampGrantEmail template verification", () => {
    it("renders singular bonus stamp correctly without reward notification when below threshold", () => {
      const email = renderStampGrantEmail("Alice", 1, 5);
      expect(email.subject).toBe("Wings4U — Bonus Stamps Added to Your Account");
      expect(email.text).toContain("Hello, Alice!");
      expect(email.text).toContain("We've added 1 bonus stamp to your Wings4U rewards account.");
      expect(email.text).toContain("Your updated stamp balance: 5 / 16");
      expect(email.text).toContain("Your rewards account has been updated successfully. No action is required.");
      expect(email.text).not.toContain("reward threshold");
      expect(email.text).not.toContain("complimentary");
      expect(email.html).toContain("Hello, Alice!");
      expect(email.html).toContain("We&#39;ve added 1 bonus stamp to your Wings4U rewards account.");
      expect(email.html).toContain("Your updated stamp balance: 5 / 16");
      expect(email.html).not.toContain("reward threshold");
    });

    it("renders plural bonus stamps and displays factual reward availability when threshold is reached", () => {
      const email = renderStampGrantEmail("Bob", 3, 8);
      expect(email.text).toContain("Hello, Bob!");
      expect(email.text).toContain("We've added 3 bonus stamps to your Wings4U rewards account.");
      expect(email.text).toContain("Your updated stamp balance: 8 / 16");
      expect(email.text).toContain("You have 1 free pound available. Each reward uses 8 stamps for one individual 1 lb wings item.");
      expect(email.html).toContain("You have 1 free pound available. Each reward uses 8 stamps for one individual 1 lb wings item.");
    });

    it("handles empty or blank customer name gracefully with Customer fallback", () => {
      const email = renderStampGrantEmail("   ", 2, 6);
      expect(email.text).toContain("Hello, Customer!");
      expect(email.html).toContain("Hello, Customer!");
    });

    it("safely escapes HTML characters in customer name", () => {
      const email = renderStampGrantEmail('<script>alert("xss")</script> & O\'Neil', 2, 4);
      expect(email.html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; O&#39;Neil");
      expect(email.html).not.toContain("<script>");
      expect(email.text).toContain('<script>alert("xss")</script> & O\'Neil');
    });

    it("strictly excludes Order Now button, ordering links, and promotional sales wording from both formats", () => {
      const emailBelow = renderStampGrantEmail("Carol", 2, 4);
      const emailAbove = renderStampGrantEmail("Carol", 2, 8);

      for (const email of [emailBelow, emailAbove]) {
        // No Order Now button or links
        expect(email.html).not.toContain("Order Now");
        expect(email.text).not.toContain("Order Now");
        expect(email.html).not.toContain("<a ");
        expect(email.html).not.toContain("href=");
        expect(email.html).not.toContain("http://");
        expect(email.html).not.toContain("https://");
        expect(email.text).not.toContain("http://");
        expect(email.text).not.toContain("https://");

        // No promotional wording
        expect(email.html).not.toContain("We can't wait to serve you again");
        expect(email.text).not.toContain("We can't wait to serve you again");
        expect(email.html).not.toContain("unlock");
        expect(email.text).not.toContain("unlock");
        expect(email.html).not.toContain("Every stamp brings you closer");
        expect(email.text).not.toContain("Every stamp brings you closer");
        expect(email.html).not.toContain("next eligible order");
        expect(email.text).not.toContain("next eligible order");
        expect(email.html).not.toContain("fellow wing lover");
        expect(email.text).not.toContain("fellow wing lover");
        expect(email.subject).not.toContain("🍗");
        expect(email.subject).not.toContain("extra for you");

        // Physical address present in both
        expect(email.html).toContain("1544 Dundas St, London, ON N5W 3C1");
        expect(email.text).toContain("1544 Dundas St, London, ON N5W 3C1");
      }
    });
  });
});


describe('saved rewards email wording', () => {
  it.each([7, 8, 9, 15, 16])('reports %i/16 and counts rewards in both formats', balance => {
    const email = renderStampGrantEmail('Customer', 1, balance);
    for (const body of [email.text, email.html]) {
      expect(body).toContain(balance + ' / 16');
      if (balance >= 8) {
        expect(body).toContain(balance === 16 ? '2 free pounds available' : '1 free pound available');
        expect(body).toContain('Each reward uses 8 stamps');
        expect(body).toContain('One reward per order.');
      } else expect(body).not.toContain('free pound');
    }
  });
});
