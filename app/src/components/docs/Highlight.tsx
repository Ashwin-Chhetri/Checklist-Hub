export default function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-on-surface font-bold">
      {children}
    </span>
  );
}
