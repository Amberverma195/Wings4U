import { renderEmail, type OrderEmailDetails, type OrderEmailStatus } from "./order-status-email.service";
import { renderBrandedEmail } from "./email-brand-template";
import { renderStampGrantEmail } from "./stamp-grant-email.service";

const order: OrderEmailDetails = {
  id: "fictional-order", orderNumber: 1061n, customerNameSnapshot: " Jamie & Sam ",
  customerEmailSnapshot: "jamie@example.com",
};

describe("Branded order email templates", () => {
  it.each([
    ["ACCEPTED", "accepted", "Your order is being prepared.", "Thanks for ordering from Wings 4 U! Our kitchen has started preparing your order."],
    ["PICKED_UP", "picked up", "Enjoy your meal! 🍗", "Thank you for choosing Wings 4 U. We hope you enjoy every bite!"],
    ["DELIVERED", "delivered", "Your order has arrived!", "Thanks for inviting Wings 4 U to your table. We hope everything arrived hot, fresh, and delicious."],
    ["CANCELLED", "cancelled", "Order cancelled", "We’re sorry, but Wings 4 U had to cancel your order."],
  ] as Array<[OrderEmailStatus, string, string, string]>)("renders %s with the shared theme and plain text", (status, label, highlight, message) => {
    const email = renderEmail(order, status);
    expect(email.subject).toBe(`Order #1061 ${label} | Wings 4 U`);
    expect(email.text).toContain(`${status === "CANCELLED" ? "Order" : "Your order"} #1061 has been ${label}`);
    expect(email.text).toContain("Jamie & Sam");
    expect(email.html).toContain("Jamie &amp; Sam");
    expect(email.text).toContain(highlight); expect(email.html).toContain(highlight);
    expect(email.text).toContain(message); expect(email.html).toContain(message);
    for (const color of ["#f7f1e9", "#321a12", "#fff4e4", "#fffdf9", "#30251e", "#983315", "#fce9d5"]) {
      expect(email.html).toContain(color);
    }
    expect(email.html).toContain("max-width:560px");
    expect(email.html).toContain('name="viewport"');
    expect(email.html).toContain('role="presentation"');
    expect(email.html).toContain("<!--[if mso]>");
    expect(email.html).toContain("Arial,Helvetica,sans-serif");
    expect(email.html).toContain("See you soon,<br>The Wings 4 U Team ❤️");
    expect(email.text).toContain("See you soon,\nThe Wings 4 U Team ❤️");
    expect(email.html).not.toMatch(/<script|<link|<style|display:flex|display:grid/i);
    expect(email.text).not.toMatch(/<[^>]+>/);
    expect(email.text).not.toContain(order.id); expect(email.html).not.toContain(order.id);
    expect(email.text).not.toMatch(/\d+\s*(minutes|mins)/);
  });

  it("includes the pickup closing", () => {
    const pickup = renderEmail(order, "PICKED_UP");
    expect(pickup.text).toContain("We can't wait to serve you again.");
    expect(pickup.html).toContain("We can&#039;t wait to serve you again.");
  });

  it.each(["CUSTOMER_SELF", "KDS_CANCEL_REQUEST", "SYSTEM", null])("preserves cancellation source %s and escapes the reason", cancellationSource => {
    const cancellationReason = `Kitchen <closed> & "sorry" 'today'`;
    const email = renderEmail({ ...order, cancellationReason, cancellationSource }, "CANCELLED");
    expect(email.text).toContain(cancellationSource === "CUSTOMER_SELF"
      ? "Your cancellation is confirmed." : "We’re sorry, but Wings 4 U had to cancel your order.");
    expect(email.text).toContain(`Reason: ${cancellationReason}`);
    expect(email.html).toContain("Kitchen &lt;closed&gt; &amp; &quot;sorry&quot; &#039;today&#039;");
    expect(email.html).not.toContain("<closed>");
    expect(email.text).not.toMatch(/🍗|🎉|Enjoy your meal|reward|being prepared/);
  });

  it("omits absent cancellation reasons and ignores cancellation metadata on other statuses", () => {
    expect(renderEmail({ ...order, cancellationReason: "  " }, "CANCELLED").html).not.toContain("Reason:");
    expect(renderEmail({ ...order, cancellationReason: "Private reason" }, "ACCEPTED").text).not.toContain("Private reason");
  });

  it("escapes customer names and even malformed runtime order numbers in HTML", () => {
    const email = renderEmail({ ...order, customerNameSnapshot: `<img src=x onerror="bad"> & O'Neil`,
      orderNumber: '<script>bad</script>' as unknown as number }, "ACCEPTED");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;bad&quot;&gt; &amp; O&#039;Neil");
    expect(email.html).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(email.html).not.toContain("<img"); expect(email.html).not.toContain("<script>");
    expect(email.text).toContain(`<img src=x onerror="bad"> & O'Neil`);
  });

  it("provides a friendly fallback for a blank customer name", () => {
    expect(renderEmail({ ...order, customerNameSnapshot: " " }, "ACCEPTED").text).toContain("Hello, fellow wing lover! 🍗");
    expect(renderEmail({ ...order, customerNameSnapshot: " " }, "CANCELLED").text).toMatch(/^Hello,\n/);
  });

  it("escapes all shared layout inputs", () => {
    const value = '<b>"Hello" & \'goodbye\'</b>';
    const html = renderBrandedEmail({ greeting: value, headline: value, highlight: value, paragraphs: [value],
      detail: { label: value, value } });
    expect(html).not.toContain(value);
    expect(html.match(/&lt;b&gt;&quot;Hello&quot; &amp; &#039;goodbye&#039;&lt;\/b&gt;/g)).toHaveLength(6);
  });

  it("preserves the Wings Rewards reference output exactly", () => {
    expect(renderStampGrantEmail("Jamie & Sam", 2, 6, "https://orders.example.com/menu")).toMatchSnapshot();
  });
});
