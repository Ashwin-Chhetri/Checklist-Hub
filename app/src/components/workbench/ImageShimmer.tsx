/** Shimmer placeholder for a species photo that's still being fetched —
 * shared between the workbench Evidence gallery (TaxonomyPanel) and the
 * region List view's family thumbnails (FamilyListView), so both read as
 * the same "loading" state rather than each inventing their own. */
export default function ImageShimmer({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-[#efece1] ${className}`}>
      <div
        className="absolute inset-0 animate-shimmer-sweep"
        style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.65), transparent)" }}
      />
    </div>
  );
}
