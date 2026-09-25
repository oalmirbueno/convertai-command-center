import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, ChevronDown, ExternalLink, Layers, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BotaoDeApagar, useApagarConteudo, type ResultadoDoApagar } from "./ApagarConteudo";
import { useAvisarErro } from "./Custo";
import { useFiltroDaMarca, useMesa } from "./MesaContexto";
import { projetosDaListaNaMarca } from "@/lib/mesa/marcas";
import {
  atualizarAgenda,
  chaves,
  diaCurto,
  gravarProposta,
  laminasDoItem,
  lerProjetosDoCliente,
  mesDaData,
  rotuloDoFormato,
  type ItemProposto,
  type PropostaV4,
} from "./mesaV4Api";

/**
 * Conteúdos que o agente do mês ou a campanha propõem, em cartões enxutos
 * (data, formato, tema, gancho, lâminas) com o roteiro recolhido, e a barra
 * de ações da proposta: gravar na agenda (sem custo), ajustar e descartar.
 */

export function CartaoDoConteudo({
  item,
  onAbrir,
  apagar,
}: {
  item: ItemProposto;
  onAbrir?: (taskId: string, mes: string) => void;
  /** Com esta função, o cartão ganha a lixeira com confirmação curta. */
  apagar?: (confirmarExtra: boolean) => Promise<ResultadoDoApagar>;
}) {
  const [aberto, setAberto] = useState(false);
  const laminas = laminasDoItem(item);
  const cards = (item.cards || []).slice().sort((a, b) => a.ordem - b.ordem);
  const texto = item.copy || item.resumo;
  return (
    <article className="min-w-0 rounded-lg border border-border bg-background">
      <div className="px-3 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center text-[11px] text-muted-foreground">
          <span className="mr-2 font-medium text-foreground">{diaCurto(item.data)}</span>
          <span className="mr-2">{rotuloDoFormato(item.formato)}</span>
          {laminas > 0 && (
            <span className="mr-2 inline-flex items-center" title={`${laminas} lâmina(s)`}>
              <Layers className="mr-0.5 h-3 w-3" />
              {laminas}
            </span>
          )}
          {item.carrossel_infinito && <span className="mr-2">contínuo</span>}
          {apagar && <BotaoDeApagar onApagar={apagar} className="ml-auto" />}
        </div>
        {item.tema && <p className="mt-1 line-clamp-2 text-[12.5px] font-medium leading-snug [overflow-wrap:anywhere]">{item.tema}</p>}
        {item.gancho && <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{item.gancho}</p>}
        <div className="mt-1.5 flex flex-wrap items-center">
          {(cards.length > 0 || texto) && (
            <button
              type="button"
              onClick={() => setAberto((v) => !v)}
              aria-expanded={aberto}
              className="mr-3 inline-flex items-center text-[11.5px] font-medium text-primary hover:underline"
            >
              {aberto ? "Fechar roteiro" : "Ver roteiro"}
              <ChevronDown className={`ml-0.5 h-3.5 w-3.5 transition-transform ${aberto ? "rotate-180" : ""}`} />
            </button>
          )}
          {item.task_id && onAbrir && (
            <button
              type="button"
              onClick={() => onAbrir(item.task_id as string, mesDaData(item.data))}
              className="inline-flex items-center text-[11.5px] text-muted-foreground hover:text-foreground"
            >
              Abrir no Estúdio <ExternalLink className="ml-1 h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {aberto && (
        <div className="space-y-2 border-t border-border px-3 py-2.5">
          {texto && <p className="whitespace-pre-wrap text-[12px] leading-relaxed [overflow-wrap:anywhere]">{texto}</p>}
          {cards.length > 0 && (
            <ol className="space-y-1.5">
              {cards.map((c) => (
                <li key={c.ordem} className="rounded-md bg-muted px-2.5 py-2">
                  <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                    Lâmina {c.ordem}{c.funcao ? ` · ${c.funcao}` : ""}
                  </p>
                  {c.texto && <p className="mt-0.5 text-[12px] leading-snug [overflow-wrap:anywhere]">{c.texto}</p>}
                  {c.ilustracao && <p className="mt-1 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{c.ilustracao}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </article>
  );
}

function useProjetosDeSocial(clientId: string, ativo: boolean) {
  const projetos = useQuery({
    queryKey: chaves.projetosSocial(clientId),
    enabled: ativo,
    queryFn: () => lerProjetosDoCliente(clientId),
  });
  // Marca por projeto (Acerbi e CME): só os projetos da marca aberta; sem marca, todos.
  const filtroDaMarca = useFiltroDaMarca();
  const candidatos = useMemo(() => {
    const todos = projetos.data || [];
    const social = todos.filter((p) => p.project_type === "social_media");
    return projetosDaListaNaMarca(social.length ? social : todos, filtroDaMarca);
  }, [projetos.data, filtroDaMarca]);
  return { ...projetos, candidatos };
}

interface BlocoDaPropostaProps {
  proposta: PropostaV4;
  /** project_id devolvido pela ação (pedido_livre, campanha_criar); senão, o da proposta. */
  projetoSugerido?: string | null;
  rotuloGravar?: string;
  onAjustar?: () => void;
  rotuloAjustar?: string;
  onDescartar?: () => void;
  onGravada?: (data: any) => void;
  onAbrirNoEstudio?: (taskId: string, mes: string) => void;
  /** Sem os cartões dos itens: só a barra de ações. */
  compacto?: boolean;
  /** Cartões em grade (campanha); no painel do agente, um embaixo do outro. */
  grade?: boolean;
  /** Cada cartão ganha a lixeira: tira da proposta ou, já gravado, da agenda. */
  permitirApagar?: boolean;
}

export function BlocoDaProposta({
  proposta,
  projetoSugerido,
  rotuloGravar = "Gravar na agenda",
  onAjustar,
  rotuloAjustar = "Ajustar",
  onDescartar,
  onGravada,
  onAbrirNoEstudio,
  compacto = false,
  grade = false,
  permitirApagar = false,
}: BlocoDaPropostaProps) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const apagarConteudo = useApagarConteudo();
  const [gravando, setGravando] = useState(false);
  const [escolhido, setEscolhido] = useState("");
  const gravada = proposta.status === "gravada";
  const projetoDaProposta = projetoSugerido || proposta.project_id || "";
  const projetos = useProjetosDeSocial(clientId, !gravada && !projetoDaProposta);
  const projeto = projetoDaProposta || escolhido || (projetos.candidatos.length === 1 ? projetos.candidatos[0].id : "");
  const itens = (proposta.itens || []).slice().sort((a, b) => String(a.data || "").localeCompare(String(b.data || "")));
  const primeiraTarefa = itens.find((i) => !!i.task_id);

  /** Lixeira do cartão: gravado sai da agenda; na proposta, sai da proposta. */
  const apagarDoCartao = (it: ItemProposto) => {
    if (!permitirApagar || proposta.status === "descartada") return undefined;
    if (it.task_id) return (extra: boolean) => apagarConteudo.daAgenda(it.task_id as string, it.tema || "Conteúdo", extra);
    if (gravada || !it.tema_id) return undefined;
    const indice = (proposta.itens || []).indexOf(it);
    return () => apagarConteudo.daProposta(proposta.id, it, indice);
  };

  const gravar = async () => {
    if (!projeto || gravando) return;
    setGravando(true);
    try {
      const data = await gravarProposta(proposta.id, projeto);
      const n = Array.isArray(data?.itens) ? data.itens.length : itens.length;
      toast.success("Gravado na agenda", { description: `${n} conteúdo(s) no calendário, já dirigidos no Estúdio.` });
      if (data && data.proposta) queryClient.setQueryData(chaves.proposta(proposta.id), data.proposta);
      onGravada?.(data);
    } catch (e) {
      avisarErro(e, "Não foi possível gravar");
    } finally {
      setGravando(false);
      atualizarAgenda(queryClient, clientId);
      void queryClient.invalidateQueries({ queryKey: chaves.agente(clientId) });
      void queryClient.invalidateQueries({ queryKey: chaves.proposta(proposta.id) });
      void queryClient.invalidateQueries({ queryKey: chaves.campanhas(clientId) });
    }
  };

  return (
    <div className="min-w-0 space-y-2">
      {!compacto && (
        <div className={grade ? "grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3" : "space-y-1.5"}>
          {itens.map((it, i) => <CartaoDoConteudo key={it.tema_id || i} item={it} onAbrir={onAbrirNoEstudio} apagar={apagarDoCartao(it)} />)}
        </div>
      )}
      {gravada ? (
        <div className="flex flex-wrap items-center rounded-lg bg-muted px-3 py-2 text-[12px]">
          <CalendarCheck2 className="mr-1.5 h-3.5 w-3.5 shrink-0 text-success" />
          <span className="mr-2 min-w-0 flex-1">Na agenda{proposta.task_ids && proposta.task_ids.length ? ` · ${proposta.task_ids.length} item(ns)` : ""}</span>
          {primeiraTarefa && onAbrirNoEstudio && (
            <button
              type="button"
              onClick={() => onAbrirNoEstudio(primeiraTarefa.task_id as string, mesDaData(primeiraTarefa.data))}
              className="inline-flex items-center font-medium text-primary hover:underline"
            >
              Abrir no Estúdio <ExternalLink className="ml-1 h-3 w-3" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center">
          {!projetoDaProposta && projetos.candidatos.length !== 1 && (
            <Select value={escolhido} onValueChange={setEscolhido}>
              <SelectTrigger className="mb-1.5 mr-1.5 h-8 w-full min-w-0 text-[12px] sm:w-[200px]" aria-label="Projeto de social">
                <SelectValue placeholder={projetos.isLoading ? "Lendo projetos…" : projetos.candidatos.length ? "Projeto de social" : "Cliente sem projeto"} />
              </SelectTrigger>
              <SelectContent>
                {projetos.candidatos.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button type="button" size="sm" className="mb-1.5 mr-1.5 h-8" onClick={() => void gravar()} disabled={!projeto || gravando || !itens.length}>
            {gravando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CalendarCheck2 className="mr-1.5 h-3.5 w-3.5" />}
            {rotuloGravar}
          </Button>
          {onAjustar && (
            <Button type="button" size="sm" variant="outline" className="mb-1.5 mr-1.5 h-8" onClick={onAjustar}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              {rotuloAjustar}
            </Button>
          )}
          {onDescartar && (
            <Button type="button" size="sm" variant="ghost" className="mb-1.5 h-8 text-muted-foreground" onClick={onDescartar}>
              <X className="mr-1 h-3.5 w-3.5" />
              Descartar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
