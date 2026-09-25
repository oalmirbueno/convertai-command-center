import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { textoDoErro } from "@/lib/mesa/api";
import { useMesa } from "./MesaContexto";
import type { BriefingDaCampanha, Campanha } from "./mesaV4Api";
import { briefingEstaVazio } from "./mesaV4Api";
import { campanhaSalvar, normalizarBriefing, trocarCampanhaNoCache } from "./campanhasApi";

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
                className="mb-1 h-8 text-[12.5px] sm:mb-0 sm:mr-1.5 sm:w-2/5"
              />
              <div className="flex min-w-0 flex-1 items-center">
                <Input
                  value={p.por_que}
                  onChange={(e) => mudarProduto(i, "por_que", e.target.value)}
                  placeholder="Por que este produto nesta campanha"
                  aria-label={`Por que o produto ${i + 1}`}
                  disabled={desabilitado}
                  className="h-8 min-w-0 flex-1 text-[12.5px]"
                />
                {produtos.length > 1 && (
                  <button
                    type="button"
                    onClick={() => mudar({ produtos: produtos.filter((_, j) => j !== i) })}
                    aria-label={`Tirar o produto ${i + 1}`}
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
            className="mt-1 inline-flex items-center text-[12px] text-primary hover:underline"
          >
            <Plus className="mr-0.5 h-3.5 w-3.5" /> Outro produto
          </button>
        )}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <Campo rotulo="Oferta" id={`${prefixo}-oferta`}>
          <Input id={`${prefixo}-oferta`} value={valor.oferta} onChange={(e) => mudar({ oferta: e.target.value })} disabled={desabilitado} placeholder="Ex.: 20% nos kits até 12/06" className="h-8 text-[12.5px]" />
        </Campo>
        <Campo rotulo="Chamada para ação (CTA)" id={`${prefixo}-cta`}>
          <Input id={`${prefixo}-cta`} value={valor.cta} onChange={(e) => mudar({ cta: e.target.value })} disabled={desabilitado} placeholder="Ex.: chame no WhatsApp" className="h-8 text-[12.5px]" />
        </Campo>
        <div className="sm:col-span-2">
          <Campo rotulo="Mensagem central" id={`${prefixo}-mensagem`}>
            <Input id={`${prefixo}-mensagem`} value={valor.mensagem_central} onChange={(e) => mudar({ mensagem_central: e.target.value })} disabled={desabilitado} placeholder="A frase que o público precisa entender" className="h-8 text-[12.5px]" />
          </Campo>
        </div>
        <div className="sm:col-span-2">
          <Campo rotulo="Público" id={`${prefixo}-publico`}>
            <Textarea id={`${prefixo}-publico`} value={valor.publico} onChange={(e) => mudar({ publico: e.target.value })} disabled={desabilitado} rows={2} placeholder="Quem é, o que quer, o que trava a compra" className="min-h-[56px] text-[12.5px]" />
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
              className="min-h-[72px] text-[12.5px]"
            />
          </Campo>
        </div>
        <Campo rotulo="Tom" id={`${prefixo}-tom`}>
          <Input id={`${prefixo}-tom`} value={valor.tom} onChange={(e) => mudar({ tom: e.target.value })} disabled={desabilitado} placeholder="Ex.: leve, próximo, com humor" className="h-8 text-[12.5px]" />
        </Campo>
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
      <dt className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
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

  const abrirEdicao = () => {
    setRascunho(normalizarBriefing(campanha.briefing));
    setEditando(true);
  };

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await campanhaSalvar({ campanhaId: campanha.id, briefing: briefingParaEnviar(rascunho) });
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
        <FormularioDoBriefing valor={rascunho} onChange={setRascunho} prefixo={`briefing-${campanha.id}`} desabilitado={salvando} />
        <div className="flex flex-wrap items-center justify-end">
          <Button type="button" size="sm" variant="ghost" className="mr-1.5 h-8" onClick={() => setEditando(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button type="button" size="sm" className="h-8" onClick={() => void salvar()} disabled={salvando}>
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
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Sem briefing ainda. Diga qual produto a campanha vende, a oferta, a mensagem e para quem: o agente e o Estúdio passam a seguir isso.
        </p>
      ) : (
        <dl className="grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-2">
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
          {briefing.tom && <Linha rotulo="Tom da campanha">{briefing.tom}</Linha>}
        </dl>
      )}
      <div className="mt-3 flex flex-wrap items-center">
        <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8" onClick={abrirEdicao}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" /> {vazio ? "Preencher briefing" : "Editar briefing"}
        </Button>
        {onPedirAoAgente && (
          <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-primary" onClick={() => onPedirAoAgente("No briefing da campanha, ")}>
            Pedir ao agente
          </Button>
        )}
      </div>
    </div>
  );
}
