import { sendEmail } from "@/lib/email";
import { renderCollaboratorInviteEmail } from "@/lib/email/templates/collaboratorInvite";
import type { TaxonomicScope } from "@/types/checklist.types";

interface SendInviteEmailInput {
  origin: string;
  inviterName: string;
  checklist: {
    id: string;
    title: string;
    region_name: string | null;
    taxonomic_scope: TaxonomicScope;
  };
  speciesCount: number;
  toEmail: string;
  hasAccount: boolean;
  note?: string;
}

/**
 * Builds and sends the collaborator-invite email (best-effort — failures are
 * logged, never thrown, since a checklist share/creation shouldn't fail just
 * because an email didn't go out). Shared by both the checklist-creation
 * route and the Share-dialog invite route so the two paths can't drift.
 */
export async function sendInviteEmail(input: SendInviteEmailInput): Promise<void> {
  const { origin, inviterName, checklist, speciesCount, toEmail, hasAccount, note } = input;
  try {
    const email = renderCollaboratorInviteEmail({
      inviterName,
      toEmail,
      checklistTitle: checklist.title,
      homeUrl: origin,
      summaryStats: {
        speciesCount,
        region: checklist.region_name ?? undefined,
        taxonomicScope: checklist.taxonomic_scope,
      },
      acceptUrl: hasAccount ? `${origin}/checklists/${checklist.id}` : `${origin}/login`,
      personalNote: note,
      hasAccount,
    });
    await sendEmail({ to: toEmail, ...email });
  } catch (err) {
    console.error("Failed to send invite email to %s:", toEmail, err);
  }
}
