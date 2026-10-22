import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { textoDoErro } from "@/lib/mesa/api";
import { useMesa } from "./MesaContexto";
import type { BriefingDaCampanha, Campanha } from "./mesaV4Api";
import { briefingEstaVazio } from "./mesaV4Api";
import { campanhaSalvar, CANAIS_DA_CAMPANHA, normalizarBriefing, trocarCampanhaNoCache } from "./campanhasApi";
import { DIAS_MAX_CAMPANHA, diasEntreIso, periodoCurto } from "./mesaV4Api";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { SeletorDoTom } from "./CampanhaEditor";
import { ROTULO_DO_TOM, tomDaCampanha } from "../../../supabase/functions/agente-calendario/modulos/tom-da-campanha";

/**
 * Briefing da campanha (25/09): o que torna a campanha concreta. Produto(s) em
 * foco com o porquê, oferta, mensagem central, público, provas, tom e CTA. O
 * estrategista preenche ao criar; a equipe corrige aqui sem gastar
 * (campanha_salvar) e o que ela escreve vale sobre a sugestão da IA.
 */

const MAX_PRODUTOS = 5;

function Campo({ rotulo, id, children }: { rotulo: string; id?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-muted-foreground">{rotulo}</label>
      {children}
    </div>
  );
}

