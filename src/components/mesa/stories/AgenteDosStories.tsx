import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { GalleryVerticalEnd, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import PainelDoAgente, { BalaoDaConversa } from "@/components/sistema/PainelDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import SugestoesDoAgente from "@/components/agentes/SugestoesDoAgente";
import { CaminhoDaMensagem } from "@/components/agentes/CaminhoPronto";
import HistoricoDoAgente from "@/components/agentes/HistoricoDoAgente";
import { useMesa } from "../MesaContexto";
import { avisarCustoReal, EstimativaInline, useAvisarErro } from "../Custo";
import { Ditado } from "../Ditado";
import { modeloDaAba } from "../instagram/BioENome";
import { chamarStories, normalizarMensagens, type MensagemDosStories } from "./storiesApi";

/**
 * Agente dos stories, ao lado da aba (fixo e recolhível no computador,
 * gaveta no celular), no padrão do agente das redes: conversa sobre a novela
 * do dia, ganchos, adesivos e destaques com o contexto do cliente e deixa o
 * caminho ("Ir para ..."). A conversa mora no servidor (vem no painel, com
 * o histórico do agente); depois de cada resposta a aba relê o painel (o
 * agente pode ter mexido na sequência).
 */

const ATALHOS = [
  { rotulo: "Novela de amanhã", texto: "Monte a novela de amanhã: gancho, desenvolvimento, uma interação com adesivo, prova, convite e o gancho para o dia seguinte." },
  { rotulo: "Ganchos", texto: "Me dê 5 ganchos fortes para abrir a sequência de hoje, cada um em até 2 linhas curtas." },
  { rotulo: "Adesivos", texto: "Onde entram os adesivos de interação nesta semana (um a cada 3 ou 4 stories) e com que pergunta?" },
  { rotulo: "Destaques", texto: "Quais stories da semana devem ir para cada destaque do perfil?" },
];

export default function AgenteDosStories({
  conversaId,
  mensagens,
  pedido,
  onConversa,
  onAcaoFeita,
  onBloco,
}: {
  conversaId: string | null;
  mensagens: MensagemDosStories[];
  /** Pedido vindo de um bloco ("Pedir ao agente"): muda a cada pedido. */
  pedido: { texto: string; n: number } | null;
  /** A conversa que a função devolveu (a aba troca no painel guardado). */
  onConversa: (id: string | null, mensagens: MensagemDosStories[]) => void;
  /** Depois de cada resposta ou troca de conversa: a aba relê o painel. */
  onAcaoFeita: () => void;
  /** O bloco de que a resposta fala (sequencia, virais, destaques, agenda): a aba abre nele. */
  onBloco?: (bloco: string) => void;
}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const avisarErro = useAvisarErro();
  const modelo = useMemo(() => modeloDaAba(catalogo), [catalogo]);
  const [rascunho, setRascunho] = useEstadoDaTela<string>(`mesa:stories:rascunho:${clientId}`, "");
  const [trabalhando, setTrabalhando] = useState(false);
  const [pedidoAgora, setPedidoAgora] = useState<string | null>(null);
  const [recebida, setRecebida] = useState<string | null>(null);
  const lista = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [mensagens.length, trabalhando]);

  const enviar = async (t: string) => {
    const msg = t.trim();
    if (!msg || trabalhando) return;
    setTrabalhando(true);
    setPedidoAgora(msg);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await chamarStories<any>("conversar", clientId, { mensagem: msg, ...(conversaId ? { conversa_id: conversaId } : {}), ...(modelo ? { modelo_id: modelo.id } : {}) });
      setRascunho("");
      const id = r && r.conversa_id ? String(r.conversa_id) : conversaId;
      let novas = normalizarMensagens(r && r.mensagens);
      if (!(r && Array.isArray(r.mensagens))) {
        const resposta = typeof (r && r.resposta) === "string" ? String(r.resposta) : "";
        novas = mensagens.concat([{ papel: "usuario", conteudo: msg }]).concat(resposta ? [{ id: r.mensagem_id ? String(r.mensagem_id) : undefined, papel: "agente", conteudo: resposta }] : []);
      }
      onConversa(id, novas);
      if (onBloco && r && typeof r.bloco === "string" && r.bloco !== "nenhum") onBloco(r.bloco);
      setRecebida(r && r.mensagem_id ? String(r.mensagem_id) : null);
      // A resposta chegou mas não ficou guardada: diz, em vez de sumir calada ao reabrir.
      if (r && !r.mensagem_id && r.aviso) toast.warning("Resposta não guardada", { description: String(r.aviso) });
      if (Number(r && r.custo_usd) > 0) avisarCustoReal("Agente dos stories", r, atualizarCusto);
      onAcaoFeita();
    } catch (e) {
      avisarErro(e, "Agente dos stories");
    } finally {
      setTrabalhando(false);
      setPedidoAgora(null);
    }
  };

  useEffect(() => {
    if (pedido && pedido.texto) void enviar(pedido.texto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido && pedido.n]);

  const aoTeclar = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void enviar(rascunho);
    }
  };

  return (
    <PainelDoAgente
      titulo="Agente dos stories"
      descricao="Sequência, virais, destaques e agenda"
      icone={<GalleryVerticalEnd className="h-4 w-4" />}
      acoes={
        <HistoricoDoAgente
          chave={clientId ? { clientId, agente: "estrategista", referenciaTipo: "stories_do_cliente", referenciaId: clientId } : null}
          aoTrocar={() => {
            // A conversa ativa mudou (nova ou retomada): relê o painel, que traz as mensagens dela.
            setRecebida(null);
            onAcaoFeita();
          }}
        />
      }
      refDasMensagens={lista}
      rotuloDasMensagens="Conversa com o agente dos stories"
      compositor={
        <>
          <SugestoesDoAgente>
            <div className="flex min-w-0 flex-wrap" role="group" aria-label="Atalhos do agente dos stories">
              {ATALHOS.map((a) => (
                <button key={a.rotulo} type="button" className={juntar(botao.secundario, "mb-1.5 mr-1.5 h-8 px-2.5 text-[12px]")} disabled={trabalhando} onClick={() => void enviar(a.texto)}>
                  {a.rotulo}
                </button>
              ))}
            </div>
          </SugestoesDoAgente>
          <div className="flex min-w-0 items-end">
            <textarea
              className={juntar(campoTexto, "min-h-[40px] flex-1 resize-none")}
              rows={2}
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              onKeyDown={aoTeclar}
              placeholder="Peça ao agente dos stories"
              aria-label="Mensagem para o agente dos stories"
            />
            <Ditado valor={rascunho} onChange={setRascunho} disabled={trabalhando} className="ml-1.5 min-w-0" />
            <button type="button" className={juntar(botao.primario, "ml-2 h-10 w-10 px-0")} onClick={() => void enviar(rascunho)} disabled={trabalhando || !rascunho.trim()} aria-label="Enviar" title="Enviar">
              {trabalhando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
          <div className="mt-1 text-right">
            <EstimativaInline partes={modelo ? [{ modeloId: modelo.id, tipo: "texto", tokensEntrada: 5000, tokensSaida: 700 }] : null} />
          </div>
        </>
      }
    >
      {mensagens.length === 0 && !trabalhando && (
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          Peça a novela do dia, ganchos ou adesivos
          <AjudaRecolhida className="ml-1" rotulo="O que o agente faz">
            Conhece a marca, o hype da semana e as últimas sequências. Sugere ganchos, onde entra cada adesivo e para qual destaque vai cada story. Publicar adesivo a API não deixa: esses vão pelo app.
          </AjudaRecolhida>
        </p>
      )}
      {mensagens.map((m, i) =>
        m.papel === "sistema" ? (
          <p key={m.id || i} className={juntar(texto.auxiliar, "text-center")}>
            {m.conteudo}
          </p>
        ) : (
          <div key={m.id || i} className={juntar("min-w-0", m.papel === "usuario" ? "flex justify-end" : "")}>
            <BalaoDaConversa de={m.papel === "usuario" ? "usuario" : "agente"}>
              <TextoDoAgente texto={m.conteudo} clientId={clientId} />
            </BalaoDaConversa>
            {m.papel === "agente" ? <CaminhoDaMensagem anexos={m.anexos} recente={!!m.id && m.id === recebida} /> : null}
          </div>
        ),
      )}
      {trabalhando && (
        <>
          {pedidoAgora && (
            <div className="flex justify-end">
              <BalaoDaConversa de="usuario">{pedidoAgora}</BalaoDaConversa>
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
