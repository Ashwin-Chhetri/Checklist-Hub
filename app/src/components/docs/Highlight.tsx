export default function Highlight({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-primary font-semibold underline decoration-primary/50 decoration-2 underline-offset-2">
      {children}
    </span>
  );
}