/** Formulário controlado do briefing (usado na campanha nova e na edição). */
export function FormularioDoBriefing({
  valor,
  onChange,
  prefixo = "briefing",
  desabilitado,
}: {
  valor: BriefingDaCampanha;
  onChange: (b: BriefingDaCampanha) => void;
  prefixo?: string;
  desabilitado?: boolean;
}) {
  const mudar = (parcial: Partial<BriefingDaCampanha>) => onChange({ ...valor, ...parcial });
  const produtos = valor.produtos.length ? valor.produtos : [{ nome: "", por_que: "" }];
  const mudarProduto = (i: number, campo: "nome" | "por_que", v: string) => {
    const lista = produtos.map((p, j) => (j === i ? { ...p, [campo]: v } : p));
    mudar({ produtos: lista });
  };
  return (
    <div className="min-w-0 space-y-3">
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-medium text-muted-foreground">Produto(s) em foco e por quê</p>
        <ul className="space-y-1.5">
          {produtos.map((p, i) => (
            <li key={i} className="flex min-w-0 flex-col sm:flex-row sm:items-center">
              <Input
                value={p.nome}
                onChange={(e) => mudarProduto(i, "nome", e.target.value)}
                placeholder="Produto ou serviço"
                aria-label={`Produto ${i + 1}`}
                disabled={desabilitado}
                className="mb-1 h-8 text-[13px] sm:mb-0 sm:mr-1.5 sm:w-2/5"
              />
              <div className="flex min-w-0 flex-1 items-center">
                <Input
                  value={p.por_que}
                  onChange={(e) => mudarProduto(i, "por_que", e.target.value)}
                  placeholder="Por que este produto nesta campanha"
                  aria-label={`Por que o produto ${i + 1}`}
                  disabled={desabilitado}
                  className="h-8 min-w-0 flex-1 text-[13px]"
                />
                {produtos.length > 1 && (
                  <button
                    type="button"
                    onClick={() => mudar({ produtos: produtos.filter((_, j) => j !== i) })}
                    aria-label={`Tirar o produto ${i + 1}`}
                    title={`Tirar o produto ${i + 1}`}
                    disabled={desabilitado}
                    className="ml-1 shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {produtos.length < MAX_PRODUTOS && (
          <button
            type="button"
            onClick={() => mudar({ produtos: produtos.concat([{ nome: "", por_que: "" }]) })}
            disabled={desabilitado}
            className="toque-compacto mt-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-primary hover:bg-muted"
            aria-label="Outro produto"
            title="Outro produto"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo rotulo="Oferta" id={`${prefixo}-oferta`}>
          <Input id={`${prefixo}-oferta`} value={valor.oferta} onChange={(e) => mudar({ oferta: e.target.value })} disabled={desabilitado} placeholder="Ex.: 20% nos kits até 12/06" className="h-8 text-[13px]" />
        </Campo>
        <Campo rotulo="Chamada para ação (CTA)" id={`${prefixo}-cta`}>
          <Input id={`${prefixo}-cta`} value={valor.cta} onChange={(e) => mudar({ cta: e.target.value })} disabled={desabilitado} placeholder="Ex.: chame no WhatsApp" className="h-8 text-[13px]" />
        </Campo>
        <div className="sm:col-span-2">
          <Campo rotulo="Mensagem central" id={`${prefixo}-mensagem`}>
            <Input id={`${prefixo}-mensagem`} value={valor.mensagem_central} onChange={(e) => mudar({ mensagem_central: e.target.value })} disabled={desabilitado} placeholder="A frase que o público precisa entender" className="h-8 text-[13px]" />
          </Campo>
        </div>
        <div className="sm:col-span-2">
          <Campo rotulo="Público" id={`${prefixo}-publico`}>
            <Textarea id={`${prefixo}-publico`} value={valor.publico} onChange={(e) => mudar({ publico: e.target.value })} disabled={desabilitado} rows={2} placeholder="Quem é, o que quer, o que trava a compra" className="min-h-[56px] text-[13px]" />
          </Campo>
        </div>
        <div className="sm:col-span-2">
          <Campo rotulo="Provas (uma por linha, só reais)" id={`${prefixo}-provas`}>
            <Textarea
              id={`${prefixo}-provas`}
              value={valor.provas.join("\n")}
              onChange={(e) => mudar({ provas: e.target.value.split("\n") })}
              disabled={desabilitado}
              rows={3}
              placeholder={"Depoimento da cliente Ana\n4,9 estrelas no Google\nGarantia de 30 dias"}
              className="min-h-[72px] text-[13px]"
            />
          </Campo>
        </div>
        <Campo rotulo="Tom de voz" id={`${prefixo}-tom`}>
          <Input id={`${prefixo}-tom`} value={valor.tom} onChange={(e) => mudar({ tom: e.target.value })} disabled={desabilitado} placeholder="Ex.: leve, próximo, com humor" className="h-8 text-[13px]" />
        </Campo>
        <div className="sm:col-span-2">
          {/* 22/10/2026: o tom da campanha (Comercial direto por padrão); o agente e a criação respeitam. */}
          <SeletorDoTom valor={valor.tom_da_campanha} onValor={(t) => mudar({ tom_da_campanha: t })} desabilitado={desabilitado} />
        </div>
        <div className="sm:col-span-2">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">Canais</p>
          <div role="group" aria-label="Canais da campanha" className="flex min-w-0 flex-wrap">
            {CANAIS_DA_CAMPANHA.map((c) => {
              const marcado = (valor.canais || []).indexOf(c) >= 0;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={marcado}
                  disabled={desabilitado}
                  onClick={() => mudar({ canais: marcado ? (valor.canais || []).filter((x) => x !== c) : (valor.canais || []).concat([c]) })}
                  className={`mb-1.5 mr-1.5 inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] transition-colors ${marcado ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary/50"}`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Briefing limpo para enviar: tira linhas e produtos vazios. */
export function briefingParaEnviar(b: BriefingDaCampanha): BriefingDaCampanha {
  return normalizarBriefing({ ...b, provas: b.provas.map((p) => p.trim()).filter(Boolean) });
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 text-[13px] leading-relaxed [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** Seção do detalhe: lê o briefing e edita sem custo. */
export default function CampanhaBriefing({ campanha, onPedirAoAgente }: { campanha: Campanha; onPedirAoAgente?: (texto: string) => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const briefing = normalizarBriefing(campanha.briefing);
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<BriefingDaCampanha>(briefing);
  const [salvando, setSalvando] = useState(false);
  // 21/10/2026: o período mora no briefing da campanha (a série e as peças seguem a janela).
  const [inicio, setInicio] = useState(campanha.periodo_inicio || "");
  const [fim, setFim] = useState(campanha.periodo_fim || "");
  const dias = inicio && fim ? diasEntreIso(inicio, fim) : -1;
  const erroDoPeriodo = !inicio || !fim ? "Escolha o início e o fim." : dias < 0 ? "O fim vem antes do início." : dias > DIAS_MAX_CAMPANHA ? `Até ${DIAS_MAX_CAMPANHA} dias por campanha.` : "";

  const abrirEdicao = () => {
    setRascunho(normalizarBriefing(campanha.briefing));
    setInicio(campanha.periodo_inicio || "");
    setFim(campanha.periodo_fim || "");
    setEditando(true);
  };

  const salvar = async () => {
    setSalvando(true);
    try {
      const mudouPeriodo = inicio !== (campanha.periodo_inicio || "") || fim !== (campanha.periodo_fim || "");
      const r = await campanhaSalvar({ campanhaId: campanha.id, briefing: briefingParaEnviar(rascunho), ...(mudouPeriodo ? { periodoInicio: inicio, periodoFim: fim } : {}) });
      if (r && r.campanha) trocarCampanhaNoCache(queryClient, clientId, r.campanha);
      setEditando(false);
    } catch (e) {
      toast.error("Briefing não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  if (editando) {
    return (
      <div className="min-w-0 space-y-3">
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:max-w-sm">
          <Campo rotulo="Início" id={`briefing-${campanha.id}-inicio`}>
            <Input id={`briefing-${campanha.id}-inicio`} type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} disabled={salvando} className="h-8 min-w-0 text-[13px]" />
          </Campo>
          <Campo rotulo="Fim" id={`briefing-${campanha.id}-fim`}>
            <Input id={`briefing-${campanha.id}-fim`} type="date" value={fim} min={inicio} onChange={(e) => setFim(e.target.value)} disabled={salvando} className="h-8 min-w-0 text-[13px]" />
          </Campo>
        </div>
        {erroDoPeriodo && <p className="text-[12px] text-destructive">{erroDoPeriodo}</p>}
        <FormularioDoBriefing valor={rascunho} onChange={setRascunho} prefixo={`briefing-${campanha.id}`} desabilitado={salvando} />
        <div className="flex flex-wrap items-center justify-end">
          <Button type="button" size="sm" variant="ghost" className="mr-1.5 h-8" onClick={() => setEditando(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button type="button" size="sm" className="h-8" onClick={() => void salvar()} disabled={salvando || !!erroDoPeriodo}>
            {salvando ? "Salvando…" : "Salvar briefing"}
          </Button>
        </div>
      </div>
    );
  }

  const vazio = briefingEstaVazio(briefing);
  return (
    <div className="min-w-0">
      {vazio ? (
        <p className="flex items-center text-[13px] text-muted-foreground">
          Sem briefing ainda
          <AjudaRecolhida className="ml-1" rotulo="O que pôr no briefing">
            Diga qual produto a campanha vende, a oferta, a mensagem e para quem: o agente e o Estúdio passam a seguir isso.
          </AjudaRecolhida>
        </p>
      ) : (
        <dl className="grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Linha rotulo="Período">{periodoCurto(campanha.periodo_inicio, campanha.periodo_fim)}</Linha>
          <Linha rotulo="Tom da campanha">{ROTULO_DO_TOM[tomDaCampanha(briefing.tom_da_campanha)]}</Linha>
          {briefing.canais && briefing.canais.length > 0 && <Linha rotulo="Canais">{briefing.canais.join(", ")}</Linha>}
          {briefing.produtos.length > 0 && (
            <div className="sm:col-span-2">
              <Linha rotulo="Produto(s) em foco">
                <ul className="space-y-1">
                  {briefing.produtos.map((p, i) => (
                    <li key={`${p.nome}-${i}`}>
                      <strong className="font-medium">{p.nome}</strong>
                      {p.por_que ? <span className="text-muted-foreground">: {p.por_que}</span> : null}
                    </li>
                  ))}
                </ul>
              </Linha>
            </div>
          )}
          {briefing.oferta && <Linha rotulo="Oferta">{briefing.oferta}</Linha>}
          {briefing.cta && <Linha rotulo="CTA">{briefing.cta}</Linha>}
          {briefing.mensagem_central && (
            <div className="sm:col-span-2">
              <Linha rotulo="Mensagem central">{briefing.mensagem_central}</Linha>
            </div>
          )}
          {briefing.publico && (
            <div className="sm:col-span-2">
              <Linha rotulo="Público">{briefing.publico}</Linha>
            </div>
          )}
          {briefing.provas.length > 0 && (
            <div className="sm:col-span-2">
              <Linha rotulo="Provas">
                <ul className="list-disc space-y-0.5 pl-4">
                  {briefing.provas.map((p, i) => <li key={`${p}-${i}`}>{p}</li>)}
                </ul>
              </Linha>
            </div>
          )}
          {briefing.tom && <Linha rotulo="Tom de voz">{briefing.tom}</Linha>}
        </dl>
      )}
      <div className="mt-3 flex flex-wrap items-center">
        <Button type="button" size="sm" variant="ghost" className="mb-1 mr-1 h-8 w-8 p-0" onClick={abrirEdicao} aria-label={vazio ? "Preencher briefing" : "Editar briefing"} title={vazio ? "Preencher briefing" : "Editar briefing"}>
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Button>
        {onPedirAoAgente && (
          <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 w-8 p-0 text-primary" onClick={() => onPedirAoAgente("No briefing da campanha, ")} aria-label="Pedir ao agente" title="Pedir ao agente">
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
}
