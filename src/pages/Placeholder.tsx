import { Construction } from "lucide-react";

export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] animate-fade-in">
      <Construction className="w-16 h-16 text-primary opacity-10 mb-6" />
      <h1 className="heading-mc text-foreground mb-2">{title}</h1>
      <p className="text-[13px] text-muted-foreground opacity-40">Em construção — Fase 2</p>
    </div>
  );
}
