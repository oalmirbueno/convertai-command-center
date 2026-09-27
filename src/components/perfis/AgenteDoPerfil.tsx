import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Bot, Loader2, Send } from "lucide-react";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { CaminhoDaMensagem } from "@/components/agentes/CaminhoPronto";
import BotaoDoEstilo from "@/components/estilo/BotaoDoEstilo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { avisarCustoReal, useAvisarErro } from "@/components/mesa/Custo";
import { acoesDaMensagem, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import {
  chamarPerfis,
  MAX_PAUTAS,
  type MensagemDoPerfil,
  mesesDoPlano,
  MIN_PAUTAS,
  type PerfilNaLista,
  type PostDoPerfil,
} from "./perfisApi";

/**
 * Agente do perfil (frente P): conversa sobre o perfil e quatro atalhos que
 * fazem o trabalho pesado no servidor. Tudo que muda algo fora daqui volta
 * como lista para confirmar (CartaoDeAcao): levar posts ao estilo do cliente
 * e pôr pautas na agenda do Mês. O botão Estilo abre o agente de estilo para
 * ver e confirmar a proposta dele.
 */

type Pautinha = { id?: string; tema?: string; formato?: string; pilar?: string; gancho?: string };

function PautasDoAnexo({ anexo }: { anexo: any }) {
  const pautas: Pautinha[] = Array.isArray(anexo && anexo.pautas) ? anexo.pautas : [];
  const bloqueadas: Array<{ tema?: string; motivo?: string }> = Array.isArray(anexo && anexo.bloqueadas) ? anexo.bloqueadas : [];
  if (!pautas.length && !bloqueadas.length) return null;
  return (
    <details className="mt-1.5 min-w-0 text-[12px]">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        Ver {pautas.length} {pautas.length === 1 ? "pauta" : "pautas"}
        {bloqueadas.length ? ` e ${bloqueadas.length} fora` : ""}
      </summary>
      <ul className="mt-1 divide-y divide-border">
        {pautas.map((p, i) => (
          <li key={p.id || i} className="py-1 [overflow-wrap:anywhere]">
            <span className="font-medium">{p.tema}</span>
            <span className="text-muted-foreground"> · {p.formato === "carrossel" ? "carrossel" : "estático"}{p.pilar ? ` · ${p.pilar}` : ""}</span>
            {p.gancho && <span className="block text-muted-foreground">{p.gancho}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function AgenteDoPerfil({
  perfil,
  mensagens,
  escolhidos,
  posts,
  onMudou,
  onLimparEscolha,
}: {
  perfil: PerfilNaLista;
  mensagens: MensagemDoPerfil[];
  escolhidos: string[];
  posts: PostDoPerfil[];
  onMudou: () => void;
  onLimparEscolha: () => void;
}) {
  const { clientId, marca, atualizarCusto } = useMesa();
  const marcaId = marca && !marca.principal ? marca.id : null;
  const avisarErro = useAvisarErro();
  const meses = mesesDoPlano();
  const [rascunho, setRascunho] = useEstadoDaTela<string>(`mesa:perfis:rascunho:${perfil.id}`, "");
  const [mes, setMes] = useEstadoDaTela<string>(`mesa:perfis:mes:${perfil.id}`, meses.proximo, { validar: (v) => v === meses.atual || v === meses.proximo });
  const [quantidade, setQuantidade] = useEstadoDaTela<number>(`mesa:perfis:quantidade:${perfil.id}`, 8, { validar: (v) => typeof v === "number" && v >= MIN_PAUTAS && v <= MAX_PAUTAS });
  const [trabalhando, setTrabalhando] = useState<string | null>(null);
  const [pedidoAgora, setPedidoAgora] = useState<string | null>(null);
  // A resposta que acabou de chegar nesta tela: só ela pode abrir sozinha ("faz e me leva").
  const [recebida, setRecebida] = useState<string | null>(null);
  const lista = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [mensagens.length, trabalhando]);

  const pedir = async (acao: string, rotulo: string, extra: Record<string, unknown> = {}, mostrar?: string): Promise<boolean> => {
    if (trabalhando) return false;
    setTrabalhando(acao);
    setPedidoAgora(mostrar || null);
    try {
      const r = await chamarPerfis<any>(acao, clientId, marcaId, { perfil_id: perfil.id, ...extra });
      if (acao === "conversar") setRascunho("");
      setRecebida(r && r.mensagem_id ? String(r.mensagem_id) : null);
      if (Number(r && r.custo_usd) > 0) avisarCustoReal(rotulo, r, atualizarCusto);
      onMudou();
      return true;
    } catch (e) {
      avisarErro(e, rotulo);
      return false;
    } finally {
      setTrabalhando(null);
      setPedidoAgora(null);
    }
  };

  const enviar = () => {
    const t = rascunho.trim();
    if (!t) return;
    void pedir("conversar", "Agente do perfil", { mensagem: t }, t);
  };
  const aoTeclar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  };
  const refs = posts.filter((p) => escolhidos.indexOf(p.id) >= 0).map((p) => p.ref);

  const atalhos = (
    <div className="flex min-w-0 flex-wrap" role="group" aria-label="Ações do agente do perfil">
      <button
        type="button"
        className={juntar(botao.secundario, "mb-1.5 mr-1.5 h-8 px-2.5 text-[12px]")}
        disabled={!!trabalhando || !escolhidos.length}
        title={escolhidos.length ? `Levar ${refs.join(", ")} ao estilo do cliente` : "Escolha posts na grade"}
        onClick={() => void pedir("propor_estilo", "Levar ao estilo", { post_ids: escolhidos }, `Levar ao estilo: ${refs.join(", ")}`).then((ok) => ok && onLimparEscolha())}
      >
        Levar ao estilo{escolhidos.length ? ` (${escolhidos.length})` : ""}
      </button>
      <button type="button" className={juntar(botao.secundario, "mb-1.5 mr-1.5 h-8 px-2.5 text-[12px]")} disabled={!!trabalhando} onClick={() => void pedir("plano_igual", "Plano igual", { mes, quantidade }, `Plano igual para ${mes}`)}>
        Plano igual
      </button>
      <button type="button" className={juntar(botao.secundario, "mb-1.5 mr-1.5 h-8 px-2.5 text-[12px]")} disabled={!!trabalhando} onClick={() => void pedir("comparar", "Comparar com o cliente", {}, "Comparar com o cliente")}>
        Comparar
      </button>
      <button type="button" className={juntar(botao.secundario, "mb-1.5 h-8 px-2.5 text-[12px]")} disabled={!!trabalhando} onClick={() => void pedir("ideias_resposta", "Ideias de resposta", {}, "Ideias de resposta")}>
        Ideias de resposta
      </button>
    </div>
  );

  const topo = (
    <div className="flex min-w-0 items-center" data-plano-do-perfil="">
      <span className={juntar(texto.rotulo, "mr-2 shrink-0")}>Plano</span>
      <SeletorCompacto
        rotulo="Mês do plano"
        valor={mes}
        onEscolher={setMes}
        opcoes={[
          { valor: meses.atual, rotulo: "Este mês" },
          { valor: meses.proximo, rotulo: "Próximo" },
        ]}
      />
      <label className="ml-2 flex min-w-0 items-center">
        <span className="sr-only">Quantas pautas</span>
        <select className={juntar(campo, "h-9 w-[76px] px-2")} value={quantidade} onChange={(e) => setQuantidade(Number(e.target.value))} aria-label="Quantas pautas">
          {[4, 6, 8, 10, 12].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <PainelDoAgente
      titulo="Agente do perfil"
      descricao={`@${perfil.handle}`}
      icone={<Bot className="h-4 w-4" />}
      acoes={<BotaoDoEstilo />}
      topo={topo}
      refDasMensagens={lista}
      rotuloDasMensagens={`Conversa sobre @${perfil.handle}`}
      compositor={
        <>
          {atalhos}
          <div className="flex min-w-0 items-end">
            <textarea
              className={juntar(campoTexto, "min-h-[40px] flex-1 resize-none")}
              rows={2}
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              onKeyDown={aoTeclar}
              placeholder="Pergunte sobre o perfil"
              aria-label="Mensagem para o agente do perfil"
            />
            <button type="button" className={juntar(botao.primario, "ml-2 h-10 w-10 px-0")} onClick={enviar} disabled={!!trabalhando || !rascunho.trim()} aria-label="Enviar">
              {trabalhando === "conversar" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </>
      }
    >
      {mensagens.length === 0 && !trabalhando && (
        <p className={texto.auxiliar}>Escolha posts e leve ao estilo, peça um plano igual, compare com o cliente ou peça ideias de resposta.</p>
      )}
      {mensagens.map((m, i) => {
        const acoes = m.papel === "agente" ? acoesDaMensagem(m.anexos) : [];
        const pautas = m.papel === "agente" && Array.isArray(m.anexos) ? m.anexos.find((a: any) => a && a.tipo === "pautas_do_perfil") : null;
        if (m.papel === "sistema") {
          return (
            <p key={m.id || i} className={juntar(texto.auxiliar, "text-center")}>
              {m.conteudo}
            </p>
          );
        }
        return (
          <div key={m.id || i} className={juntar("min-w-0", m.papel === "usuario" ? "flex justify-end" : "")}>
            <div className={juntar("min-w-0 max-w-full rounded-lg px-3 py-2 text-[13px] leading-5 [overflow-wrap:anywhere]", m.papel === "usuario" ? "ml-6 bg-primary/10" : "bg-muted/50")}>
              <TextoDoAgente texto={m.conteudo} clientId={clientId} />
              {pautas && <PautasDoAnexo anexo={pautas} />}
            </div>
            {m.papel === "agente" && <CaminhoDaMensagem anexos={m.anexos} recente={!!m.id && m.id === recebida} />}
            {m.id &&
              acoes.map((a) => (
                <div key={a.id} className="mt-2 min-w-0">
                  <CartaoDeAcao
                    acao={a}
                    recemFeita={!!m.id && m.id === recebida}
                    titulo={a.itens.some((x) => x.operacao === "agendar") ? "Vai para a agenda" : "Vai para o estilo"}
                    observacao={a.itens.some((x) => x.operacao === "levar_ao_estilo") ? "O estilo só muda com a confirmação no agente de estilo." : undefined}
                    onPedido={(pedido) => chamarAcaoDoAgente("perfis-instagram", m.id as string, a.id, pedido, { client_id: clientId, ...(marcaId ? { marca_id: marcaId } : {}) })}
                    onFeito={(_, r) => {
                      if (Number(r && r.custo_usd) > 0) atualizarCusto();
                      onMudou();
                    }}
                  />
                </div>
              ))}
          </div>
        );
      })}
      {trabalhando && (
        <>
          {pedidoAgora && (
            <div className="flex justify-end">
              <p className="ml-6 rounded-lg bg-primary/10 px-3 py-2 text-[13px] [overflow-wrap:anywhere]">{pedidoAgora}</p>
            </div>
          )}
          <p className={juntar(texto.auxiliar, "flex items-center")} aria-live="polite">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Trabalhando...
          </p>
        </>
      )}
    </PainelDoAgente>
  );
}
