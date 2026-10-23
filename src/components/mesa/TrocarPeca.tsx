import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, RotateCcw, Shuffle, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { BotaoComCusto, useAvisarErro } from "./Custo";
import EscolhaDeFormatos, { ICONE_DA_OPCAO } from "./EscolhaDeFormatos";
import { useMarcaDaMesa, useMesa } from "./MesaContexto";
import { chaves, partesDaTroca } from "./mesaV4Api";
import { trocarPecaAplicar, trocarPecaDescartar, trocarPecaDesfazer, trocarPecaOpcoes, type RespostaDaTroca } from "./planoDoMes";
import type { OpcaoDoMes } from "../../../supabase/functions/agente-calendario/modulos/escolha-do-mes";
import { NIVEIS_DA_TROCA } from "../../../supabase/functions/agente-calendario/modulos/troca-da-peca";

/**
 * Trocar uma peça do Mês (24/10/2026; dono: "ter o poder de trocar conteúdos se eu quiser e não gostar da esteira
 * que tem pronta"). Escolhe para qual formato (ou deixa o painel variar), vê 3 substitutas do mesmo dia com o custo
 * antes, o Jev recomenda uma, a equipe escolhe e confirma; depois, Desfazer volta a peça de antes.
 */
export interface PecaParaTrocar {
  id: string;
  title: string;
  due_date: string | null;
}

/** As caches que mostram a peça (agenda do mês, artes, itens do Estúdio e a conversa do agente). */
export function atualizarDepoisDaTroca(qc: ReturnType<typeof useQueryClient>, clientId: string) {
  void qc.invalidateQueries({ queryKey: ["mesa", "agenda-do-mes", clientId] });
  void qc.invalidateQueries({ queryKey: ["mesa", "artes-do-mes", clientId] });
  void qc.invalidateQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
  void qc.invalidateQueries({ queryKey: ["mesa", "item-avulso", clientId] });
  void qc.invalidateQueries({ queryKey: chaves.agente(clientId) });
}

/** A nota do Jev (0 a 3, pode ser fracionada) no nível mais próximo. */
const nivel = (n: number | null) => (n === null ? "" : NIVEIS_DA_TROCA[Math.max(0, Math.min(NIVEIS_DA_TROCA.length - 1, Math.round(n)))] || "");

