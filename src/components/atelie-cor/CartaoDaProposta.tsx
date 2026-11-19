import { useState } from "react";
import { ArrowLeftRight, Check, Copy, FlaskConical, Pencil, Star } from "lucide-react";
import { toast } from "sonner";
import { Card, Chip } from "@/components/ds";
import { botao, juntar, texto } from "@/components/sistema";
import { apca, contraste, hexValido, nivelWcag, textoOklch } from "../../../supabase/functions/_shared/cores/oklch";
import { PESO_DO_PAPEL, ROTULO_DA_ESTRUTURA, ROTULO_DO_PAPEL, type PapelNaProposta, type Proposta } from "../../../supabase/functions/_shared/cores/paleta";
import type { TextosDaIa } from "./api";

const fmt = (n: number) => n.toFixed(2).replace(".", ",");

/** Faixa 60-30-10 da proposta (as cores na proporção em que entram na peça). */
export function FaixaDaPaleta({ p, alta = "h-20" }: { p: Proposta; alta?: string }) {
  return (
    <div className={juntar("flex overflow-hidden rounded-md", alta)} aria-label="Proporção das cores">
      {p.cores.map((c) => (
        <div key={c.papel} className="flex items-end p-2 text-[11px] font-medium" style={{ flex: PESO_DO_PAPEL[c.papel], background: c.hex, color: c.texto }} title={`${c.nome} ${c.hex}`}>
          {PESO_DO_PAPEL[c.papel] >= 10 ? c.hex : ""}
        </div>
      ))}
    </div>
  );
}

