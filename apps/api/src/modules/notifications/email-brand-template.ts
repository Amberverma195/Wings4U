/** Escape every content value at the layout boundary; callers supply plain text only. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char]!);
}

type BrandedEmailContent = {
  greeting: string;
  headline: string;
  highlight: string;
  highlightIsCode?: boolean;
  paragraphs: string[];
  detail?: { label: string; value: string };
};

/** Wings Rewards palette, with fluid tables and an Outlook desktop width fallback. */
export function renderBrandedEmail(content: BrandedEmailContent): string {
  const paragraphStyle = "margin:0 0 16px;font-size:16px;line-height:1.6;overflow-wrap:break-word;word-wrap:break-word;";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body style="margin:0;padding:0;background:#f7f1e9;color:#30251e;font-family:Arial,Helvetica,sans-serif;line-height:1.6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f7f1e9" style="width:100%;background:#f7f1e9;">
      <tr><td align="center" style="padding:24px 16px;">
      <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;table-layout:fixed;">
        <tr><td bgcolor="#321a12" style="background:#321a12;color:#fff4e4;padding:24px;border-radius:16px 16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1.3;font-weight:bold;">Wings 4 U</td></tr>
        <tr><td bgcolor="#fffdf9" style="background:#fffdf9;color:#30251e;padding:24px;border-radius:0 0 16px 16px;font-family:Arial,Helvetica,sans-serif;">
          <p style="${paragraphStyle}">${escapeHtml(content.greeting)}</p>
          <h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;color:#983315;overflow-wrap:break-word;word-wrap:break-word;">${escapeHtml(content.headline)}</h1>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;margin:0 0 20px;">
            <tr><td bgcolor="#fce9d5" style="padding:16px;background:#fce9d5;color:#30251e;border-radius:10px;font-size:20px;line-height:1.5;font-weight:bold;overflow-wrap:break-word;word-wrap:break-word;${content.highlightIsCode ? "text-align:center;font-size:32px;letter-spacing:4px;font-family:Consolas,monospace;" : ""}">${escapeHtml(content.highlight)}</td></tr>
          </table>
          ${content.paragraphs.map(value => `<p style="${paragraphStyle}">${escapeHtml(value)}</p>`).join("\n          ")}
          ${content.detail ? `<p style="${paragraphStyle}"><strong>${escapeHtml(content.detail.label)}:</strong> ${escapeHtml(content.detail.value)}</p>` : ""}
          <p style="margin:24px 0 0;font-size:16px;line-height:1.6;">See you soon,<br>The Wings 4 U Team ❤️</p>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
      </td></tr>
    </table></body></html>`;
}