export default function TrocarPeca({
  aberta,
  onMudar,
  peca,
  opcaoInicial = null,
  pedidoInicial = "",
}: {
  aberta: boolean;
  onMudar: (v: boolean) => void;
  peca: PecaParaTrocar | null;
  opcaoInicial?: OpcaoDoMes | null;
  pedidoInicial?: string;
}) {
  const { clientId, catalogo } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const [opcao, setOpcao] = useState<OpcaoDoMes[]>(opcaoInicial ? [opcaoInicial] : []);
  const [pedido, setPedido] = useState(pedidoInicial);
  const [resposta, setResposta] = useState<RespostaDaTroca | null>(null);
  const [escolhida, setEscolhida] = useState(0);
  const [feita, setFeita] = useState<string | null>(null);
  const [agindo, setAgindo] = useState<"trocar" | "desfazer" | "cancelar" | null>(null);
  if (!peca) return null;
  const data = peca.due_date ? `${peca.due_date.slice(8, 10)}/${peca.due_date.slice(5, 7)}` : "sem data";

  const pedirOpcoes = async () => {
    const r = await trocarPecaOpcoes({ clientId, taskId: peca.id, opcao: opcao[0] || null, pedido, marcaId: marca ? marca.id : null });
    setResposta(r);
    setEscolhida(r.recomendada >= 0 && r.recomendada < r.opcoes.length ? r.recomendada : 0);
    void qc.invalidateQueries({ queryKey: chaves.agente(clientId) });
    return r;
  };

  const desfazer = async (mensagemId: string) => {
    setAgindo("desfazer");
    try {
      await trocarPecaDesfazer(mensagemId);
      atualizarDepoisDaTroca(qc, clientId);
      setFeita(null);
      toast.success("Peça como estava", { description: "A troca foi desfeita." });
    } catch (e) {
      avisarErro(e, "Não foi possível desfazer");
    } finally {
      setAgindo(null);
    }
  };

  const trocar = async () => {
    if (!resposta) return;
    setAgindo("trocar");
    try {
      const r = await trocarPecaAplicar(resposta.mensagem_id, escolhida);
      atualizarDepoisDaTroca(qc, clientId);
      setFeita(r.titulo);
      const id = resposta.mensagem_id;
      toast.success("Peça trocada", { description: r.titulo, action: { label: "Desfazer", onClick: () => void desfazer(id) } });
    } catch (e) {
      avisarErro(e, "Não foi possível trocar");
    } finally {
      setAgindo(null);
    }
  };

  const fechar = async (v: boolean) => {
    if (v || agindo) return onMudar(v);
    // Fechar sem escolher descarta as opções (a mensagem fica como descartada; nada mudou na agenda).
    if (resposta && !feita) void trocarPecaDescartar(resposta.mensagem_id).catch(() => undefined);
    onMudar(false);
  };

  const rodape = feita ? (
    <div className="flex min-w-0 flex-wrap items-center justify-end">
      <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={() => resposta && void desfazer(resposta.mensagem_id)} disabled={!!agindo}>
        {agindo === "desfazer" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
        Desfazer
      </button>
      <button type="button" className={botao.primario} onClick={() => onMudar(false)}>Fechar</button>
    </div>
  ) : resposta ? (
    <div className="flex min-w-0 flex-wrap items-center justify-end">
      <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={() => void fechar(false)} disabled={!!agindo}>Cancelar</button>
      <button type="button" className={botao.primario} onClick={() => void trocar()} disabled={!!agindo} data-confirmar-troca="">
        {agindo === "trocar" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
        Trocar pela {escolhida + 1}
      </button>
    </div>
  ) : (
    <div className="flex min-w-0 flex-wrap items-center justify-end">
      <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={() => onMudar(false)}>Cancelar</button>
      <BotaoComCusto
        rotulo="Ver 3 opções"
        titulo="Opções para trocar a peça"
        descricao="3 substitutas do mesmo dia (outro tema e, sem formato escolhido, outros formatos); o Jev recomenda uma. Nada muda antes de confirmar."
        partes={() => partesDaTroca(catalogo)}
        executar={pedirOpcoes}
        fecharAoConfirmar
      />
    </div>
  );

  return (
    <JanelaCentral
      aberta={aberta}
      onMudar={(v) => void fechar(v)}
      titulo="Trocar a peça"
      icone={<Shuffle className="h-4 w-4" />}
      descricao={`${peca.title} · ${data}`}
      largura="md"
      rodape={rodape}
      data-trocar-peca={feita ? "feita" : resposta ? "opcoes" : "pedido"}
    >
      {feita ? (
        <p className={texto.corpo} role="status">
          <Check className="mr-1.5 inline h-4 w-4 text-success" aria-hidden="true" />
          Agora é <span className="font-medium">{feita}</span>. Dá para desfazer.
        </p>
      ) : resposta ? (
        <div className="min-w-0 space-y-2" role="radiogroup" aria-label="Opções para trocar">
          {resposta.opcoes.map((o, i) => {
            const Icone = ICONE_DA_OPCAO[o.opcao];
            const marcada = escolhida === i;
            const recomendada = i === resposta.recomendada && resposta.fonte_da_recomendacao === "jev";
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={marcada}
                onClick={() => setEscolhida(i)}
                data-opcao-da-troca={o.opcao}
                className={juntar(
                  "flex w-full min-w-0 items-start rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  marcada ? "border-primary bg-primary/[0.06]" : "border-border hover:border-primary/50",
                )}
              >
                <Icone className={juntar("mr-2.5 mt-0.5 h-4 w-4 shrink-0", marcada ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  <span className={juntar(texto.corpo, "block font-medium")}>
                    {i + 1}. {o.tema}
                  </span>
                  <span className={juntar(texto.auxiliar, "mt-0.5 block whitespace-normal")}>
                    {o.rotulo}{o.laminas ? ` · ${o.laminas} ${o.laminas === 1 ? "lâmina" : "lâminas"}` : ""}{o.gancho ? ` · ${o.gancho}` : ""}
                  </span>
                  {o.por_que && <span className={juntar(texto.auxiliar, "mt-0.5 block whitespace-normal")}>{o.por_que}</span>}
                </span>
                {recomendada && (
                  <span className="ml-2 inline-flex shrink-0 items-center text-primary" title={`O Jev recomenda${resposta.notas[i] !== null ? `: ${nivel(resposta.notas[i])}` : ""}`} aria-label="Recomendada pelo Jev" data-recomendada="">
                    <ThumbsUp className="h-4 w-4" aria-hidden="true" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="min-w-0 space-y-4">
          <EscolhaDeFormatos unico rotulo="Trocar por" valor={opcao} onMudar={setOpcao} vazio="Qualquer formato (o painel varia)" />
          <label className="block min-w-0 space-y-1">
            <span className={texto.rotulo}>Pedido (opcional)</span>
            <input className={campo} value={pedido} maxLength={600} onChange={(e) => setPedido(e.target.value)} placeholder="Ex.: algo de bastidor, mais leve" aria-label="Pedido para a troca" />
          </label>
        </div>
      )}
    </JanelaCentral>
  );
}
