import type { EvidenceQuality, ReviewStatus, TaxonomyStatus } from "@/types/species.types";
import type { ChecklistStatus } from "@/types/checklist.types";

export const EVIDENCE_QUALITY_STYLES: Record<
  EvidenceQuality,
  { label: string; pillClass: string; icon: string; iconClass: string }
> = {
  high: { label: "HIGH", pillClass: "bg-green-100 text-green-700", icon: "check_circle", iconClass: "text-green-600" },
  medium: { label: "MEDIUM", pillClass: "bg-amber-100 text-amber-700", icon: "info", iconClass: "text-amber-500" },
  low: { label: "LOW", pillClass: "bg-red-100 text-red-700", icon: "warning", iconClass: "text-red-400" },
  insufficient: { label: "INSUFFICIENT", pillClass: "bg-slate-100 text-slate-500", icon: "help", iconClass: "text-slate-400" },
};

export const TAXONOMY_STATUS_STYLES: Record<
  TaxonomyStatus,
  { label: string; pillClass: string; icon: string; iconClass: string }
> = {
  accepted: {
    label: "ACCEPTED NAME",
    pillClass: "bg-green-50 text-green-600 border border-green-200",
    icon: "check_circle",
    iconClass: "text-green-600",
  },
  synonym: {
    label: "SYNONYM / OUTDATED",
    pillClass: "bg-amber-50 text-amber-600 border border-amber-200",
    icon: "refresh",
    iconClass: "text-amber-500",
  },
  authority_conflict: {
    label: "AUTHORITY CONFLICT",
    pillClass: "bg-red-50 text-red-600 border border-red-200",
    icon: "error",
    iconClass: "text-red-600",
  },
  unresolved: {
    label: "UNRESOLVED",
    pillClass: "bg-slate-100 text-slate-500 border border-slate-300",
    icon: "help",
    iconClass: "text-slate-400",
  },
};

export const REVIEW_STATUS_STYLES: Record<ReviewStatus, { label: string; pillClass: string }> = {
  not_reviewed: { label: "Not Reviewed", pillClass: "bg-slate-100 text-slate-500 border border-slate-200" },
  under_review: { label: "Under Review", pillClass: "bg-amber-100 text-amber-700 border border-amber-300" },
  reviewed: { label: "Reviewed", pillClass: "bg-green-50 text-green-600 border border-green-200" },
  accepted: { label: "Accepted", pillClass: "bg-green-100 text-green-700 border border-green-300" },
  rejected: { label: "Rejected", pillClass: "bg-slate-200 text-slate-600 border border-slate-300" },
};

export const CHECKLIST_STATUS_STYLES: Record<ChecklistStatus, { label: string; pillClass: string }> = {
  draft: { label: "Draft", pillClass: "bg-slate-100 text-slate-500 border border-slate-200" },
  importing: { label: "Importing", pillClass: "bg-amber-100 text-amber-700 border border-amber-300" },
  validating: { label: "Validating", pillClass: "bg-amber-100 text-amber-700 border border-amber-300" },
  reviewing: { label: "Reviewing", pillClass: "bg-blue-50 text-blue-600 border border-blue-200" },
  published: { label: "Published", pillClass: "bg-green-100 text-green-700 border border-green-300" },
  archived: { label: "Archived", pillClass: "bg-slate-200 text-slate-600 border border-slate-300" },
};

export const EVIDENCE_SOURCE_LABELS: Record<string, string> = {
  gbif: "GBIF",
  ebird: "eBird",
  inaturalist: "iNat",
  literature: "Literature",
  legacy: "Legacy",
};
