import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard, Loader2, Scissors, Send } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { Ditado } from "@/components/mesa/Ditado";
import { textoDoErro } from "@/lib/mesa/api";
import CartaoDeAcao, { OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import { acaoDoAnexo, type AcaoDoAgente, type PedidoDaAcao, type RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campoTexto, conversa, juntar } from "@/components/sistema/estilos";
import { montarPacote } from "../../../supabase/functions/_shared/pacote-de-edicao";
import { ehPedidoDeVideo } from "../../../supabase/functions/_shared/pedidos-de-video";
import { INTENCOES, NENHUMA, intencaoPorPalavras, type MesaDoAgente } from "../../../supabase/functions/_shared/agente-de-video";
import { useAcoesGuardadas } from "@/lib/mesa-videos/api";
import { entradaDoPacote } from "@/components/mesa-edicao/pacote";
import { deixarPedidoParaOEditor } from "@/components/mesa-edicao/editor/ponteDoAgente";
import type { PropsDoAgenteDaMesa } from "./MesaDeVideo";
import {
  chamarMesaVideos,
  chaveDosArquivos,
  fotoDaCenaNoAcervo,
  naEntradaDaEdicao,
  type ArquivoDeVideo,
  useArquivosDeVideo,
  useHistorias,
  usePedidos,
  useRoteirosAprovados,
} from "./videosApi";
import { useFotos } from "@/components/mesa-foto/fotoApi";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { Carregando } from "@/components/sistema/Estados";

// Frente V-A: o agente da Mesa Vídeos ganhou o modo Diretor (baixa só quando aberto).
const DiretorDoVideo = lazy(() => import("./DiretorDoVideo"));

/**
 * Agente fixo da Mesa Vídeos e da Mesa Edição (frente E2, 26/09). Entende o
 * pedido (atalho, texto ou microfone), abre a etapa certa, resume o que falta
 * e PROPÕE as mudanças pelo contrato comum: organizar os takes (Mesa Edição) e
 * mandar os vídeos gerados para a Edição (Mesa Vídeos), com Confirmar/Cancelar
 * e Desfazer. O texto livre passa pelo Jev na função (fração de centavo); sem
 * ele, as palavras do pedido decidem. A conversa fica guardada por cliente.
 *
 * AG2 (29/09): o texto livre vai para agente_agir, que entende E age: mandar
 * para a Edição, arquivar, ligar à cena e organizar os vídeos que o pedido
 * aponta ("essa", "a segunda", "todos", "r2"), na ordem da tela. Ordem clara
 * sem custo vai na hora, com a prova e o Desfazer no cartão; dúvida vira UMA
 * pergunta. Os cartões voltam no estado do banco ao reabrir. Pedido que falha
 * não some: a bolha sai e o texto volta ao campo com o erro à vista.
 */

interface Mensagem {
  id: string;
  papel: "usuario" | "agente";
  texto: string;
  mensagem_id?: string | null;
  acao?: AcaoDoAgente | null;
  /** "Aprendi"/"Segui" que a resposta trouxe. */
  anexos?: unknown[];
  /** A resposta chegou, mas o registro falhou (aviso_registro). */
  aviso?: string | null;
}

const MAX_MENSAGENS = 40;
/** Até 4 atalhos por mesa (o resto o texto alcança). */
const ATALHOS: Record<MesaDoAgente, string[]> = { videos: ["gerar", "enviar_para_edicao", "situacao"], edicao: ["organizar", "pacote", "transcrever", "situacao"] };
let contador = 0;
const novoId = () => `m${Date.now().toString(36)}${(contador++).toString(36)}`;

const CAPACIDADES: Record<MesaDoAgente, string[]> = {
  videos: ["abrir a cena certa para gerar", "mandar para a Edição, arquivar ou ligar à cena (\"essa\", \"a segunda\", \"todos\"), com Desfazer", "abrir o diretor e a troca de ângulo", "resumir o que falta"],
  edicao: ["separar por roteiro, cena e tomada", "renomear e marcar os melhores takes", "abrir o editor e passar o pedido de edição ao agente editor", "resumir o que falta"],
};

/** Título do cartão pela ação (mandar, organizar, arquivar, ligar à cena). */
export function tituloDoCartaoDaMesa(a: AcaoDoAgente): string {
  if (a.agente === "envio_para_edicao") return "Mandar para a Edição";
  if (a.agente === "resultados_da_mesa") return a.itens.some((i) => i.operacao === "vincular_cena") ? "Ligar à cena" : "Arquivar vídeos";
  return "Organizar os takes";
}

export default function AgenteDaMesaDeVideo({ mesa, etapa, irPara }: PropsDoAgenteDaMesa) {
  const { clientId, clientName } = useMesa();
  const queryClient = useQueryClient();
  const arquivosQ = useArquivosDeVideo(clientId);
  const pedidosQ = usePedidos(clientId);
  const historiasQ = useHistorias(clientId);
  const roteirosQ = useRoteirosAprovados(clientId);
  const fotosQ = useFotos(clientId);
  const [mensagens, setMensagens] = useEstadoDaTela<Mensagem[]>(`${mesa}:agente:conversa:${clientId}`, [], { validar: (v) => Array.isArray(v) });
  const [texto, setTexto] = useEstadoDaTela<string>(`${mesa}:agente:rascunho:${clientId}`, "");
  const [pensando, setPensando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  // Respostas que chegaram agora nesta tela (o "faz e me leva" só navega nelas).
  const novas = useRef<Set<string>>(new Set());
  // Frente V-A: Agente (atalhos) ou Diretor (bíblia, roteiro, pesquisa). Só na Mesa Vídeos.
  const [modoDoPainel, setModoDoPainel] = useEstadoDaTela<"agente" | "diretor">(`videos:agente:modo:${clientId}`, "agente", { validar: (v) => v === "agente" || v === "diretor" });

  useEffect(() => {
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mensagens.length, pensando]);

  const juntarMensagens = (mais: Mensagem[]) => setMensagens((m) => m.concat(mais).slice(-MAX_MENSAGENS));
  const responder = (t: string, extra: Partial<Mensagem> = {}) => {
    const id = novoId();
    novas.current.add(id);
    juntarMensagens([{ id, papel: "agente", texto: t, ...extra }]);
  };

  const arquivos = (arquivosQ.data && arquivosQ.data.arquivos) || [];
  const pedidos = (pedidosQ.data && pedidosQ.data.itens) || [];

  // Os cartões no estado de agora (feito em outra aba, desfeito...), relidos do banco ao abrir.
  const guardadas = useAcoesGuardadas(mensagens.filter((m) => m.acao && m.mensagem_id).map((m) => String(m.mensagem_id)));
  const chaveDasGuardadas = guardadas.data ? Object.keys(guardadas.data).map((k) => `${k}:${JSON.stringify(guardadas.data ? guardadas.data[k] : null).length}`).join("|") : "";
  useEffect(() => {
    const doBanco = guardadas.data;
    if (!doBanco) return;
    setMensagens((l) =>
      l.map((m) => {
        const atual = m.acao;
        if (!atual || !m.mensagem_id || !doBanco[m.mensagem_id]) return m;
        const achada = doBanco[m.mensagem_id].map(acaoDoAnexo).find((a) => !!a && a.id === atual.id) || null;
        return achada ? { ...m, acao: achada } : m;
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDasGuardadas]);

  /** A lista da etapa na ordem da tela (Resultados na Mesa Vídeos; Entrada na Mesa Edição): o servidor numera r1..rN igual. */
  const ordemDaTela = (): string[] =>
    arquivos.filter((a: ArquivoDeVideo) => (mesa === "videos" ? a.tipo === "gerado" && a.estado !== "arquivado" : naEntradaDaEdicao(a))).map((a: ArquivoDeVideo) => a.id);

  const situacao = (): string => {
    if (mesa === "videos") {
      const historias = (historiasQ.data && historiasQ.data.historias) || [];
      const cenas = historias.reduce((n, h) => n + h.cenas.filter((c) => fotoDaCenaNoAcervo(c, fotosQ.data || [])).length, 0);
      const roteiros = ((roteirosQ.data && roteirosQ.data.roteiros) || []).length;
      const fila = pedidos.filter((p) => ehPedidoDeVideo(p.tipo) && p.estado !== "cancelado").length;
      const gerados = arquivos.filter((a) => a.tipo === "gerado" && a.estado !== "arquivado");
      const naEdicao = gerados.filter((a) => a.edicao_desde).length;
      const partes = [
        `${cenas} ${cenas === 1 ? "cena com foto" : "cenas com foto"}`,
        `${roteiros} ${roteiros === 1 ? "roteiro aprovado" : "roteiros aprovados"}`,
        `${fila} na fila`,
        `${gerados.length} ${gerados.length === 1 ? "vídeo gerado" : "vídeos gerados"} (${naEdicao} na Edição)`,
      ];
      const falta = !cenas && !roteiros ? " Falta a base: monte a História no Canvas ou aprove um roteiro." : gerados.length > naEdicao ? " Há vídeo gerado esperando aprovação." : "";
      return `${partes.join(", ")}.${falta}`;
    }
    const naEntrada = arquivos.filter(naEntradaDaEdicao);
    const semGrupo = naEntrada.filter((a) => !a.grupo).length;
    const melhores = naEntrada.filter((a) => a.melhor).length;
    const roteiros = (roteirosQ.data && roteirosQ.data.roteiros) || [];
    const pacote = montarPacote(
      entradaDoPacote({
        clienteId: clientId,
        clienteNome: clientName,
        titulo: "Vídeo",
        arquivos: naEntrada,
        quais: "melhores",
        roteiro: roteiros[0] ? { id: roteiros[0].id, titulo: roteiros[0].titulo, cenas: roteiros[0].cenas } : null,
        historia: null,
        pedidos,
        destino: "editor",
        fps: null,
        formato: "9:16",
        direcao: "",
        agora: new Date().toISOString(),
      }),
    );
    const pend = pacote.pendencias.slice(0, 3);
    return `${naEntrada.length} ${naEntrada.length === 1 ? "vídeo" : "vídeos"} na Entrada, ${semGrupo} sem grupo, ${melhores} ${melhores === 1 ? "melhor take" : "melhores takes"}.${pend.length ? ` Falta: ${pend.join(" ")}` : ""}`;
  };

  const propor = async (acao: "takes_organizar_propor" | "resultados_para_edicao_propor", vazio: string) => {
    const r = await chamarMesaVideos<{ mensagem_id: string | null; acao: unknown }>({ acao, client_id: clientId });
    const a = acaoDoAnexo(r.acao);
    if (!r.mensagem_id || !a) responder(vazio);
    else responder(a.resumo || "A lista está pronta para confirmar.", { mensagem_id: r.mensagem_id, acao: a });
  };

  const executar = async (intencao: string, textoLivre: string | null = null) => {
    if (mesa === "videos") {
      if (intencao === "gerar") {
        const historias = (historiasQ.data && historiasQ.data.historias) || [];
        const comPedido = pedidos.filter((p) => ehPedidoDeVideo(p.tipo) && p.estado !== "cancelado").map((p) => `${String(p.alvo.canvas_id)}:${String(p.alvo.no_id)}`);
        let proxima: { valor: string; rotulo: string } | null = null;
        historias.forEach((h) =>
          h.cenas.forEach((c) => {
            if (!proxima && fotoDaCenaNoAcervo(c, fotosQ.data || []) && comPedido.indexOf(`${c.canvas_id}:${c.no_id}`) < 0) proxima = { valor: `cena:${c.canvas_id}:${c.no_id}`, rotulo: `${c.numero}. ${c.titulo || "Cena"}` };
          }),
        );
        const p = proxima as { valor: string; rotulo: string } | null;
        irPara("gerar", p ? { origem: p.valor } : {});
        return responder(p ? `Abri Gerar com a cena ${p.rotulo}. Confira o modelo e a duração.` : "Abri Gerar. Escolha a cena e o modelo.");
      }
      if (intencao === "enviar_para_edicao") return propor("resultados_para_edicao_propor", "Nenhum vídeo gerado esperando a Edição.");
      if (intencao === "resultados") {
        irPara("resultados");
        return responder("Abri os Resultados.");
      }
      if (intencao === "base") {
        irPara("base");
        return responder("Abri a Base.");
      }
      if (intencao === "diretor") {
        setModoDoPainel("diretor");
        irPara("kit");
        return responder("Abri o diretor e os kits.");
      }
      if (intencao === "angulo") {
        irPara("gerar", { modo: "angulo" });
        return responder("Abri a troca de ângulo em Gerar. Escolha a imagem e leve a câmera em volta da pessoa.");
      }
      if (intencao === "organizar") return propor("takes_organizar_propor", "Já está organizado: nomes e grupos seguem o padrão por roteiro e cena.");
      if (intencao === "arquivar" || intencao === "vincular") {
        irPara("resultados");
        return responder(intencao === "arquivar" ? "Abri os Resultados. Diga qual vídeo arquivar (ex.: \"arquiva o r2\") ou use o botão de cada um." : "Abri os Resultados. Diga qual vídeo e qual cena (ex.: \"liga o r1 à cena 2\").");
      }
    } else {
      if (intencao === "organizar") return propor("takes_organizar_propor", "Já está organizado: nomes e grupos seguem o padrão por roteiro e cena.");
      if (intencao === "subir") {
        irPara("entrada");
        return responder("Arraste os vídeos para a Entrada ou use Subir.");
      }
      if (intencao === "transcrever") {
        irPara("entrada", { parte: "transcricao" });
        return responder("Abri a transcrição. Escolha os vídeos e prepare o pedido.");
      }
      if (intencao === "pacote") {
        // Frente Q (26/09): pedido de editar vai para o agente editor da etapa Editar (nada roda sem o clique).
        if (textoLivre) deixarPedidoParaOEditor(clientId, textoLivre);
        irPara("editar", { parte: "pacote" });
        return responder(textoLivre ? "Abri o editor. O agente editor ficou com o seu pedido: confira o modelo e o custo em cima e mande." : "Abri o editor. O pacote para baixar fica embaixo dele.");
      }
      if (intencao === "versoes") {
        irPara("editar", { parte: "versoes" });
        return responder("Abri as versões.");
      }
    }
    if (intencao === "situacao") return responder(situacao());
    return responder(`Posso: ${CAPACIDADES[mesa].join(", ")}. Use um atalho ou diga de outro jeito.`);
  };

  const pedir = async (textoDoPedido: string, intencaoPronta?: string) => {
    const t = textoDoPedido.trim();
    if (!t || pensando) return;
    const idDoPedido = novoId();
    const ultima = mensagens.slice().reverse().find((m) => m.papel === "agente");
    juntarMensagens([{ id: idDoPedido, papel: "usuario", texto: t }]);
    if (!intencaoPronta) setTexto("");
    setErro(null);
    setPensando(true);
    try {
      if (intencaoPronta) {
        await executar(intencaoPronta, null);
        return;
      }
      let r: { intencao: string; resposta?: string | null; mensagem_id?: string | null; acao?: unknown; anexos?: unknown[]; aviso_registro?: string } | null = null;
      try {
        r = await chamarMesaVideos({ acao: "agente_agir", client_id: clientId, mesa, texto: t, ordem: ordemDaTela(), ultima_resposta: ultima ? ultima.texto.slice(0, 1000) : null });
      } catch (e) {
        // Sem a função agora: as palavras do pedido decidem o que abrir (nada age sem o servidor).
        console.warn("[agente da mesa] agente_agir falhou; vale a palavra do pedido", e);
        r = null;
      }
      if (!r) {
        await executar(intencaoPorPalavras(mesa, t), t);
        return;
      }
      const a = acaoDoAnexo(r.acao);
      const extra: Partial<Mensagem> = { anexos: r.anexos || [], aviso: r.aviso_registro || null };
      if (a && r.mensagem_id) {
        responder(r.resposta || a.resumo || "A lista está pronta para confirmar.", { ...extra, mensagem_id: r.mensagem_id, acao: a });
        if (a.executada_em) void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
        return;
      }
      if (r.resposta) {
        responder(r.resposta, extra);
        return;
      }
      await executar(r.intencao || NENHUMA, t);
      const anexos = extra.anexos || [];
      if (anexos.length) setMensagens((l) => (l.length && l[l.length - 1].papel === "agente" ? l.slice(0, -1).concat([{ ...l[l.length - 1], anexos }]) : l));
    } catch (e) {
      // A mensagem não some: a bolha sai e o texto volta ao campo (atalho: só o aviso).
      setMensagens((l) => l.filter((m) => m.id !== idDoPedido));
      if (!intencaoPronta) setTexto(t);
      setErro(textoDoErro(e));
      toast.error("O agente não conseguiu", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setPensando(false);
    }
  };

  const onPedido = (m: Mensagem) => (pedido: PedidoDaAcao): Promise<RespostaDaAcao> => {
    const corpo: Record<string, unknown> = {
      acao: pedido === "desfazer" ? "desfazer_acao_agente" : "executar_acao_agente",
      mensagem_id: m.mensagem_id,
      acao_id: m.acao ? m.acao.id : undefined,
    };
    if (pedido === "descartar") corpo.descartar = true;
    if (pedido === "parar") corpo.parar = true;
    return chamarMesaVideos<RespostaDaAcao>(corpo);
  };

  const guardarAnexo = (id: string, resposta: RespostaDaAcao) => {
    const novo = acaoDoAnexo(resposta && resposta.anexo);
    if (novo) setMensagens((lista) => lista.map((x) => (x.id === id ? { ...x, acao: novo } : x)));
    void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
  };

  const intencoes = INTENCOES[mesa];
  const icone = mesa === "edicao" ? <Scissors className="h-4 w-4" /> : <Clapperboard className="h-4 w-4" />;
  const trocaDeModo =
    mesa === "videos" ? (
      <SeletorCompacto rotulo="Modo do agente" larguraTotal opcoes={[{ valor: "agente", rotulo: "Agente" }, { valor: "diretor", rotulo: "Diretor" }]} valor={modoDoPainel} onEscolher={(v) => setModoDoPainel(v === "diretor" ? "diretor" : "agente")} />
    ) : null;

  if (mesa === "videos" && modoDoPainel === "diretor") {
    return (
      <Suspense fallback={<Carregando forma="lista" linhas={3} rotulo="Abrindo o diretor" />}>
        <DiretorDoVideo irPara={irPara} topo={trocaDeModo} />
      </Suspense>
    );
  }

  return (
    <PainelDoAgente
      topo={trocaDeModo || undefined}
      titulo={mesa === "edicao" ? "Agente de edição" : "Agente de vídeo"}
      icone={icone}
      descricao={mesa === "edicao" ? "Organiza e prepara a edição" : "Gera e manda para a Edição"}
      acoes={
        <AjudaRecolhida rotulo="Como o agente funciona">
          {mesa === "edicao"
            ? "Peça para organizar: ele separa por roteiro, cena e tomada, sugere nomes e os melhores takes, e você confirma na lista. Tudo tem Desfazer. O arquivo original nunca muda."
            : "Peça para gerar a próxima cena ou mandar os vídeos aprovados para a Edição. Nada gera nem gasta sem o seu clique."}
        </AjudaRecolhida>
      }
      refDasMensagens={lista}
      rotuloDasMensagens={mesa === "edicao" ? "Conversa com o agente de edição" : "Conversa com o agente de vídeo"}
      compositor={
        <>
          <OQuePossoFazer capacidades={CAPACIDADES[mesa]} />
          <div className="flex flex-wrap" role="group" aria-label="Atalhos do agente">
            {ATALHOS[mesa].map((v) => intencoes.find((i) => i.valor === v)).filter((i): i is (typeof intencoes)[number] => !!i).map((i) => (
              <button
                key={i.valor}
                type="button"
                disabled={pensando}
                onClick={() => void pedir(i.rotulo, i.valor)}
                className="mb-1 mr-1 max-w-full truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
              >
                {i.rotulo}
              </button>
            ))}
          </div>
          {erro && (
            <p role="alert" className="mb-1 text-[12px] leading-4 text-destructive" data-erro-do-agente="">
              Não foi: {erro}
            </p>
          )}
          <textarea
            className={juntar(campoTexto, "min-h-[64px] resize-none")}
            value={texto}
            rows={2}
            onChange={(e) => {
              setTexto(e.target.value);
              if (erro) setErro(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void pedir(texto);
              }
            }}
            placeholder={mesa === "edicao" ? "Ex.: organiza tudo por cena" : "Ex.: gera a próxima cena"}
            aria-label="Pedido para o agente"
            disabled={pensando}
          />
          <div className="flex min-w-0 items-center justify-end">
            <Ditado valor={texto} onChange={setTexto} disabled={pensando} className="mr-1.5 min-w-0" />
            <button type="button" className={botao.primario} onClick={() => void pedir(texto)} disabled={pensando || !texto.trim()}>
              {pensando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              Enviar
            </button>
          </div>
        </>
      }
    >
      {!mensagens.length && !pensando && (
        <p className={juntar(conversa.apoio, "leading-relaxed")} data-agente-vazio={mesa}>
          {mesa === "edicao" ? "Suba os vídeos e peça para organizar. Você confere a lista antes de qualquer mudança." : "Escolha uma cena na Base ou peça para gerar a próxima."}
        </p>
      )}
      {mensagens.map((m) => (
        <div key={m.id} className="min-w-0 space-y-2">
          <div className={juntar(conversa.balao, m.papel === "usuario" ? conversa.doUsuario : conversa.doAgente)}>
            <p className="whitespace-pre-wrap">{m.texto}</p>
            {m.aviso && (
              <p className="mt-1 text-[12px] leading-4 text-warning" data-aviso-registro="">
                {m.aviso}
              </p>
            )}
            {m.papel === "agente" && m.anexos && m.anexos.length > 0 && (
              <AprendizadoDoAgente
                anexos={m.anexos}
                onEsquecer={(id) => chamarMesaVideos({ acao: "aprendizado_esquecer", client_id: clientId, id, mesa })}
                onGuardar={(textoDaRegra, tipo) => chamarMesaVideos({ acao: "aprendizado_guardar", client_id: clientId, texto: textoDaRegra, tipo, mesa })}
              />
            )}
          </div>
          {m.acao && m.mensagem_id && (
            <CartaoDeAcao
              acao={m.acao}
              titulo={tituloDoCartaoDaMesa(m.acao)}
              observacao={m.acao.executada_direto ? "Feito na hora (sem custo). Dá para desfazer." : "Sem custo. Nada muda até confirmar, e dá para desfazer."}
              recemFeita={novas.current.has(m.id)}
              onPedido={onPedido(m)}
              onFeito={(_p, resposta) => guardarAnexo(m.id, resposta)}
            />
          )}
        </div>
      ))}
      {pensando && (
        <p className={juntar(conversa.apoio, "mr-6 flex items-center px-1")} data-etapa-do-agente={etapa}>
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Entendendo o pedido...
        </p>
      )}
    </PainelDoAgente>
  );
}
