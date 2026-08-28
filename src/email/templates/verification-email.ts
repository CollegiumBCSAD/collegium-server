function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Table-based layout with everything inlined — Outlook's rendering engine
// ignores flexbox/grid/blur/clip-path and strips most <style> rules, so the
// site's actual glassmorphism/clip-path button can't travel here as-is. This
// ports the same tokens (colors, Oswald display type, red-to-violet accent)
// through email-safe primitives instead.
export function buildVerificationEmailHtml(
  displayName: string,
  verifyUrl: string,
): string {
  const safeName = escapeHtml(displayName);
  const safeUrl = escapeHtml(verifyUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Verify your Collegium account</title>
<!--[if mso]>
<style>* { font-family: Arial, sans-serif !important; }</style>
<![endif]-->
<style>
  @media (max-width: 600px) {
    .container { width: 100% !important; }
    .px { padding-left: 24px !important; padding-right: 24px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#0A0C10;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0A0C10;">
    <tr>
      <td align="center" style="padding: 48px 16px;">
        <table role="presentation" class="container" width="520" cellpadding="0" cellspacing="0" style="width:520px; max-width:520px; background-color:#121520; border:1px solid #272B3A; border-radius:10px;">
          <tr>
            <td style="height:4px; line-height:4px; font-size:0; background-color:#E53A4C; background-image: linear-gradient(90deg, #E53A4C 0%, #8B5CF6 100%); border-radius:10px 10px 0 0;">&nbsp;</td>
          </tr>
          <tr>
            <td class="px" style="padding: 36px 44px 0 44px;">
              <p style="margin:0; font-family:'Courier New',Courier,monospace; font-size:11px; letter-spacing:0.14em; color:#8B92A5; text-transform:uppercase;">// collegium account verification //</p>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 10px 44px 0 44px;">
              <h1 style="margin:0; font-family:'Oswald','Arial Black',Arial,sans-serif; font-weight:700; font-size:26px; line-height:1.3; letter-spacing:0.02em; text-transform:uppercase; color:#EDEEF2;">Confirm it&#39;s you, ${safeName}</h1>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 16px 44px 0 44px;">
              <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.6; color:#8B92A5;">One more step before your account goes live. Confirm this is your institutional email to unlock Collegium.</p>
            </td>
          </tr>
          <tr>
            <td class="px" align="left" style="padding: 32px 44px 8px 44px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="border-radius:6px; background-color:#E53A4C;">
                    <a href="${safeUrl}" target="_blank" style="display:inline-block; padding:15px 34px; font-family:'Oswald','Arial Black',Arial,sans-serif; font-weight:700; font-size:14px; letter-spacing:0.08em; text-transform:uppercase; color:#FFFFFF; text-decoration:none; border-radius:6px; border-top:1px solid rgba(255,255,255,0.35); border-bottom:2px solid rgba(0,0,0,0.35);">Verify email</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 20px 44px 0 44px;">
              <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.6; color:#6E6E6E;">Button not working? Paste this link into your browser:<br><a href="${safeUrl}" target="_blank" style="color:#8B92A5; word-break:break-all;">${safeUrl}</a></p>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding: 28px 44px 36px 44px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #272B3A;">
                <tr><td style="padding-top:20px;">
                  <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.6; color:#6E6E6E;">This link expires in 24 hours. If you didn&#39;t create a Collegium account, you can ignore this email.</p>
                </td></tr>
              </table>
            </td>
          </tr>
        </table>
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px; max-width:520px;">
          <tr>
            <td align="center" style="padding: 24px 16px 0 16px;">
              <p style="margin:0; font-family:'Oswald','Arial Black',Arial,sans-serif; font-weight:700; font-size:13px; letter-spacing:0.16em; text-transform:uppercase; color:#3A4259;">Collegium</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildVerificationEmailText(
  displayName: string,
  verifyUrl: string,
): string {
  return `Confirm it's you, ${displayName}

One more step before your account goes live. Confirm this is your institutional email to unlock Collegium:

${verifyUrl}

This link expires in 24 hours. If you didn't create a Collegium account, you can ignore this email.`;
}
