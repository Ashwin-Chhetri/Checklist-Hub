"use client";

export interface ExpectedColumnsHelpProps {
  /** Smaller typeface/spacing for use in compact contexts (e.g. the wizard's Import step). */
  compact?: boolean;
}

/** Static "what columns a species CSV upload should have" help block, shared by the wizard and the Add Species dialog. */
export function ExpectedColumnsHelp({ compact = false }: ExpectedColumnsHelpProps) {
  const textSize = compact ? "text-xs" : "text-sm";
  const badgeSize = compact ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5";
  const minWidth = compact ? "min-w-[110px]" : "min-w-[140px]";

  return (
    <div className={`${textSize} text-on-surface-variant`}>
      <p className={`font-semibold ${textSize} text-on-surface ${compact ? "mb-1.5" : "mb-3"}`}>Expected Columns</p>

      <ul className={compact ? "space-y-1" : "space-y-2"}>
        <li className="flex items-center gap-2">
          <span className={`font-medium text-on-surface ${minWidth}`}>Scientific Name</span>
          <span className={`rounded-full font-medium bg-primary-container text-on-primary-container ${badgeSize}`}>
            Required
          </span>
        </li>

        <li className="flex items-center gap-2">
          <span className={`font-medium text-on-surface ${minWidth}`}>Common Name</span>
          <span className={`rounded-full font-medium bg-surface-container-high text-on-surface-variant ${badgeSize}`}>
            Optional
          </span>
        </li>

        <li className="flex items-center gap-2">
          <span className={`font-medium text-on-surface ${minWidth}`}>Occurrence Count</span>
          <span className={`rounded-full font-medium bg-surface-container-high text-on-surface-variant ${badgeSize}`}>
            Optional
          </span>
          <span className={compact ? "text-[10px]" : "text-xs"}>Non-negative integer</span>
        </li>

        <li className="flex items-start gap-2">
          <span className={`font-medium text-on-surface ${minWidth}`}>Event Date</span>
          <span className={`rounded-full font-medium bg-surface-container-high text-on-surface-variant ${badgeSize}`}>
            Optional
          </span>
          <span className={compact ? "text-[10px]" : "text-xs"}>2024-01-15, 15/01/2024, or 2024</span>
        </li>
      </ul>
    </div>
  );
}
