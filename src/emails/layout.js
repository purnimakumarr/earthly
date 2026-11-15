const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Shared shell for transactional emails. Inline styles only: mail clients
// ignore most stylesheets.
const layout = ({ heading, paragraphs, action }) => `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px 16px;background:#f4efe6;font-family:Georgia,'Times New Roman',serif;color:#1d3a3a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdf9;border:1px solid #e3d9c8;border-radius:12px;">
            <tr>
              <td style="padding:32px;">
                <p style="margin:0 0 24px;font-size:20px;letter-spacing:0.02em;color:#b5562f;">earthly</p>
                <h1 style="margin:0 0 16px;font-size:24px;font-weight:normal;line-height:1.3;">${escapeHtml(heading)}</h1>
                ${paragraphs
                  .map(
                    (text) =>
                      `<p style="margin:0 0 16px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#3d5353;">${escapeHtml(text)}</p>`,
                  )
                  .join('\n                ')}
                ${
                  action
                    ? `<p style="margin:24px 0 8px;"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:12px 22px;background:#1d3a3a;color:#fffdf9;text-decoration:none;border-radius:8px;font-family:Helvetica,Arial,sans-serif;font-size:15px;">${escapeHtml(action.label)}</a></p>`
                    : ''
                }
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#8a8473;">Earthly · small-group expeditions that tread lightly</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

module.exports = layout;
