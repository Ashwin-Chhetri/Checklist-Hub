export default function DocsBreadcrumb({ items }: { items: string[] }) {
  return (
    <p className="font-label-caps text-[11px] tracking-wider uppercase text-on-surface-variant mb-6 flex items-center gap-1.5">
      {items.map((item, i) => (
        <span key={item} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-outline-variant">/</span>}
          <span className={i === items.length - 1 ? "text-primary" : undefined}>{item}</span>
        </span>
      ))}
    </p>
  );
}
