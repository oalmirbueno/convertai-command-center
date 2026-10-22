import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, History, Loader2, Pencil, RotateCcw, Search, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { textoDoErro } from "@/lib/mesa/api";
import { botao, juntar, texto } from "@/components/sistema";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import type { Campanha } from "./mesaV4Api";
import {
  aplicarRespostaDaCampanha,
  campanhaSalvar,
  chavesDaCampanha,
  normalizarBriefing,
  partesDaMudanca,
  partesDoMercado,
  pesquisarMercadoDaCampanha,
  reescreverNoTomComercial,
  trocarCampanhaNoCache,
  voltarAVersao,
} from "./campanhasApi";
import { DICA_DO_TOM, ROTULO_DO_TOM, TONS_DA_CAMPANHA, tomDaCampanha, type TomDaCampanha } from "../../../supabase/functions/agente-calendario/modulos/tom-da-campanha";
import { ESQUEMAS_DE_CAMPANHA } from "../../../supabase/functions/agente-calendario/modulos/esquemas-de-campanha";

/**
 * Editor da campanha em andamento (22/10/2026, dono: "um editor completo mesmo, a campanha rodando, adaptando
 * aquela que já está funcionando, pra não precisar começar uma do zero"): nome, objetivo e conceito à mão; o tom
 * (Comercial direto por padrão); "Reescrever no tom comercial" (a mudança planejada do agente, com diff e
 * Confirmar); o que o mercado está fazendo (com fonte); e o histórico das versões com voltar a uma delas.
 */

