import { HelpCircle } from "lucide-react";

interface HelpButtonProps {
  onClick: () => void;
}

export default function HelpButton({ onClick }: HelpButtonProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-5 right-5 z-[100] w-11 h-11 rounded-full bg-primary text-primary-foreground shadow-lg hover:scale-105 active:scale-95 transition-transform flex items-center justify-center cursor-pointer group"
      style={{
        boxShadow: "0 4px 20px hsl(var(--primary) / 0.4)",
      }}
      aria-label="Ajuda — Refazer o tour"
    >
      <HelpCircle className="w-5 h-5 group-hover:rotate-12 transition-transform" />
    </button>
  );
}
