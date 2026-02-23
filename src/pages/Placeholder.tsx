import { Construction } from "lucide-react";

export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] animate-fade-in">
      <Construction className="w-12 h-12 text-muted-foreground/20 mb-4" />
      <p className="text-sm text-muted-foreground">Em construção</p>
      <p className="text-xs text-muted-foreground/50 mt-1">{title} — Fase 2</p>
    </div>
  );
}