/** O tom da campanha (Comercial direto, Comercial criativo, Institucional): o agente respeita a escolha. */
export function SeletorDoTom({ valor, onValor, desabilitado }: { valor: string | undefined; onValor: (t: TomDaCampanha) => void; desabilitado?: boolean }) {
  const atual = tomDaCampanha(valor);
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium text-muted-foreground">Tom da campanha</p>
      <div role="radiogroup" aria-label="Tom da campanha" className="flex min-w-0 flex-wrap" data-tom-da-campanha={atual}>
        {TONS_DA_CAMPANHA.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={atual === t}
            disabled={desabilitado}
            title={DICA_DO_TOM[t]}
            onClick={() => onValor(t)}
            className={`mb-1.5 mr-1.5 inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] transition-colors ${atual === t ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary/50"}`}
          >
            {ROTULO_DO_TOM[t]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Nome, objetivo e conceito à mão (sem custo). */
export function EditorDaIdeia({ campanha }: { campanha: Campanha }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState(campanha.nome);
  const [objetivo, setObjetivo] = useState(campanha.objetivo || "");
  const [conceito, setConceito] = useState(campanha.conceito || "");
  const [salvando, setSalvando] = useState(false);
  if (!aberto) {
    return (
      <button type="button" className={botao.icone} onClick={() => { setNome(campanha.nome); setObjetivo(campanha.objetivo || ""); setConceito(campanha.conceito || ""); setAberto(true); }} aria-label="Editar nome, objetivo e conceito" title="Editar nome, objetivo e conceito">
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }
  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await campanhaSalvar({ campanhaId: campanha.id, nome, objetivo, conceito });
      if (r && r.campanha) trocarCampanhaNoCache(qc, clientId, r.campanha);
      setAberto(false);
    } catch (e) {
      toast.error("Não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };
  return (
    <div className="min-w-0 space-y-2 rounded-md bg-muted/50 p-3" data-editor-da-ideia="">
      <Input value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Nome da campanha" className="h-8 text-[13px]" maxLength={120} />
      <Input value={objetivo} onChange={(e) => setObjetivo(e.target.value)} aria-label="Objetivo da campanha" placeholder="Objetivo" className="h-8 text-[13px]" />
      <Textarea value={conceito} onChange={(e) => setConceito(e.target.value)} aria-label="Conceito da campanha" placeholder="Conceito" rows={3} className="text-[13px]" />
      <div className="flex justify-end">
        <button type="button" className={botao.icone} onClick={() => setAberto(false)} disabled={salvando} aria-label="Cancelar" title="Cancelar">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" className={juntar(botao.icone, "text-primary hover:text-primary")} onClick={() => void salvar()} disabled={salvando || !nome.trim()} aria-label="Salvar" title="Salvar nome, objetivo e conceito">
          {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}

/** "Reescrever no tom comercial": planeja a reescrita (o cartão com o diff aparece no agente). */
export function ReescreverComercial({ campanha, pecas, onAbrirAgente }: { campanha: Campanha; pecas: number; onAbrirAgente?: () => void }) {
  const { clientId, catalogo } = useMesa();
  const qc = useQueryClient();
  return (
    <BotaoComCusto
      rotulo={<><Sparkles className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Reescrever no tom comercial</span></>}
      titulo="Reescrita comercial"
      descricao="Reescrever no tom comercial: o agente planeja a reescrita do briefing, dos nomes, ganchos, textos e legendas das peças não aprovadas; você confere o diff e confirma"
      partes={() => partesDaMudanca(catalogo, pecas)}
      executar={async () => {
        const r = await reescreverNoTomComercial(campanha.id);
        aplicarRespostaDaCampanha(qc, clientId, r);
        await qc.invalidateQueries({ queryKey: chavesDaCampanha.conversa(clientId, campanha.id) });
        if (onAbrirAgente) onAbrirAgente();
        toast.info("Reescrita planejada", { description: "Confira o antes e depois no agente da campanha e confirme." });
        return r;
      }}
      variant="ghost"
      className="h-8 gap-0 px-2"
    />
  );
}

/** O que o mercado está fazendo (padrões com fonte, diferenciação e o que evitar) e o botão para pesquisar. */
export function MercadoDaCampanha({ campanha }: { campanha: Campanha }) {
  const { clientId, catalogo } = useMesa();
  const qc = useQueryClient();
  const b = normalizarBriefing(campanha.briefing);
  const m = b.mercado || null;
  const esquema = ESQUEMAS_DE_CAMPANHA.filter((e) => e.id === b.esquema)[0] || null;
  return (
    <div className="min-w-0 space-y-2" data-mercado-da-campanha={m ? "com" : "sem"}>
      <div className="flex min-w-0 items-center">
        <p className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>
          {esquema ? `Esquema: ${esquema.rotulo}` : "Esquema pela ocasião"}{m ? ` · pesquisa de ${m.pesquisado_em}` : ""}
        </p>
        <BotaoComCusto
          rotulo={<><Search className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Pesquisar o que o mercado está fazendo</span></>}
          titulo="Mercado da campanha"
          descricao="Pesquisar o que o mercado está fazendo agora (campanhas reais com fonte) e o ângulo de diferenciação"
          partes={() => partesDoMercado(catalogo)}
          executar={async () => {
            const r = await pesquisarMercadoDaCampanha(campanha.id);
            if (r && r.campanha) trocarCampanhaNoCache(qc, clientId, r.campanha);
            return r;
          }}
          variant="ghost"
          className="h-8 gap-0 px-2"
        />
      </div>
      {m && (
        <>
          <ul className="space-y-1" aria-label="Padrões do mercado">
            {m.padroes.map((p) => (
              <li key={p.link} className="flex min-w-0 items-start text-[12px]">
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{p.padrao}</span>
                <a href={p.link} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex shrink-0 items-center text-primary hover:underline" title={`Fonte: ${p.fonte || p.link}`}>
                  {p.fonte || "fonte"}
                  <ExternalLink className="ml-0.5 h-3 w-3" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
          {m.diferenciacao && <p className="text-[12px]"><strong className="font-medium">Diferenciação:</strong> {m.diferenciacao}</p>}
          {m.evitar.length > 0 && <p className={texto.auxiliar}>Evitar: {m.evitar.join("; ")}</p>}
        </>
      )}
    </div>
  );
}

/** Histórico de versões (o que mudou, quando e por quê) com voltar a uma versão. */
export function HistoricoDaCampanha({ campanha }: { campanha: Campanha }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const versoes = normalizarBriefing(campanha.briefing).versoes || [];
  const [voltando, setVoltando] = useState<string | null>(null);
  if (!versoes.length) return <p className={texto.auxiliar}>Sem versões ainda: cada mudança confirmada guarda a de antes.</p>;
  return (
    <ul className="min-w-0 space-y-1.5" aria-label="Versões da campanha" data-historico-da-campanha="">
      {versoes.map((v) => (
        <li key={v.id} className="flex min-w-0 items-center text-[12px]" data-versao={v.id}>
          <History className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{v.motivo || "Mudança"}</span>
            <span className="block text-[11px] text-muted-foreground">{v.criada_em.slice(8, 10)}/{v.criada_em.slice(5, 7)} {v.criada_em.slice(11, 16)}</span>
          </span>
          <button
            type="button"
            className={botao.icone}
            disabled={voltando !== null}
            onClick={async () => {
              setVoltando(v.id);
              try {
                const r = await voltarAVersao(campanha.id, v.id);
                aplicarRespostaDaCampanha(qc, clientId, r);
                toast.success("Campanha de volta", { description: "A de agora ficou guardada como versão." });
              } catch (e) {
                toast.error("Não voltou", { description: textoDoErro(e) });
              } finally {
                setVoltando(null);
              }
            }}
            aria-label="Voltar a esta versão"
            title="Voltar a esta versão (a de agora fica guardada)"
          >
            {voltando === v.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
          </button>
        </li>
      ))}
    </ul>
  );
}
