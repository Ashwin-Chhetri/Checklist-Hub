export interface WatcherAlertTemplateInput {
  checklistTitle: string;
  homeUrl: string;
  toEmail: string;
  newSpeciesCount: number;
  updatedSpeciesCount: number;
  sourceSummaryLine?: string;
  reviewUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Watcher-run alert email: sent to every subscriber on a checklist's watcher
 * when a periodic run finds new candidate species and/or new observations on
 * existing species. The CTA deep-links into the workbench with
 * `?watcher_run={id}`, which auto-opens the run's results dialog.
 */
export function renderWatcherAlertEmail(input: WatcherAlertTemplateInput): RenderedEmail {
  const { checklistTitle, homeUrl, toEmail, newSpeciesCount, updatedSpeciesCount, sourceSummaryLine, reviewUrl } =
    input;

  const parts: string[] = [];
  if (newSpeciesCount > 0) parts.push(`${newSpeciesCount} possible new species`);
  if (updatedSpeciesCount > 0) parts.push(`${updatedSpeciesCount} species with new observations`);
  const summary = parts.join(" · ");

  const subject = `Watcher alert: ${summary} on "${checklistTitle}"`;
  const year = new Date().getFullYear();

  const text = [
    "Checklist Hub is a tool for collaboratively building and reviewing biodiversity checklists.",
    "",
    `Your watcher on "${checklistTitle}" found ${summary}.`,
    sourceSummaryLine ?? "",
    "",
    `Review this run: ${reviewUrl}`,
    "",
    `Sent to: ${toEmail}`,
    "",
    `© ${year} Checklist Hub`,
    "",
    `Visit Checklist Hub: ${homeUrl}`,
    "",
    "Need help?",
    "checklisthub.review@gmail.com",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = `
    <div style="font-family: 'Geist', Arial, Helvetica, sans-serif; color: #1b1c1c; line-height: 1.6; width: 100%; max-width: 560px; margin: 0 auto; padding: 32px 24px; box-sizing: border-box;">

      <p style="margin: 0 0 20px; font-size: 13px; color: #4a4a4a;">
        Checklist Hub is a tool for collaboratively building and reviewing biodiversity checklists.
      </p>

      <p style="margin: 0 0 4px; font-size: 14px; color: #1b1c1c;">
        Your watcher on
      </p>
      <p style="margin: 0 0 12px; font-size: 20px; font-weight: 700; color: #1b1c1c;">
        ${escapeHtml(checklistTitle)}
      </p>

      <p style="margin: 0 0 20px; font-size: 13px; color: #4a4a4a;">
        found ${escapeHtml(summary)}.
        ${sourceSummaryLine ? `<br />${escapeHtml(sourceSummaryLine)}` : ""}
      </p>

      <table style="border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td>
            <a href="${escapeHtml(reviewUrl)}" style="display: inline-block; background: #c63939; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 2px; font-size: 13px; font-weight: 700;">Review Run</a>
          </td>
        </tr>
      </table>

      <p style="margin: 0 0 20px; font-size: 12px; color: #6b6b6b; line-height: 1.6;">
        Sent to: ${escapeHtml(toEmail)}
      </p>

      <p style="margin: 0; font-size: 11px; color: #8d706e; line-height: 1.6;">
        &copy; ${year} Checklist Hub<br /><br />
        <a href="${escapeHtml(homeUrl)}" style="color: #a41f24; text-decoration: none;">Visit Checklist Hub</a><br /><br />
        Need help?<br />
        checklisthub.review@gmail.com
      </p>
    </div>
  `.trim();

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
