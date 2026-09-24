import { useState, type ReactNode } from "react";
import { AlertTriangle, Archive, ArchiveRestore, Check, ClipboardList, Loader2, PenLine, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BotaoComCusto } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { partesDoPlanoV2, type Oferta, type StatusDaOferta } from "./adsApi";
import { BarraDeNota, BarraDePolitica } from "./Comuns";

/**
 * Uma oferta proposta pelo agente (ou editada pela equipe): promessa em
 * destaque, o que entra, bônus, garantia, urgência real e CTA, com as notas
 * do Jev (clareza, força e risco de política). Ações: Escolher, Editar,
 * Arquivar, Aplicar no briefing e Criar criativos desta oferta.
 */

const linhas = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

function Bloco({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <div className="mt-0.5 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}

function Lista({ itens }: { itens: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {itens.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

const STATUS: Record<StatusDaOferta, { rotulo: string; tom: string }> = {
  rascunho: { rotulo: "Proposta", tom: "bg-secondary text-muted-foreground" },
  escolhida: { rotulo: "Escolhida", tom: "bg-success/10 text-success" },
  arquivada: { rotulo: "Arquivada", tom: "bg-secondary text-muted-foreground" },
};

type Rascunho = {
  nome: string;
  para_quem: string;
  promessa: string;
  mecanismo: string;
  entregaveis: string;
  bonus: string;
  garantia: string;
  urgencia_real: string;
  ancoragem: string;
  cta: string;
  provas_necessarias: string;
  riscos: string;
};

const paraRascunho = (o: Oferta): Rascunho => ({
  nome: o.nome,
  para_quem: o.para_quem,
  promessa: o.promessa,
  mecanismo: o.mecanismo,
  entregaveis: o.entregaveis.join("\n"),
  bonus: o.bonus.join("\n"),
  garantia: o.garantia || "",
  urgencia_real: o.urgencia_real || "",
  ancoragem: o.ancoragem || "",
  cta: o.cta,
  provas_necessarias: o.provas_necessarias.join("\n"),
  riscos: o.riscos.join("\n"),
});

/** Rascunho editado de volta para a oferta (listas por linha, vazio vira nulo). */
export function ofertaDoRascunho(o: Oferta, r: Rascunho): Oferta {
  return {
    ...o,
    nome: r.nome.trim() || o.nome,
    para_quem: r.para_quem.trim(),
    promessa: r.promessa.trim(),
    mecanismo: r.mecanismo.trim(),
    entregaveis: linhas(r.entregaveis),
    bonus: linhas(r.bonus),
    garantia: r.garantia.trim() || null,
    urgencia_real: r.urgencia_real.trim() || null,
    ancoragem: r.ancoragem.trim() || null,
    cta: r.cta.trim(),
    provas_necessarias: linhas(r.provas_necessarias),
    riscos: linhas(r.riscos),
  };
}

const CAMPOS: { chave: keyof Rascunho; rotulo: string; longo?: boolean; dica?: string }[] = [
  { chave: "nome", rotulo: "Nome da oferta" },
  { chave: "para_quem", rotulo: "Para quem" },
  { chave: "promessa", rotulo: "Promessa", longo: true },
  { chave: "mecanismo", rotulo: "Mecanismo (por que funciona)", longo: true },
  { chave: "entregaveis", rotulo: "O que entra", longo: true, dica: "Um por linha" },
  { chave: "bonus", rotulo: "Bônus", longo: true, dica: "Um por linha" },
  { chave: "garantia", rotulo: "Garantia" },
  { chave: "urgencia_real", rotulo: "Urgência real", dica: "Só se for verdade (vagas, data, lote)" },
  { chave: "ancoragem", rotulo: "Ancoragem de preço" },
  { chave: "cta", rotulo: "CTA" },
  { chave: "provas_necessarias", rotulo: "Provas necessárias", longo: true, dica: "Uma por linha" },
  { chave: "riscos", rotulo: "Riscos", longo: true, dica: "Um por linha" },
];

export default function CartaoDaOferta({
  oferta,
  nova,
  ocupada,
  onSalvar,
  onStatus,
  onAplicar,
  onCriar,
}: {
  oferta: Oferta;
  nova?: boolean;
  ocupada?: boolean;
  onSalvar: (o: Oferta) => Promise<void>;
  onStatus: (s: StatusDaOferta) => void;
  onAplicar: () => void;
  onCriar: () => void;
}) {
  const { catalogo } = useMesa();
  const [editando, setEditando] = useState<Rascunho | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [detalhes, setDetalhes] = useState(false);
  const o = oferta;
  const jev = o.jev;
  const st = STATUS[o.status];
  const arquivada = o.status === "arquivada";
  const temDetalhes = o.entregaveis.length > 0 || o.bonus.length > 0 || o.provas_necessarias.length > 0 || o.riscos.length > 0 || !!o.ancoragem;

  if (editando) {
    return (
      <article className="min-w-0 rounded-xl border border-primary/50 bg-card p-4" aria-label={`Editar a oferta ${o.nome}`}>
        <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Editar oferta</p>
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          {CAMPOS.map((c) => (
            <label key={c.chave} className={`block min-w-0 ${c.longo ? "sm:col-span-2" : ""}`}>
              <span className="mb-1 block text-[11.5px] font-medium text-foreground/80">
                {c.rotulo}
                {c.dica && <span className="ml-1.5 font-normal text-muted-foreground">({c.dica})</span>}
              </span>
              {c.longo ? (
                <Textarea aria-label={c.rotulo} className="min-h-[60px] text-[12.5px]" value={editando[c.chave]} onChange={(e) => { const v = e.target.value; setEditando((r) => (r ? { ...r, [c.chave]: v } : r)); }} />
              ) : (
                <Input aria-label={c.rotulo} className="h-9 text-[12.5px]" value={editando[c.chave]} onChange={(e) => { const v = e.target.value; setEditando((r) => (r ? { ...r, [c.chave]: v } : r)); }} />
              )}
            </label>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <Button type="button" size="sm" variant="ghost" className="mr-1 h-8" onClick={() => setEditando(null)} disabled={salvando}>
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={salvando}
            onClick={async () => {
              setSalvando(true);
              try {
                await onSalvar(ofertaDoRascunho(o, editando));
                setEditando(null);
              } catch {
                /* o aviso de erro já apareceu; o rascunho continua na tela */
              } finally {
                setSalvando(false);
              }
            }}
          >
            {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
            Salvar oferta
          </Button>
        </div>
      </article>
    );
  }

  return (
    <article
      className={`min-w-0 rounded-xl border bg-card p-4 transition-colors ${o.status === "escolhida" ? "border-success/50 ring-1 ring-success/30" : nova ? "border-primary/50" : "border-border"} ${arquivada ? "opacity-70" : ""}`}
      aria-label={`Oferta ${o.nome}`}
    >
      <div className="flex min-w-0 items-start">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center">
            <span className={`mb-1 mr-1.5 inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-medium ${st.tom}`}>{st.rotulo}</span>
            {nova && <span className="mb-1 mr-1.5 inline-flex h-5 items-center rounded-full bg-primary/10 px-2 text-[10.5px] font-medium text-primary">Nova</span>}
            {o.para_quem && <span className="mb-1 min-w-0 truncate text-[11.5px] text-muted-foreground">para {o.para_quem}</span>}
          </div>
          <h3 className="text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]">{o.nome}</h3>
        </div>
        {ocupada && <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
      </div>

      {o.promessa && <p className="mt-2 font-serif text-[18px] font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">{o.promessa}</p>}

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        {o.mecanismo && <Bloco rotulo="Mecanismo">{o.mecanismo}</Bloco>}
        {o.garantia && <Bloco rotulo="Garantia">{o.garantia}</Bloco>}
        {o.urgencia_real && <Bloco rotulo="Urgência real">{o.urgencia_real}</Bloco>}
        {o.cta && <Bloco rotulo="CTA">{o.cta}</Bloco>}
      </div>

      {temDetalhes && (
        <div className="mt-3">
          <button type="button" className="text-[12px] text-primary hover:underline" aria-expanded={detalhes} onClick={() => setDetalhes((v) => !v)}>
            {detalhes ? "Menos detalhes" : "O que entra, bônus e riscos"}
          </button>
          {detalhes && (
            <div className="mt-2 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              {o.entregaveis.length > 0 && <Bloco rotulo="O que entra"><Lista itens={o.entregaveis} /></Bloco>}
              {o.bonus.length > 0 && <Bloco rotulo="Bônus"><Lista itens={o.bonus} /></Bloco>}
              {o.ancoragem && <Bloco rotulo="Ancoragem">{o.ancoragem}</Bloco>}
              {o.provas_necessarias.length > 0 && <Bloco rotulo="Provas necessárias"><Lista itens={o.provas_necessarias} /></Bloco>}
              {o.riscos.length > 0 && <Bloco rotulo="Riscos"><Lista itens={o.riscos} /></Bloco>}
            </div>
          )}
        </div>
      )}

      {jev && jev.alerta_politica && (
        <p className="mt-3 flex items-start rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-[12px]" role="note">
          <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{jev.alerta_politica}</span>
        </p>
      )}

      {jev && (
        <div className="mt-3 grid grid-cols-3 gap-x-4 border-t border-border pt-3" aria-label="Notas do Jev da oferta">
          <BarraDeNota rotulo="Clareza" nota={jev.clareza} />
          <BarraDeNota rotulo="Força" nota={jev.forca} />
          <BarraDePolitica nota={jev.risco_politica} />
        </div>
      )}

      <div className="mt-3 flex min-w-0 flex-wrap items-center border-t border-border pt-3">
        {!arquivada && (
          <span className="mb-1.5 mr-1.5">
            <BotaoComCusto
              rotulo={<><Rocket className="mr-1 h-3.5 w-3.5" /> Criar criativos desta oferta</>}
              titulo="Criar criativos desta oferta"
              descricao="Leva para o Plano de teste e gera os ângulos desta oferta, já conferidos pelo Jev."
              className="h-8"
              fecharAoConfirmar
              disabled={ocupada}
              partes={() => partesDoPlanoV2(catalogo, 4)}
              executar={async () => {
                onCriar();
                return null;
              }}
            />
          </span>
        )}
        {o.status !== "escolhida" && !arquivada && (
          <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-8" disabled={ocupada} onClick={() => onStatus("escolhida")}>
            <Check className="mr-1 h-3.5 w-3.5" /> Escolher
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-8" disabled={ocupada} onClick={onAplicar} title="Preenche o briefing com esta oferta para você revisar e salvar">
          <ClipboardList className="mr-1 h-3.5 w-3.5" /> Aplicar no briefing
        </Button>
        <Button type="button" size="sm" variant="ghost" className="mb-1.5 mr-1.5 h-8" disabled={ocupada} onClick={() => setEditando(paraRascunho(o))}>
          <PenLine className="mr-1 h-3.5 w-3.5" /> Editar
        </Button>
        {arquivada ? (
          <Button type="button" size="sm" variant="ghost" className="mb-1.5 h-8" disabled={ocupada} onClick={() => onStatus("rascunho")}>
            <ArchiveRestore className="mr-1 h-3.5 w-3.5" /> Restaurar
          </Button>
        ) : (
          <Button type="button" size="sm" variant="ghost" className="mb-1.5 h-8 text-muted-foreground" disabled={ocupada} onClick={() => onStatus("arquivada")}>
            <Archive className="mr-1 h-3.5 w-3.5" /> Arquivar
          </Button>
        )}
      </div>
    </article>
  );
}