export default function CartaoDaProposta({
  p, ordem, escolhida, textos, onEscolher, onTrocar, onTrocarPapeis, onLaboratorio, onFavoritar,
}: {
  p: Proposta;
  ordem: number;
  escolhida: boolean;
  textos?: TextosDaIa | null;
  onEscolher: () => void;
  onTrocar: (papel: PapelNaProposta, hex: string) => void;
  onTrocarPapeis: (a: PapelNaProposta, b: PapelNaProposta) => void;
  onLaboratorio: () => void;
  onFavoritar?: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [aberto, setAberto] = useState<PapelNaProposta | null>(null);
  const ia = textos?.propostas?.[p.id];
  const nota = textos?.notas?.[p.id];
  const dom = p.cores.find((c) => c.papel === "dominante")!;
  const des = p.cores.find((c) => c.papel === "destaque");

  const copiar = async () => {
    const linhas = p.cores.map((c) => `${c.nome} (${ROTULO_DO_PAPEL[c.papel]}): ${c.hex}`).join("\n");
    try { await navigator.clipboard.writeText(linhas); toast.success("Códigos copiados"); } catch { toast.error("Não deu para copiar."); }
  };

  return (
    <Card
      className={juntar(escolhida && "ring-2 ring-primary")}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {ia?.titulo || p.titulo}
          {ordem === 0 && <Chip tone="accent">Recomendada</Chip>}
          {escolhida && <Chip tone="success" dot>Escolhida</Chip>}
          {typeof nota === "number" && <Chip tone="info" title="Nota do Jev contra o briefing (1 a 5)">Jev {fmt(nota).replace(",0", "")}/5</Chip>}
        </span>
      }
      subtitle={ia?.frase || p.frase}
      action={escolhida ? undefined : <button type="button" className={botao.primario} onClick={onEscolher}><Check className="mr-1.5 h-4 w-4" />Escolher</button>}
      menu={[
        { label: "Testar no laboratório", icon: <FlaskConical className="h-4 w-4" />, onSelect: onLaboratorio },
        { label: editando ? "Concluir edição" : "Editar cores", icon: <Pencil className="h-4 w-4" />, onSelect: () => setEditando((v) => !v) },
        { label: "Trocar dominante e apoio", icon: <ArrowLeftRight className="h-4 w-4" />, onSelect: () => onTrocarPapeis("dominante", "apoio") },
        { label: "Copiar códigos", icon: <Copy className="h-4 w-4" />, onSelect: copiar },
        onFavoritar ? { label: "Guardar nos favoritos", icon: <Star className="h-4 w-4" />, onSelect: onFavoritar } : null,
      ]}
    >
      <div className="space-y-4">
        <FaixaDaPaleta p={p} />
        <div className="flex flex-wrap gap-1.5">
          <Chip>{ROTULO_DA_ESTRUTURA[p.estrutura]}</Chip>
          <Chip>{p.etiquetas.temperatura}</Chip>
          <Chip>{p.etiquetas.intensidade}</Chip>
          <Chip tone={p.etiquetas.contraste === "Contraste alto" ? "success" : p.etiquetas.contraste === "Contraste médio" ? "info" : "warning"}>{p.etiquetas.contraste}</Chip>
        </div>

        <p className={texto.corpo}>{ia?.diagnostico || p.diagnostico}</p>

        <ul className="divide-y divide-border/60">
          {p.cores.map((c) => (
            <li key={c.papel} className="py-2.5">
              <div className="flex items-center gap-3">
                <label className="relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border" style={{ background: c.hex }} title={editando ? "Trocar a cor" : c.hex}>
                  {editando && (
                    <input type="color" aria-label={`Trocar ${c.nome}`} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={c.hex.toLowerCase()} onChange={(e) => onTrocar(c.papel, e.target.value)} />
                  )}
                </label>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[13px] font-semibold">{c.nome}</span>
                    <span className={texto.etiqueta + " text-muted-foreground"}>{ROTULO_DO_PAPEL[c.papel]} · {PESO_DO_PAPEL[c.papel]}%{c.fixa ? " · cor da marca" : ""}</span>
                  </div>
                  {editando ? (
                    <input
                      aria-label={`HEX de ${c.nome}`}
                      defaultValue={c.hex}
                      onBlur={(e) => { const h = hexValido(e.target.value); if (h && h !== c.hex) onTrocar(c.papel, h); }}
                      className="mt-0.5 h-7 w-28 rounded-md border border-input bg-card px-2 font-mono text-[12px]"
                    />
                  ) : (
                    <button type="button" className="font-mono text-[12px] text-muted-foreground hover:text-foreground" onClick={() => navigator.clipboard?.writeText(c.hex).then(() => toast.success(`${c.hex} copiado`))}>
                      {c.hex} · {textoOklch(c.hex)}
                    </button>
                  )}
                </div>
                <span className="hidden shrink-0 rounded-md px-2 py-1 text-[12px] font-semibold sm:inline" style={{ background: c.hex, color: c.texto }} title={`Texto ${c.texto} sobre ${c.nome}`}>
                  Aa {fmt(c.razaoTexto)}
                </span>
              </div>
              <button type="button" className="mt-1 text-[12px] text-muted-foreground hover:text-foreground" onClick={() => setAberto(aberto === c.papel ? null : c.papel)}>
                {aberto === c.papel ? "Fechar" : "Por que esta cor e onde usar"}
              </button>
              {aberto === c.papel && (
                <div className="mt-1 space-y-1 rounded-md bg-muted/60 p-2.5 text-[12px] leading-5">
                  <p>{ia?.cores?.[c.papel] || c.porque}</p>
                  <p className="text-muted-foreground">{c.uso}</p>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="grid gap-1.5 text-[12px] sm:grid-cols-2">
          <div className="flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-2">
            <span className="rounded px-1.5 font-semibold" style={{ background: dom.hex, color: dom.texto }}>Aa</span>
            Texto na dominante: {fmt(dom.razaoTexto)}:1 · {nivelWcag(dom.razaoTexto)}
          </div>
          {des && (
            <div className="flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-2">
              <span className="h-4 w-6 rounded-full" style={{ background: des.hex, outline: `3px solid ${dom.hex}` }} />
              Botão sobre a dominante: {fmt(contraste(des.hex, dom.hex))}:1 · APCA Lc {Math.round(Math.abs(apca(des.texto, des.hex)))}
            </div>
          )}
        </div>

        <details className="text-[12px]">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Como aplicar</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {p.orientacoes.map((o, i) => <li key={i}>{o}</li>)}
          </ul>
          <p className="mt-2 text-muted-foreground">Neutros de apoio (não contam como cor da marca): tinta {p.neutros.tinta}, papel {p.neutros.papel}, cinza {p.neutros.cinza}.</p>
        </details>
      </div>
    </Card>
  );
}
