"use client";

import { useState } from "react";
import AppHeader from "@/components/shared/AppHeader";
import type {
  Checklist,
  ChecklistContributor,
  ChecklistMetadata,
  ChecklistPublicationDraft,
  GbifEndorsementStatus,
  IptAccessStatus,
  PublishingOrganization,
} from "@/types/checklist.types";
import { buildEmlXml, downloadTextFile, downloadBlob } from "../utils/darwinCore";
import { downloadPublicationPackageBlob } from "../services/publicationDraftService";
import { useSaveChecklistMetadata } from "../hooks/useSaveChecklistMetadata";
import { usePublishChecklist, useMarkSubmittedForReview } from "../hooks/usePublishChecklist";
import { usePublicationReadiness } from "../hooks/usePublicationReadiness";
import {
  useMyPublishingOrganizations,
  useSetChecklistPublishingOrganization,
  useUpsertPublishingOrganization,
} from "../hooks/usePublishingOrganizations";
import { useNearbyIpts, useIptSearch, useResolveGbifDataset } from "../hooks/useIptDirectory";
import type { IptInstallation } from "../services/iptDirectoryService";
import { guessCountryCode, guessNearbyCountries, ISO_COUNTRIES } from "@/lib/geo/countries";

const ENDORSEMENT_LABELS: Record<GbifEndorsementStatus, string> = {
  not_started: "Not started",
  requested: "Requested",
  endorsed: "Endorsed",
};

const IPT_ACCESS_LABELS: Record<IptAccessStatus, string> = {
  not_started: "Not started",
  requested: "Requested",
  granted: "Granted",
};

const PACKAGE_FILES = ["taxon.txt", "vernacularname.txt", "distribution.txt", "resourcerelationship.txt", "multimedia.txt", "eml.xml"];

const STEPS = ["Publisher", "Publishing Partner", "Package", "Publish", "Register"] as const;

interface PublishIptPageProps {
  checklist: Checklist | undefined;
  checklistId: string;
  metadata: ChecklistMetadata | null;
  contributors: ChecklistContributor[];
  draft: ChecklistPublicationDraft | undefined | null;
  /** Jump straight to a later step — e.g. "register" for the checklists list's "Submitted for Review" sub-row, so the user lands on Step 5 instead of re-walking the whole wizard. */
  initialStep?: "register";
  onBack: () => void;
  onPublished: () => void;
}

