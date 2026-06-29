"use client";

import { useState } from "react";

interface AvatarProps {
  src?: string | null;
  alt?: string;
  className?: string;
  iconClassName?: string;
}

export default function Avatar({ src, alt = "Profile", className, iconClassName }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span className={`material-symbols-outlined ${iconClassName ?? "text-slate-500 text-[32px]"}`}>
        account_circle
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt}
      className={className ?? "w-full h-full object-cover"}
      src={src}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
