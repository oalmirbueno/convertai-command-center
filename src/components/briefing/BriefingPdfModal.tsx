import { useRef } from "react";
import { X, Download, Printer } from "lucide-react";
import { QUESTIONS } from "./questions";

interface Props {
  open: boolean;
  onClose: () => void;
  briefing: any;
  clientName?: string;
}

const BLOCK_ORDER = ["empresa", "presenca", "objetivos", "publico", "investimento"];
const BLOCK_LABELS: Record<string, string> = {
  empresa: "Sobre a Empresa",
  presenca: "Presença Digital Atual",
  objetivos: "Objetivos e Metas",
  publico: "Público e Mercado",
  investimento: "Investimento e Expectativas",
};

export default function BriefingPdfModal({ open, onClose, briefing, clientName }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  if (!open || !briefing) return null;

  const responses = (briefing.responses || {}) as Record<string, any>;
  const date = briefing.created_at
    ? new Date(briefing.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })
    : "";

  // Group questions by block
  const blocks: Record<string, { question: string; answer: string }[]> = {};
  QUESTIONS.forEach((q) => {
    const val = responses[q.key];
    if (!val && val !== 0) return;
    const answer = Array.isArray(val) ? val.join(", ") : String(val);
    if (!blocks[q.block]) blocks[q.block] = [];
    blocks[q.block].push({ question: q.question, answer });
  });

  // Also include any legacy fields not in QUESTIONS
  const legacyFields = [
    { key: "objetivo", label: "Objetivo" },
    { key: "publicoAlvo", label: "Público-alvo" },
    { key: "referencias", label: "Referências" },
    { key: "prazo", label: "Prazo" },
    { key: "orcamento", label: "Orçamento" },
    { key: "observacoes", label: "Observações" },
  ];
  const legacyEntries: { question: string; answer: string }[] = [];
  legacyFields.forEach((f) => {
    const val = responses[f.key];
    if (!val) return;
    // Only add if not already captured by QUESTIONS
    const alreadyCaptured = QUESTIONS.some((q) => q.key === f.key);
    if (!alreadyCaptured) {
      legacyEntries.push({ question: f.label, answer: String(val) });
    }
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-2xl w-full max-w-[700px] mx-4 max-h-[90vh] flex flex-col" style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border no-print">
          <h2 className="text-sm font-semibold text-foreground">Diagnóstico Estratégico</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-muted-foreground border border-border hover:text-foreground hover:border-muted-foreground/50 transition-colors cursor-pointer bg-transparent"
            >
              <Download className="w-3.5 h-3.5" /> Baixar PDF
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Content */}
        <div ref={printRef} className="flex-1 overflow-y-auto print-report">
          <div className="px-8 py-8 space-y-8">
            {/* PDF Header with Branding */}
            <div className="text-center space-y-3 pb-6 border-b border-border">
              <div className="inline-flex items-center gap-1.5">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <span className="text-sm font-bold text-primary-foreground">A</span>
                </div>
                <span className="text-lg font-semibold text-foreground tracking-tight">
                  Aceler<span className="text-primary">iq</span>
                </span>
              </div>
              <h1 className="text-xl font-semibold text-foreground">Diagnóstico Estratégico</h1>
              <div className="flex items-center justify-center gap-3 text-[12px] text-muted-foreground">
                {clientName && <span className="font-medium text-foreground">{clientName}</span>}
                {clientName && date && <span>•</span>}
                {date && <span>{date}</span>}
              </div>
              <div className="w-16 h-0.5 bg-primary mx-auto mt-3 rounded-full" />
            </div>

            {/* Contact info if present */}
            {responses.contato && (
              <div className="bg-secondary/50 border border-border rounded-xl p-5 space-y-2">
                <p className="text-[11px] uppercase tracking-wider text-primary font-semibold">Dados de Contato</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {responses.contato.nome && (
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Nome</p>
                      <p className="text-sm text-foreground">{responses.contato.nome}</p>
                    </div>
                  )}
                  {responses.contato.whatsapp && (
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">WhatsApp</p>
                      <p className="text-sm text-foreground">{responses.contato.whatsapp}</p>
                    </div>
                  )}
                  {responses.contato.email && (
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Email</p>
                      <p className="text-sm text-foreground">{responses.contato.email}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Blocks */}
            {BLOCK_ORDER.map((blockKey) => {
              const items = blocks[blockKey];
              if (!items || items.length === 0) return null;
              return (
                <div key={blockKey} className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-1.5 h-6 rounded-full bg-primary" />
                    <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
                      {BLOCK_LABELS[blockKey]}
                    </h2>
                  </div>
                  <div className="space-y-3 pl-5">
                    {items.map((item, i) => (
                      <div key={i} className="bg-secondary/30 border border-border/50 rounded-xl p-4">
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">{item.question}</p>
                        <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{item.answer}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Legacy fields */}
            {legacyEntries.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-6 rounded-full bg-primary" />
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Informações Adicionais</h2>
                </div>
                <div className="space-y-3 pl-5">
                  {legacyEntries.map((item, i) => (
                    <div key={i} className="bg-secondary/30 border border-border/50 rounded-xl p-4">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">{item.question}</p>
                      <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{item.answer}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="text-center pt-6 border-t border-border">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                Documento gerado pela Aceler<span className="text-primary">iq</span> • Consultoria de Marketing Digital
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