export function PublishIptPage({
  checklist,
  checklistId,
  metadata,
  contributors,
  draft,
  initialStep,
  onBack,
  onPublished,
}: PublishIptPageProps) {
  const { data: organizations } = useMyPublishingOrganizations();
  const upsertOrg = useUpsertPublishingOrganization();
  const linkOrg = useSetChecklistPublishingOrganization(checklistId);
  const saveMetadata = useSaveChecklistMetadata(checklistId);
  const publishChecklist = usePublishChecklist(checklistId);
  const markSubmittedForReview = useMarkSubmittedForReview(checklistId);
  const { data: readiness } = usePublicationReadiness(checklistId);

  const linkedOrg = organizations?.find((o) => o.id === metadata?.publishing_organization_id) ?? null;

  const [step, setStep] = useState(initialStep === "register" ? 4 : 0);

  const [creatingOrg, setCreatingOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [selectError, setSelectError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [packageContentsOpen, setPackageContentsOpen] = useState(false);
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [mappingHelpOpen, setMappingHelpOpen] = useState(false);
  const [countryOverride, setCountryOverride] = useState("");
  const [selectedNearbyCountry, setSelectedNearbyCountry] = useState<string | null>(null);
  const [publisherHelpOpen, setPublisherHelpOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [gbifDatasetUuid, setGbifDatasetUuid] = useState("");
  const [gbifDoi, setGbifDoi] = useState("");
  const [gbifCitation, setGbifCitation] = useState("");
  const [gbifPublicationYear, setGbifPublicationYear] = useState("");
  const [datasetUrl, setDatasetUrl] = useState("");

  // Metadata loads asynchronously after first render — seed the form fields
  // from it once, the first time it becomes available, instead of in an
  // effect (React's recommended pattern for one-time derived state from an
  // async value; mirrors the `resumed`/draft-stage seeding in
  // app/src/app/checklists/[id]/publish/page.tsx).
  const [seededFromMetadata, setSeededFromMetadata] = useState(false);
  if (!seededFromMetadata && metadata) {
    setSeededFromMetadata(true);
    setGbifDatasetUuid(metadata.gbif_dataset_uuid ?? "");
    setGbifDoi(metadata.gbif_doi ?? "");
    setGbifCitation(metadata.gbif_citation ?? "");
    setGbifPublicationYear(metadata.gbif_publication_year ? String(metadata.gbif_publication_year) : "");
  }

  // Reverse-order region cascade: try the most specific geography signal
  // first (district), widening to state then country, since a checklist's
  // own region fields (set when it was created) are often filled in even
  // when this publish step's metadata.geo_* fields are still blank. Not
  // shown to the user — just resolves silently to a country code.
  const regionSignals = [
    checklist?.region_district ?? null,
    checklist?.region_state ?? metadata?.geo_state ?? null,
    checklist?.region_country ?? metadata?.geo_country ?? null,
  ];
  let detectedCode: string | null = null;
  for (const value of regionSignals) {
    const code = guessCountryCode(value);
    if (code) {
      detectedCode = code;
      break;
    }
  }

  const nearbyCandidates = !detectedCode
    ? guessNearbyCountries(metadata?.geo_region_name ?? metadata?.geo_description)
    : [];

  const countryCode = detectedCode ?? selectedNearbyCountry ?? guessCountryCode(countryOverride);
  const { data: nearbyIpts, isLoading: loadingNearbyIpts } = useNearbyIpts(countryCode);

  const { data: searchResults, isLoading: searching } = useIptSearch(searchQuery);

  const resolveDataset = useResolveGbifDataset();

  function handleSelectIpt(ipt: IptInstallation) {
    if (!linkedOrg) return;
    upsertOrg.mutate({
      ...linkedOrg,
      ipt_instance_name: ipt.installationTitle,
      ipt_instance_url: ipt.iptUrl,
      gbif_registry_org_uuid: ipt.organizationKey,
      website: ipt.organizationWebsite ?? linkedOrg.website,
    });
  }

  function handleSelectOrg(id: string) {
    setSelectError(null);
    linkOrg.mutate(id || null, { onError: (err) => setSelectError(err instanceof Error ? err.message : "Failed to link organization.") });
  }

  function handleCreateOrg() {
    if (!newOrgName.trim()) return;
    setSelectError(null);
    upsertOrg.mutate(
      {
        name: newOrgName.trim(),
        website: null,
        institution_code: null,
        contact_name: null,
        contact_email: null,
        endorsement_status: "not_started",
        endorsement_requested_at: null,
        endorsement_notes: null,
        ipt_access_status: "not_started",
        ipt_instance_name: null,
        ipt_instance_url: null,
        ipt_organization_key: null,
        gbif_registry_org_uuid: null,
      },
      {
        onSuccess: (id) => {
          linkOrg.mutate(id, {
            onError: (err) => setSelectError(err instanceof Error ? err.message : "Failed to link the new organization."),
          });
          setCreatingOrg(false);
          setNewOrgName("");
        },
        onError: (err) => setSelectError(err instanceof Error ? err.message : "Failed to create the organization."),
      },
    );
  }

  function updateOrgField<K extends keyof PublishingOrganization>(field: K, value: PublishingOrganization[K]) {
    if (!linkedOrg) return;
    upsertOrg.mutate({ ...linkedOrg, [field]: value });
  }

  function handleDownloadEml() {
    if (!checklist) return;
    const eml = buildEmlXml(checklist, metadata, contributors);
    downloadTextFile("eml.xml", eml, "application/xml");
  }

  async function handleDownloadPackage() {
    if (!draft?.package_storage_path) return;
    const blob = await downloadPublicationPackageBlob(draft.package_storage_path);
    downloadBlob(`${checklist?.title ?? "checklist"}-dwca.zip`, blob);
  }

  function handleFetchDetails() {
    if (!datasetUrl.trim()) return;
    resolveDataset.mutate(datasetUrl.trim(), {
      onSuccess: (result) => {
        setGbifDatasetUuid(result.datasetUuid);
        setGbifDoi(result.doi ?? "");
        setGbifCitation(result.citation ?? "");
        setGbifPublicationYear(result.publicationYear ? String(result.publicationYear) : "");
      },
    });
  }

  const canFinish = gbifDatasetUuid.trim() !== "" || gbifDoi.trim() !== "";

  async function handleFinish() {
    await saveMetadata.mutateAsync({
      metadata: {
        gbif_dataset_uuid: gbifDatasetUuid.trim() || null,
        gbif_doi: gbifDoi.trim() || null,
        gbif_citation: gbifCitation.trim() || null,
        gbif_publication_year: gbifPublicationYear.trim() ? Number(gbifPublicationYear.trim()) : null,
        ipt_published_at: new Date().toISOString(),
      },
      contributors,
    });
    publishChecklist.mutate(undefined, { onSuccess: onPublished });
  }

  const metadataComplete = !!(metadata?.short_description && metadata?.license);
  const taxonomyValidated = readiness?.is_ready ?? false;
  const citationReady = !!linkedOrg && !!metadata?.dataset_version;
  const dwcaGenerated = !!draft?.package_storage_path;
  const emlGenerated = !!checklist && !!metadata;

  const canAdvance = [
    !!linkedOrg,
    !!linkedOrg?.ipt_instance_name,
    dwcaGenerated,
    true,
    canFinish,
  ];

  return (
    <div className="min-h-screen flex flex-col bg-surface text-on-surface">
      <header className="h-14 border-b border-surface-dim bg-white flex items-center justify-between px-4 z-50 sticky top-0">
        <div className="flex items-center gap-6">
          <AppHeader />
          <button
            type="button"
            onClick={onBack}
            className="bg-brand text-white px-3 py-1.5 rounded-sm text-xs mono-text font-medium flex items-center gap-2 shadow-hard hover:translate-y-[-1px] transition-transform"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Back to Package
          </button>
        </div>
        <h1 className="font-headline-md text-sm text-brand uppercase tracking-tight">Publish via IPT</h1>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <StepIndicator step={step} onSelect={setStep} />

          {step === 0 && (
            <section className="bg-white border border-surface-dim shadow-hard p-5 space-y-4">
              <div>
                <div className="flex items-center gap-1.5">
                  <h2 className="font-label-caps text-[11px] text-secondary uppercase tracking-widest font-bold">
                    Who Is Publishing This Checklist?
                  </h2>
                  <button
                    type="button"
                    onClick={() => setPublisherHelpOpen(true)}
                    aria-label="Why we ask this"
                    className="text-slate-400 hover:text-brand"
                  >
                    <span className="material-symbols-outlined text-[16px]">help</span>
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  This is the organization (or person) that GBIF will credit and contact about this dataset.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  {linkedOrg ? <span className="font-bold text-sm">{linkedOrg.name}</span> : <span />}
                  {linkOrg.isPending && <span className="text-[10px] text-slate-400 mono-text">Saving...</span>}
                </div>

                <div className="flex gap-2">
                  {/* Fully controlled and always editable — switching directly from org A to org B is one
                      mutation, not unlink-then-relink. The two-phase version of this (a separate "Change"
                      button that nulled the link first) could leave a user stuck if the unlink step's
                      re-render didn't land, since there was nothing left to click. */}
                  <select
                    className="flex-1 border border-surface-dim rounded-sm px-2 py-1.5 text-xs disabled:opacity-50"
                    value={linkedOrg?.id ?? ""}
                    disabled={linkOrg.isPending}
                    onChange={(e) => handleSelectOrg(e.target.value)}
                  >
                    <option value="" disabled={!linkedOrg}>
                      {linkedOrg ? "— Unlink —" : "Select a publishing organization..."}
                    </option>
                    {(organizations ?? []).map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setCreatingOrg((v) => !v)}
                    className="px-3 py-1.5 bg-white border border-surface-dim text-secondary text-[10px] mono-text font-bold uppercase rounded-sm hover:border-brand hover:text-brand transition-colors"
                  >
                    + New
                  </button>
                </div>
                {!linkedOrg && (
                  <p className="text-[10px] text-slate-400 mono-text">e.g. ATREE, ICIMOD, WII, University of Calcutta, or &quot;Personal Project&quot;</p>
                )}
                {selectError && <p className="text-[10px] text-error mono-text">{selectError}</p>}
                {creatingOrg && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Organization name"
                      value={newOrgName}
                      onChange={(e) => setNewOrgName(e.target.value)}
                      className="flex-1 border border-surface-dim rounded-sm px-2 py-1.5 text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleCreateOrg}
                      disabled={!newOrgName.trim() || upsertOrg.isPending}
                      className="bg-brand text-white px-3 py-1.5 rounded-sm font-label-caps text-[10px] uppercase disabled:opacity-50"
                    >
                      {upsertOrg.isPending ? "Creating..." : "Create"}
                    </button>
                  </div>
                )}

                {linkedOrg && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Contact person (optional)"
                        defaultValue={linkedOrg.contact_name ?? ""}
                        onBlur={(e) => updateOrgField("contact_name", e.target.value || null)}
                        className="border border-surface-dim rounded-sm px-2 py-1.5 text-xs"
                      />
                      <input
                        type="email"
                        placeholder="Contact email (optional)"
                        defaultValue={linkedOrg.contact_email ?? ""}
                        onBlur={(e) => updateOrgField("contact_email", e.target.value || null)}
                        className="border border-surface-dim rounded-sm px-2 py-1.5 text-xs"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => setAdvancedOpen((v) => !v)}
                      className="text-[10px] text-slate-400 hover:text-brand mono-text uppercase flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {advancedOpen ? "expand_less" : "expand_more"}
                      </span>
                      Advanced: GBIF Endorsement &amp; IPT Access
                    </button>

                    {advancedOpen && (
                      <div className="space-y-2">
                        <StatusRow
                          label="GBIF Endorsement"
                          value={ENDORSEMENT_LABELS[linkedOrg.endorsement_status]}
                          ok={linkedOrg.endorsement_status === "endorsed"}
                        >
                          <select
                            className="border border-surface-dim rounded-sm px-2 py-1 text-[10px] mono-text"
                            value={linkedOrg.endorsement_status}
                            onChange={(e) => updateOrgField("endorsement_status", e.target.value as GbifEndorsementStatus)}
                          >
                            {Object.entries(ENDORSEMENT_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                          {linkedOrg.endorsement_status !== "endorsed" && (
                            <a
                              href="https://www.gbif.org/become-a-publisher"
                              target="_blank"
                              rel="noreferrer"
                              className="text-[10px] text-brand underline"
                            >
                              Request endorsement
                            </a>
                          )}
                        </StatusRow>
                        <StatusRow
                          label="IPT Access"
                          value={IPT_ACCESS_LABELS[linkedOrg.ipt_access_status]}
                          ok={linkedOrg.ipt_access_status === "granted"}
                        >
                          <select
                            className="border border-surface-dim rounded-sm px-2 py-1 text-[10px] mono-text"
                            value={linkedOrg.ipt_access_status}
                            onChange={(e) => updateOrgField("ipt_access_status", e.target.value as IptAccessStatus)}
                          >
                            {Object.entries(IPT_ACCESS_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </StatusRow>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
          )}

          {step === 1 && (
            <section className="bg-white border border-surface-dim shadow-hard p-5 space-y-4">
              <div>
                <h2 className="font-label-caps text-[11px] text-secondary uppercase tracking-widest font-bold">
                  Find Your Publishing Partner
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  These are GBIF-registered IPT publishers near your checklist&apos;s region — pick one to host your
                  dataset.
                </p>

                {!detectedCode && nearbyCandidates.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    <p className="text-xs text-slate-500">Showing publishers for:</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {nearbyCandidates.map((code) => {
                        const name = ISO_COUNTRIES.find((c) => c.code === code)?.name ?? code;
                        return (
                          <button
                            key={code}
                            type="button"
                            onClick={() => setSelectedNearbyCountry(code)}
                            className={`px-2 py-1 text-[10px] mono-text font-bold uppercase rounded-sm border ${
                              selectedNearbyCountry === code
                                ? "bg-brand text-white border-brand"
                                : "bg-white border-surface-dim text-secondary hover:border-brand hover:text-brand"
                            }`}
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {!detectedCode && nearbyCandidates.length === 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs text-slate-500">What country is this checklist for?</span>
                    <input
                      type="text"
                      placeholder="e.g. India"
                      value={countryOverride}
                      onChange={(e) => setCountryOverride(e.target.value)}
                      className="border border-surface-dim rounded-sm px-2 py-1 text-xs w-32"
                    />
                  </div>
                )}
              </div>

              {linkedOrg?.ipt_instance_name && (
                <div className="border border-green-200 bg-green-50 rounded-sm px-3 py-2 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-slate-500 mono-text uppercase">Your publishing partner</div>
                    <div className="text-xs font-bold">{linkedOrg.ipt_instance_name}</div>
                  </div>
                  <PublisherLinks org={linkedOrg} />
                </div>
              )}

              {countryCode && loadingNearbyIpts && <p className="text-[11px] text-slate-400 mono-text">Looking for publishing partners...</p>}
              {countryCode && !loadingNearbyIpts && (nearbyIpts ?? []).length === 0 && (
                <p className="text-[11px] text-slate-400 mono-text">
                  No publishing partners found yet for this region. Try a nearby country, or ask GBIF directly at{" "}
                  <a href="https://www.gbif.org/become-a-publisher" target="_blank" rel="noreferrer" className="text-brand underline">
                    gbif.org/become-a-publisher
                  </a>
                  .
                </p>
              )}
              {(nearbyIpts ?? []).length > 0 && (
                <ul className="space-y-2">
                  {nearbyIpts!.slice(0, 8).map((ipt) => (
                    <PartnerRow key={ipt.installationKey} ipt={ipt} canSelect={!!linkedOrg} onSelect={handleSelectIpt} />
                  ))}
                </ul>
              )}

              <div className="pt-2 border-t border-surface-dim space-y-2">
                <p className="text-[10px] text-slate-500 mono-text uppercase tracking-widest font-bold">
                  Or search all registered publishers
                </p>
                <input
                  type="text"
                  placeholder="Search by organization name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full border border-surface-dim rounded-sm px-2 py-1.5 text-xs"
                />
                {searching && <p className="text-[11px] text-slate-400 mono-text">Searching...</p>}
                {searchQuery.trim().length >= 2 && !searching && (searchResults ?? []).length === 0 && (
                  <p className="text-[11px] text-slate-400 mono-text">No publishers matched &quot;{searchQuery}&quot;.</p>
                )}
                {(searchResults ?? []).length > 0 && (
                  <ul className="space-y-2">
                    {searchResults!.slice(0, 10).map((ipt) => (
                      <PartnerRow key={ipt.installationKey} ipt={ipt} canSelect={!!linkedOrg} onSelect={handleSelectIpt} />
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="bg-white border border-surface-dim shadow-hard p-5 space-y-4">
              <h2 className="font-label-caps text-[11px] text-secondary uppercase tracking-widest font-bold">
                Publication Package
              </h2>
              <div className="space-y-1.5">
                <ReadinessRow label="Metadata Complete" ok={metadataComplete} />
                <ReadinessRow label="Taxonomy Validated" ok={taxonomyValidated} />
                <ReadinessRow label="Citation Ready" ok={citationReady} />
                <ReadinessRow label="DwC-A Generated" ok={dwcaGenerated} />
                <ReadinessRow label="EML Generated" ok={emlGenerated} />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDownloadPackage}
                  disabled={!dwcaGenerated}
                  className="px-3 py-1.5 bg-brand text-white text-[10px] mono-text font-bold uppercase rounded-sm flex items-center gap-2 disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  Download Package
                </button>
                <button
                  type="button"
                  onClick={handleDownloadEml}
                  disabled={!checklist}
                  className="px-3 py-1.5 bg-white border border-surface-dim text-secondary text-[10px] mono-text font-bold uppercase rounded-sm flex items-center gap-2 hover:border-brand hover:text-brand transition-colors disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  eml.xml only
                </button>
              </div>

              <button
                type="button"
                onClick={() => setPackageContentsOpen((v) => !v)}
                className="text-[10px] text-slate-400 hover:text-brand mono-text uppercase flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {packageContentsOpen ? "expand_less" : "expand_more"}
                </span>
                Advanced: View Package Contents
              </button>
              {packageContentsOpen && (
                <ul className="text-[11px] text-slate-500 mono-text space-y-0.5 pl-1">
                  {PACKAGE_FILES.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {step === 3 && (
            <section className="bg-white border border-surface-dim shadow-hard p-5 space-y-4">
              <h2 className="font-label-caps text-[11px] text-secondary uppercase tracking-widest font-bold">
                Publish to {linkedOrg?.ipt_instance_name || "Your IPT"}
              </h2>

              <p className="text-[10px] text-slate-500 mono-text uppercase tracking-widest font-bold">
                Publication Instructions
              </p>
              <ol className="list-decimal list-inside space-y-2 text-xs text-slate-600 leading-relaxed">
                <li>
                  Log in to {linkedOrg?.ipt_instance_name || "your IPT"}: <PublisherLinks org={linkedOrg} />
                </li>
                <li>Create a new resource and set its type to <strong>Checklist Dataset</strong>.</li>
                <li>
                  Choose <strong>Import existing Darwin Core Archive</strong> and upload the package you downloaded
                  in the previous step.
                </li>
                <li>IPT reads the metadata from the package automatically — review it on the resource&apos;s overview page.</li>
                <li>Click <strong>Publish</strong>, then <strong>Register</strong> to send the dataset to GBIF.org.</li>
                <li>Copy the dataset&apos;s URL and paste it in the next step.</li>
              </ol>

              <button
                type="button"
                onClick={() => setMappingHelpOpen((v) => !v)}
                className="text-[10px] text-slate-400 hover:text-brand mono-text uppercase flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {mappingHelpOpen ? "expand_less" : "expand_more"}
                </span>
                Manual Darwin Core Mapping
              </button>
              {mappingHelpOpen && (
                <div className="border border-amber-200 bg-amber-50 rounded-sm px-3 py-2.5 space-y-2 text-xs text-slate-600 leading-relaxed">
                  <p>
                    Most IPT versions read the whole package automatically on import. If yours left the resource
                    type, core, or extensions blank, map them by hand instead:
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5">
                    <li>
                      Set the data type to <strong>Checklist Data</strong>, then under <strong>Source files</strong>{" "}
                      add <code className="mono-text bg-surface-container-low px-1">taxon.txt</code>,{" "}
                      <code className="mono-text bg-surface-container-low px-1">vernacularname.txt</code>,{" "}
                      <code className="mono-text bg-surface-container-low px-1">distribution.txt</code>,{" "}
                      <code className="mono-text bg-surface-container-low px-1">resourcerelationship.txt</code>, and{" "}
                      <code className="mono-text bg-surface-container-low px-1">multimedia.txt</code> one at a time.
                    </li>
                    <li>
                      Under <strong>Darwin Core mapping</strong>, map{" "}
                      <code className="mono-text bg-surface-container-low px-1">taxon.txt</code> as the{" "}
                      <strong>Core</strong> (Taxon), and each of the other four files as an{" "}
                      <strong>Extension</strong> on the row matching its name.
                    </li>
                    <li>
                      Column headers already match Darwin Core term names, so IPT&apos;s &quot;auto-map&quot; should
                      still fill most fields once you point it at the right file — confirm it rather than retyping.
                    </li>
                    <li>
                      For metadata, use the resource&apos;s <strong>Upload</strong>/<strong>Import</strong> action to
                      load <code className="mono-text bg-surface-container-low px-1">eml.xml</code> instead of
                      retyping title, abstract, and contacts by hand.
                    </li>
                  </ol>
                </div>
              )}

              <div className="pt-2 border-t border-surface-dim flex items-center justify-between gap-3">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Done with the steps above but don&apos;t have the dataset&apos;s URL yet? Mark it as submitted —
                  GBIF can take a while to register a freshly-published resource. This checklist will show as
                  &quot;Review&quot; on your checklist list until you come back and add the URL.
                </p>
                <button
                  type="button"
                  onClick={() => markSubmittedForReview.mutate()}
                  disabled={markSubmittedForReview.isPending || !!metadata?.ipt_submitted_at}
                  className="shrink-0 px-3 py-1.5 bg-white border border-surface-dim text-secondary text-[10px] mono-text font-bold uppercase rounded-sm hover:border-brand hover:text-brand transition-colors disabled:opacity-50"
                >
                  {metadata?.ipt_submitted_at
                    ? "Submitted"
                    : markSubmittedForReview.isPending
                      ? "Marking..."
                      : "Submitted for Review"}
                </button>
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="bg-white border border-surface-dim shadow-hard p-5 space-y-4">
              <h2 className="font-label-caps text-[11px] text-secondary uppercase tracking-widest font-bold">
                Dataset Registration
              </h2>
              <p className="text-xs text-slate-500">
                Paste the dataset&apos;s URL from your IPT or from GBIF.org and we&apos;ll fetch the rest.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://ipt.example.org/resource?r=my_checklist"
                  value={datasetUrl}
                  onChange={(e) => setDatasetUrl(e.target.value)}
                  className="flex-1 border border-surface-dim rounded-sm px-2 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={handleFetchDetails}
                  disabled={!datasetUrl.trim() || resolveDataset.isPending}
                  className="bg-brand text-white px-3 py-1.5 rounded-sm font-label-caps text-[10px] uppercase disabled:opacity-50"
                >
                  {resolveDataset.isPending ? "Fetching..." : "Fetch Publication Details"}
                </button>
              </div>
              {resolveDataset.isError && (
                <p className="text-[11px] text-error mono-text">
                  {resolveDataset.error instanceof Error ? resolveDataset.error.message : "Failed to fetch details."}
                </p>
              )}

              {gbifDatasetUuid && (
                <div className="border border-green-200 bg-green-50 rounded-sm px-3 py-2 space-y-1 text-[11px] mono-text">
                  <div>
                    <span className="text-slate-500">Dataset UUID:</span> <span className="font-bold">{gbifDatasetUuid}</span>
                  </div>
                  {gbifDoi && (
                    <div>
                      <span className="text-slate-500">DOI:</span> <span className="font-bold">{gbifDoi}</span>
                    </div>
                  )}
                  {gbifPublicationYear && (
                    <div>
                      <span className="text-slate-500">Year:</span> <span className="font-bold">{gbifPublicationYear}</span>
                    </div>
                  )}
                  {gbifCitation && <div className="text-slate-600">{gbifCitation}</div>}
                </div>
              )}

              <button
                type="button"
                onClick={() => setManualEntryOpen((v) => !v)}
                className="text-[10px] text-slate-400 hover:text-brand mono-text uppercase flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {manualEntryOpen ? "expand_less" : "expand_more"}
                </span>
                Couldn&apos;t fetch automatically? Enter details manually
              </button>
              {manualEntryOpen && (
                <div className="grid grid-cols-2 gap-3">
                  <LabeledInput label="GBIF Dataset UUID" value={gbifDatasetUuid} onChange={setGbifDatasetUuid} />
                  <LabeledInput label="DOI" value={gbifDoi} onChange={setGbifDoi} />
                  <LabeledInput label="Publication Year" value={gbifPublicationYear} onChange={setGbifPublicationYear} />
                  <LabeledInput label="Citation" value={gbifCitation} onChange={setGbifCitation} className="col-span-2" />
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleFinish}
                  disabled={!canFinish || saveMetadata.isPending || publishChecklist.isPending}
                  title={!canFinish ? "Fetch or enter the GBIF dataset UUID or DOI first." : undefined}
                  className="bg-brand text-white px-5 py-2.5 rounded-sm font-label-caps text-[11px] uppercase shadow-hard hover:translate-y-[-1px] transition-transform disabled:opacity-50"
                >
                  {saveMetadata.isPending || publishChecklist.isPending ? "Finishing..." : "Complete Publication"}
                </button>
              </div>
            </section>
          )}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              className="px-3 py-1.5 bg-white border border-surface-dim text-secondary text-[10px] mono-text font-bold uppercase rounded-sm disabled:opacity-30"
            >
              Back
            </button>
            {step < STEPS.length - 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                disabled={!canAdvance[step]}
                className="px-3 py-1.5 bg-brand text-white text-[10px] mono-text font-bold uppercase rounded-sm disabled:opacity-40"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </main>

      {publisherHelpOpen && <PublisherHelpDialog onClose={() => setPublisherHelpOpen(false)} />}
    </div>
  );
}

function PublisherHelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-6" onClick={onClose}>
      <div
        className="max-w-2xl bg-white border border-surface-dim rounded-sm shadow-hard w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="mono-text text-sm font-bold uppercase tracking-wider text-slate-700">Why we ask this</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-brand">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          GBIF needs to know who&apos;s behind every dataset it hosts. The &quot;publishing organization&quot; you
          pick here is used for three things:
        </p>
        <ul className="space-y-2 text-xs text-slate-600">
          <li className="flex gap-2">
            <span className="material-symbols-outlined text-[16px] text-brand">verified</span>
            <span>
              <strong>Ownership</strong> — who the dataset officially belongs to.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="material-symbols-outlined text-[16px] text-brand">badge</span>
            <span>
              <strong>Attribution</strong> — who gets credited whenever this checklist is cited.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="material-symbols-outlined text-[16px] text-brand">how_to_reg</span>
            <span>
              <strong>GBIF endorsement</strong> — GBIF requires every publisher to be endorsed by a national or
              thematic &quot;node&quot; before its data can go live; that endorsement is tied to this organization,
              not to any one checklist.
            </span>
          </li>
        </ul>
        <p className="text-xs text-slate-600 leading-relaxed">
          It doesn&apos;t have to be a large institution — a university department, an NGO, or even
          &quot;Personal Project&quot; if you&apos;re publishing independently are all fine. Examples: ATREE,
          ICIMOD, WII, University of Calcutta, Personal Project.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full bg-brand text-white px-4 py-2 rounded-sm font-label-caps text-[11px] uppercase"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

// The IPT site URL is *derived* from a feed endpoint (strip "rss.do") and
// can go stale or wrong — proven in practice (ICIMOD's HKH-BIF resolved to
// a dead :8080 URL). GBIF's own publisher page is always reachable for any
// registered org, so that's one link in this UI a user can always trust —
// never the derived ipt_instance_url. The org's own homepage (as registered
// with GBIF) is a second, independently reliable link to the same effect.
function reliablePublisherUrl(org: PublishingOrganization | null): string | null {
  return org?.gbif_registry_org_uuid ? `https://www.gbif.org/publisher/${org.gbif_registry_org_uuid}` : null;
}

function PublisherLinks({ org }: { org: PublishingOrganization | null }) {
  const gbifUrl = reliablePublisherUrl(org);
  const websiteUrl = org?.website || null;

  if (!gbifUrl && !websiteUrl) {
    return <span className="text-[10px] text-slate-400 mono-text">Re-select your partner below to refresh these links</span>;
  }

  return (
    <span className="flex items-center gap-2 shrink-0">
      {gbifUrl && (
        <a href={gbifUrl} target="_blank" rel="noreferrer" className="text-[10px] text-brand underline mono-text">
          GBIF
        </a>
      )}
      {websiteUrl && (
        <a href={websiteUrl} target="_blank" rel="noreferrer" className="text-[10px] text-brand underline mono-text">
          Website
        </a>
      )}
    </span>
  );
}

/** "ZZ" is GBIF's code for organizations not tied to one country (regional/international bodies like ICIMOD) — show that plainly instead of a raw code. */
function formatPublisherLocation(ipt: IptInstallation): string {
  const countryLabel = !ipt.organizationCountry || ipt.organizationCountry === "ZZ"
    ? "International"
    : ISO_COUNTRIES.find((c) => c.code === ipt.organizationCountry)?.name ?? ipt.organizationCountry;
  return ipt.organizationCity ? `${ipt.organizationCity}, ${countryLabel}` : countryLabel;
}

function PartnerRow({
  ipt,
  canSelect,
  onSelect,
}: {
  ipt: IptInstallation;
  canSelect: boolean;
  onSelect: (ipt: IptInstallation) => void;
}) {
  return (
    <li className="border border-surface-dim rounded-sm px-3 py-2.5 flex items-center justify-between gap-3">
      <div>
        <div className="text-xs font-bold">{ipt.organizationName}</div>
        <div className="text-[10px] text-slate-500 mono-text">
          {ipt.installationTitle} · {formatPublisherLocation(ipt)}
          {ipt.numPublishedDatasets > 0
            ? ` · accepts checklist datasets (${ipt.numPublishedDatasets} published)`
            : " · new publisher"}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <a
          href={ipt.requestAccessUrl}
          target="_blank"
          rel="noreferrer"
          className="px-2 py-1 bg-white border border-surface-dim text-secondary text-[10px] mono-text font-bold uppercase rounded-sm hover:border-brand hover:text-brand transition-colors"
        >
          Request Access
        </a>
        {canSelect && (
          <button
            type="button"
            onClick={() => onSelect(ipt)}
            className="px-2 py-1 bg-brand text-white text-[10px] mono-text font-bold uppercase rounded-sm"
          >
            Select
          </button>
        )}
      </div>
    </li>
  );
}

function StepIndicator({ step, onSelect }: { step: number; onSelect: (i: number) => void }) {
  return (
    <div className="flex items-center justify-between">
      {STEPS.map((label, i) => (
        <button
          key={label}
          type="button"
          onClick={() => onSelect(i)}
          className="flex-1 flex flex-col items-center gap-1 group"
        >
          <span
            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] mono-text font-bold ${
              i === step ? "bg-brand text-white" : i < step ? "bg-green-100 text-green-700" : "bg-surface-container-low text-slate-400"
            }`}
          >
            {i < step ? "✓" : i + 1}
          </span>
          <span className={`text-[9px] mono-text uppercase ${i === step ? "text-brand font-bold" : "text-slate-400"}`}>{label}</span>
        </button>
      ))}
    </div>
  );
}

function ReadinessRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`material-symbols-outlined text-[16px] ${ok ? "text-green-600" : "text-slate-300"}`}>
        {ok ? "check_circle" : "radio_button_unchecked"}
      </span>
      <span className={ok ? "text-on-surface" : "text-slate-400"}>{label}</span>
    </div>
  );
}

function StatusRow({
  label,
  value,
  ok,
  children,
}: {
  label: string;
  value: string;
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`border rounded-sm px-3 py-2 flex items-center justify-between gap-3 ${ok ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
      <div className="flex items-center gap-2">
        <span className={`material-symbols-outlined text-[16px] ${ok ? "text-green-600" : "text-amber-600"}`}>
          {ok ? "check_circle" : "schedule"}
        </span>
        <span className="mono-text text-[11px] font-bold">{label}</span>
        <span className="mono-text text-[10px] text-slate-500">{value}</span>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[10px] uppercase font-bold text-secondary mono-text">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-surface-dim rounded-sm px-2 py-1.5 text-xs"
      />
    </label>
  );
}
