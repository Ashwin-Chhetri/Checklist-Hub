"use client";

interface EvidenceStrengthDialogProps {
  onClose: () => void;
}

export default function EvidenceStrengthDialog({ onClose }: EvidenceStrengthDialogProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white border border-surface-dim rounded-sm shadow-hard w-[30rem] max-w-[90vw] p-5 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="mono-text text-sm font-bold uppercase tracking-wider text-slate-700">
            Evidence Strength
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-brand">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed mb-3">
          Each species gets a score built from its active evidence sources, then the score maps
          to a HIGH, MEDIUM, or LOW rating:
        </p>

        <ul className="text-xs text-slate-600 leading-relaxed mb-3 list-disc pl-4 space-y-1">
          <li>
            <span className="font-bold text-on-surface">Source type:</span> literature and eBird
            records (eBird only counts for birds) each contribute 3 points; GBIF and iNaturalist
            records contribute 2 points; legacy records contribute 0.
          </li>
          <li>
            <span className="font-bold text-on-surface">Occurrence volume:</span> a source adds
            +1 point past 20 occurrences and +2 points past 100.
          </li>
          <li>
            <span className="font-bold text-on-surface">Independent corroboration:</span> each
            additional independent source beyond the first adds +1 point.
          </li>
        </ul>

        <div className="mono-text text-[10px] text-slate-500 space-y-1 mb-1">
          <div className="flex items-center gap-2">
            <span className="status-pill bg-green-100 text-green-700 font-bold text-[9px]">HIGH</span>
            <span>score of 6 or more</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="status-pill bg-amber-100 text-amber-700 font-bold text-[9px]">MEDIUM</span>
            <span>score of 3 to 5</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="status-pill bg-red-100 text-red-700 font-bold text-[9px]">LOW</span>
            <span>score below 3</span>
          </div>
        </div>
      </div>
    </div>
  );
}
