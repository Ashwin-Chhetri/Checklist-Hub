import type { TaxonomicScope } from "@/types/checklist.types";

export interface CollaboratorInviteTemplateInput {
  inviterName: string;
  toEmail: string;
  checklistTitle: string;
  homeUrl: string;
  summaryStats: {
    speciesCount: number;
    region?: string;
    taxonomicScope?: TaxonomicScope;
  };
  acceptUrl: string;
  personalNote?: string;
  /** True when the invitee already has a ChecklistHub account (link goes straight to the checklist); false when they need to sign up first (link goes to /login). */
  hasAccount: boolean;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const HIERARCHY_LEVELS: (keyof TaxonomicScope)[] = ["kingdom", "phylum", "class", "order", "family", "genus"];

function formatHierarchy(scope?: TaxonomicScope): string | null {
  if (!scope) return null;
  const levels = HIERARCHY_LEVELS.map((level) => scope[level]).filter((v): v is string => Boolean(v));
  return levels.length > 0 ? levels.join(" → ") : null;
}

/**
 * Collaboration-invite email: a plain, simple "you've been added" notice.
 * Used both for notifying existing Hub members (hasAccount: true, links
 * straight into the checklist) and inviting people who don't have an
 * account yet (hasAccount: false, links at /login — they'll see the
 * checklist once they sign in, since pending invites are converted to
 * access on signup).
 */
export function renderCollaboratorInviteEmail(input: CollaboratorInviteTemplateInput): RenderedEmail {
  const { inviterName, toEmail, checklistTitle, summaryStats, acceptUrl, personalNote, homeUrl } = input;
  const subject = `${inviterName} invited you to collaborate on "${checklistTitle}"`;
  const year = new Date().getFullYear();
  const hierarchy = formatHierarchy(summaryStats.taxonomicScope);

  const checklistFacts = [
    `${summaryStats.speciesCount.toLocaleString()} species`,
    summaryStats.region,
    hierarchy,
  ].filter((line): line is string => Boolean(line));

  const text = [
    "Checklist Hub is a tool for collaboratively building and reviewing biodiversity checklists.",
    "",
    `${inviterName} invited you to collaborate on "${checklistTitle}".`,
    checklistFacts.length > 0 ? checklistFacts.join(" · ") : "",
    personalNote ? `\nNote from ${inviterName}:\n${personalNote}` : "",
    "",
    `Accept the invitation: ${acceptUrl}`,
    "",
    `Invitation sent to: ${toEmail}`,
    `Invited by: ${inviterName}`,
    "",
    "This invitation is intended only for the recipient of this email.",
    "If you were not expecting this invitation, you can safely ignore this message.",
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
        <strong>${escapeHtml(inviterName)}</strong> invited you to collaborate on
      </p>
      <p style="margin: 0 0 12px; font-size: 20px; font-weight: 700; color: #1b1c1c;">
        ${escapeHtml(checklistTitle)}
      </p>

      ${
        checklistFacts.length > 0
          ? `<p style="margin: 0 0 20px; font-size: 13px; color: #4a4a4a;">${checklistFacts.map(escapeHtml).join(" &middot; ")}</p>`
          : ""
      }

      ${personalNote ? `<p style="margin: 0 0 20px; font-size: 13px; color: #4a4a4a;">&ldquo;${escapeHtml(personalNote)}&rdquo;</p>` : ""}

      <table style="border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <td>
            <a href="${escapeHtml(acceptUrl)}" style="display: inline-block; background: #c63939; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 2px; font-size: 13px; font-weight: 700;">Accept Invitation</a>
          </td>
        </tr>
      </table>

      <p style="margin: 0 0 20px; font-size: 12px; color: #6b6b6b; line-height: 1.6;">
        Invitation sent to: ${escapeHtml(toEmail)}<br />
        Invited by: ${escapeHtml(inviterName)}
      </p>

      <p style="margin: 0 0 20px; font-size: 11px; color: #8d706e; line-height: 1.5;">
        This invitation is intended only for the recipient of this email.<br />
        If you were not expecting this invitation, you can safely ignore this message.
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
