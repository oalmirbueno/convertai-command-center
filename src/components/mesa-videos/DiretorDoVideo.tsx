import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Loader2, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { Ditado } from "@/components/mesa/Ditado";
import { textoDoErro } from "@/lib/mesa/api";
import CartaoDeAcao, { OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import HistoricoDoAgente from "@/components/agentes/HistoricoDoAgente";
import { acaoDoAnexo, type AcaoDoAgente, type PedidoDaAcao, type RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campoTexto, conversa, juntar, texto } from "@/components/sistema/estilos";
import { chaveDaConversaDoDiretor, type MensagemGuardadaDoDiretor, projetoAtualDoDiretor, useConversaDoDiretor, useProjetoDoDiretor } from "@/lib/mesa-videos/api";
import { FASES_DO_DIRETOR, type FaseDoDiretor, type ProjetoDoDiretor } from "../../../supabase/functions/mesa-videos/modulos/diretor-de-video";
import type { IrPara } from "./MesaDeVideo";
import { chamarMesaVideos, chaveDosArquivos, chaveDosPedidos } from "./videosApi";

/**
 * Agente DIRETOR (frente V-A), no painel fixo da Mesa Vídeos.
 * Briefing -> Pesquisa (web, com fontes) -> Bíblia -> Roteiro -> Gerar
 * (cartão com custo, Confirmar) -> Avaliar -> Editor. GPT-6 Luna com
 * raciocínio máximo, pela carteira do cliente (centavos por resposta). As
 * mudanças na bíblia e no roteiro entram no projeto aberto e têm Desfazer.
 * O diretor só usa fato com fonte e o contexto do cliente; o resto pergunta.
 *
 * AG2 (29/09): a conversa mora no banco (agente_conversas do projeto) e volta
 * ao reabrir, com os cartões no estado de agora. Pedido que falha não some: a
 * bolha sai e o texto volta ao campo com o erro. O projeto sempre recebe a
 * versão nova do banco (antes o segundo pedido dava "mudado em outra tela"), e
 * o Desfazer grava a volta no banco. "Aprendi" e "Segui" ficam embaixo da resposta.
 */

interface Mensagem {
  id: string;
  papel: "usuario" | "agente";
  texto: string;
  mensagem_id?: string | null;
  acao?: AcaoDoAgente | null;
  perguntas?: string[];
  avisos?: string[];
  custo?: number | null;
  mudou?: boolean;
  anexos?: unknown[];
  aviso?: string | null;
}

const ROTULO_DA_FASE: Record<FaseDoDiretor, string> = { briefing: "Briefing", pesquisa: "Pesquisa", biblia: "Bíblia", roteiro: "Roteiro", livre: "Conversa" };
const ETAPA_DA_FASE: Partial<Record<FaseDoDiretor, string>> = { biblia: "biblia", roteiro: "roteiro", pesquisa: "biblia" };
const MAX = 40;
let n = 0;
const novoId = () => `d${Date.now().toString(36)}${(n++).toString(36)}`;

const CAPACIDADES = ["pesquisar a região com fontes", "montar a bíblia e o roteiro plano a plano", "trocar plano, gerar e refazer com o custo à vista", "avaliar a continuidade e mandar ao editor (com Desfazer)"];

/** A mensagem guardada como a tela mostra (a ação e o aprendizado vêm dos anexos). */
export function mensagemDaConversa(m: MensagemGuardadaDoDiretor): Mensagem {
  const acao = m.anexos.map(acaoDoAnexo).find((a): a is AcaoDoAgente => !!a) || null;
  return { id: m.id, papel: m.papel, texto: m.conteudo, mensagem_id: m.papel === "agente" ? m.id : null, acao, anexos: m.anexos };
}

/** Título do cartão pela operação (gerar, refazer, editor). */
export function tituloDoCartao(a: AcaoDoAgente): string {
  if (a.itens.some((i) => i.operacao === "mandar_ao_editor")) return "Mandar ao editor";
  const ctx = (a.contexto || {}) as { refazer?: boolean };
  return ctx.refazer ? "Refazer planos" : "Gerar planos";
}

export function observacaoDoCartao(a: AcaoDoAgente): string {
  if (a.itens.some((i) => i.operacao === "mandar_ao_editor")) return "Sem custo. O Desfazer deixa a versão rejeitada (não some).";
  return `Custo estimado US$ ${Number(a.custo_estimado_usd || 0).toFixed(2).replace(".", ",")}. Sem desfazer.`;
}

export default function DiretorDoVideo({ irPara, topo }: { irPara: IrPara; topo: ReactNode }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const { projeto, trocar, mudar, desfazer, podeDesfazer } = useProjetoDoDiretor(clientId);
  const [mensagens, setMensagens] = useEstadoDaTela<Mensagem[]>(`mesa-videos:diretor:conversa:${clientId}`, [], { validar: (v) => Array.isArray(v) });
  const [textoDoCampo, setTexto] = useEstadoDaTela<string>(`mesa-videos:diretor:rascunho:${clientId}`, "");
  const [fase, setFase] = useEstadoDaTela<FaseDoDiretor>(`mesa-videos:diretor:fase:${clientId}`, projeto.fase || "briefing", { validar: (v) => (FASES_DO_DIRETOR as readonly string[]).indexOf(String(v)) >= 0 });
  const [pensando, setPensando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  // Respostas que chegaram agora nesta tela (o "faz e me leva" só navega nelas; nunca vai para o navegador).
  const novas = useRef<Set<string>>(new Set());
  // A conversa guardada no banco manda (reabrir, outra aba, outro computador).
  const guardada = useConversaDoDiretor(clientId, projeto.id);
  const chaveDaLeitura = guardada.data ? guardada.data.mensagens.map((m) => `${m.id}:${m.anexos.length}`).join("|") : "";
  useEffect(() => {
    if (!guardada.data || pensando || !guardada.data.mensagens.length) return;
    const doBanco = guardada.data.mensagens;
    // O banco manda no texto e no cartão; o que só a resposta ao vivo trouxe (perguntas, avisos, custo) fica.
    setMensagens((locais) =>
      doBanco
        .map((g) => {
          const m = mensagemDaConversa(g);
          const local = m.papel === "agente" ? locais.find((x) => x.mensagem_id === g.id) : null;
          return local ? { ...m, id: local.id, perguntas: local.perguntas, avisos: local.avisos, custo: local.custo, mudou: local.mudou, aviso: local.aviso } : m;
        })
        .slice(-MAX),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDaLeitura]);
  useEffect(() => {
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, pensando]);
  const juntarMensagens = (mais: Mensagem[]) => setMensagens((m) => m.concat(mais).slice(-MAX));
  const recarregarConversa = (projetoId: string | null) => void queryClient.invalidateQueries({ queryKey: chaveDaConversaDoDiretor(clientId, projetoId) });
  // Histórico (Nova conversa, Continuar esta, Arquivar): limpa a tela e relê a conversa ativa do projeto.
  const trocarConversa = async () => {
    novas.current.clear();
    setErro(null);
    const r = await guardada.refetch();
    if (r.error) {
      setErro(textoDoErro(r.error));
      return;
    }
    // Sem conversa ativa ("Nova conversa"): a tela fica vazia e a próxima mensagem abre outra.
    setMensagens(((r.data && r.data.mensagens) || []).map(mensagemDaConversa).slice(-MAX));
  };

  const pedir = async () => {
    const t = textoDoCampo.trim();
    if (!t || pensando) return;
    const idDoPedido = novoId();
    juntarMensagens([{ id: idDoPedido, papel: "usuario", texto: t }]);
    setTexto("");
    setErro(null);
    setPensando(true);
    try {
      const historico = mensagens.slice(-8).map((m) => ({ papel: m.papel, texto: m.texto.slice(0, 600) }));
      const r = await chamarMesaVideos<{ projeto: ProjetoDoDiretor; resposta: string; perguntas: string[]; avisos: string[]; custo_usd: number; mensagem_id: string | null; acao: unknown; anexos?: unknown[]; aviso_registro?: string; gravado: boolean }>({
        acao: "diretor_conversar",
        client_id: clientId,
        projeto,
        texto: t,
        fase,
        conversa: historico,
      });
      const mudou = JSON.stringify(r.projeto.biblia) !== JSON.stringify(projeto.biblia) || JSON.stringify(r.projeto.roteiro) !== JSON.stringify(projeto.roteiro) || r.projeto.id !== projeto.id;
      if (mudou) trocar(r.projeto);
      // Sem mudança de conteúdo o banco ainda subiu a versão: a tela precisa dela para o próximo pedido.
      else if (r.projeto.versao !== projeto.versao || r.projeto.atualizado_em !== projeto.atualizado_em) mudar(() => r.projeto, false);
      atualizarCusto();
      const a = acaoDoAnexo(r.acao);
      const idDaResposta = novoId();
      novas.current.add(idDaResposta);
      juntarMensagens([{ id: idDaResposta, papel: "agente", texto: r.resposta, perguntas: r.perguntas, avisos: r.avisos, custo: r.custo_usd, mensagem_id: r.mensagem_id, acao: a, mudou, anexos: r.anexos || [], aviso: r.aviso_registro || null }]);
      if (a && a.executada_em) void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      recarregarConversa(r.projeto.id);
      if (mudou && ETAPA_DA_FASE[fase]) irPara(ETAPA_DA_FASE[fase] as string);
    } catch (e) {
      // A mensagem não some: a bolha sai, o texto volta ao campo e o erro fica à vista.
      setMensagens((l) => l.filter((m) => m.id !== idDoPedido));
      setTexto(t);
      setErro(textoDoErro(e));
      toast.error("O diretor não respondeu", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setPensando(false);
    }
  };

  const voltarMudanca = async () => {
    if (!desfazer()) return;
    const atual = projetoAtualDoDiretor(clientId);
    if (!atual.id) {
      toast.success("Voltou como estava");
      return;
    }
    // A volta também vai para o banco (senão o próximo pedido partia do projeto desfeito só na tela).
    try {
      const r = await chamarMesaVideos<{ projeto: ProjetoDoDiretor }>({ acao: "diretor_salvar", client_id: clientId, projeto: atual, versao_lida: atual.versao });
      mudar(() => r.projeto, false);
      toast.success("Voltou como estava");
    } catch (e) {
      toast.error("Voltou nesta tela, mas não foi salvo", { description: textoDoErro(e), duration: 9000 });
    }
  };

  const onPedido = (m: Mensagem) => (pedido: PedidoDaAcao): Promise<RespostaDaAcao> => {
    const corpo: Record<string, unknown> = { acao: pedido === "desfazer" ? "desfazer_acao_agente" : "executar_acao_agente", mensagem_id: m.mensagem_id, acao_id: m.acao ? m.acao.id : undefined };
    if (pedido === "descartar") corpo.descartar = true;
    if (pedido === "parar") corpo.parar = true;
    return chamarMesaVideos<RespostaDaAcao>(corpo);
  };

  return (
    <PainelDoAgente
      titulo="Diretor"
      icone={<Clapperboard className="h-4 w-4" />}
      descricao={`${projeto.titulo || "Projeto"} · ${projeto.roteiro.planos.length} planos`}
      acoes={
        <>
          {podeDesfazer && (
            <button type="button" className={botao.icone} onClick={() => void voltarMudanca()} aria-label="Desfazer a última mudança do diretor" title="Desfazer">
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          )}
          <HistoricoDoAgente chave={clientId && projeto.id ? { clientId, agente: "diretor_arte", referenciaTipo: "mesa_videos", referenciaId: projeto.id } : null} aoTrocar={() => void trocarConversa()} />
          <AjudaRecolhida rotulo="Como o diretor funciona">
            O diretor pesquisa (com fontes), monta a bíblia (personagens, cenários, luz, regras) e o roteiro plano a plano. Diga "troca o motor do p2", "gera a segunda", "refaz p3 mais aberto" ou "manda ao editor". Ele não inventa fato: o que não sabe vira pergunta. Gerar sempre pede a sua confirmação com o custo; mandar ao editor tem Desfazer. O que você ensinar ("nunca...", "não gostei de...") vira regra. Cada resposta custa centavos (GPT-6 Luna, raciocínio máximo) na carteira do cliente.
          </AjudaRecolhida>
        </>
      }
      topo={
        <div className="space-y-2">
          {topo}
          <SeletorCompacto rotulo="Fase do diretor" opcoes={FASES_DO_DIRETOR.map((f) => ({ valor: f, rotulo: ROTULO_DA_FASE[f] }))} valor={fase} onEscolher={(v) => setFase(v as FaseDoDiretor)} />
        </div>
      }
      refDasMensagens={lista}
      rotuloDasMensagens="Conversa com o diretor"
      compositor={
        <>
          <OQuePossoFazer capacidades={CAPACIDADES} />
          {erro && (
            <p role="alert" className={juntar(texto.auxiliar, "mb-1 text-destructive")} data-erro-do-diretor="">
              Não foi: {erro}
            </p>
          )}
          <textarea
            className={juntar(campoTexto, "min-h-[64px] resize-none")}
            value={textoDoCampo}
            rows={2}
            onChange={(e) => {
              setTexto(e.target.value);
              if (erro) setErro(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void pedir();
              }
            }}
            placeholder={fase === "pesquisa" ? "Ex.: pesquisa a Lapa de Curitiba no inverno, arquitetura e luz" : "Ex.: quero um filme de 30 s de uma padaria da família"}
            aria-label="Pedido para o diretor"
            disabled={pensando}
          />
          <div className="flex min-w-0 items-center justify-end">
            <span className={juntar(texto.auxiliar, "mr-2 min-w-0 flex-1 truncate")}>Centavos por resposta</span>
            <Ditado valor={textoDoCampo} onChange={setTexto} disabled={pensando} className="mr-1.5 min-w-0" />
            <button type="button" className={botao.primario} onClick={() => void pedir()} disabled={pensando || !textoDoCampo.trim()}>
              {pensando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              Enviar
            </button>
          </div>
        </>
      }
    >
      {!mensagens.length && !pensando && (
        <p className={juntar(conversa.apoio, "leading-relaxed")} data-diretor-vazio="">
          Conte o vídeo que quer (nicho, lugar, jeito) ou escolha um kit.
        </p>
      )}
      {mensagens.map((m) => (
        <div key={m.id} className="min-w-0 space-y-2">
          <div className={juntar(conversa.balao, m.papel === "usuario" ? conversa.doUsuario : conversa.doAgente)}>
            {m.papel === "agente" ? <TextoDoAgente texto={m.texto} clientId={clientId} /> : <p className="whitespace-pre-wrap">{m.texto}</p>}
            {m.perguntas && m.perguntas.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-4">
                {m.perguntas.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            )}
            {m.avisos && m.avisos.length > 0 && <p className={juntar(texto.auxiliar, "mt-2")}>{m.avisos.slice(0, 3).join(" ")}</p>}
            {(m.mudou || typeof m.custo === "number") && (
              <p className={juntar(texto.auxiliar, "mt-1")}>
                {m.mudou ? "Projeto atualizado. " : ""}
                {typeof m.custo === "number" ? `US$ ${m.custo.toFixed(3).replace(".", ",")}` : ""}
              </p>
            )}
            {m.aviso && (
              <p className={juntar(texto.auxiliar, "mt-1 text-warning")} data-aviso-registro="">
                {m.aviso}
              </p>
            )}
            {m.papel === "agente" && (
              <AprendizadoDoAgente
                anexos={m.anexos}
                onEsquecer={(id) => chamarMesaVideos({ acao: "aprendizado_esquecer", client_id: clientId, id, mensagem_id: m.mensagem_id })}
                onGuardar={(textoDaRegra, tipo) => chamarMesaVideos({ acao: "aprendizado_guardar", client_id: clientId, texto: textoDaRegra, tipo, mensagem_id: m.mensagem_id })}
              />
            )}
          </div>
          {m.acao && m.mensagem_id && (
            <CartaoDeAcao
              acao={m.acao}
              titulo={tituloDoCartao(m.acao)}
              observacao={observacaoDoCartao(m.acao)}
              recemFeita={novas.current.has(m.id)}
              onPedido={onPedido(m)}
              onFeito={(_p, resposta) => {
                const novo = acaoDoAnexo(resposta && resposta.anexo);
                if (novo) setMensagens((l) => l.map((x) => (x.id === m.id ? { ...x, acao: novo } : x)));
                void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
                void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
                recarregarConversa(projeto.id);
                atualizarCusto();
              }}
            />
          )}
        </div>
      ))}
      {pensando && (
        <p className={juntar(conversa.apoio, "mr-6 flex items-center px-1")}>
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> O diretor está pensando{fase === "pesquisa" ? " e pesquisando" : ""}...
        </p>
      )}
    </PainelDoAgente>
  );
}
