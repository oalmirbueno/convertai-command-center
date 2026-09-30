import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clapperboard, Loader2, Send } from "lucide-react";
import { useAvisarErro } from "@/components/mesa/Custo";
import { Ditado } from "@/components/mesa/Ditado";
import { useMesa } from "@/components/mesa/MesaContexto";
import { usd } from "@/lib/mesa/api";
import CartaoDeAcao, { CapacidadesDoAgente, OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import ModeloDoAgente from "@/components/agentes/ModeloDoAgente";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { CaminhoDaMensagem } from "@/components/agentes/CaminhoPronto";
import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import { acoesDaMensagem, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import CampoDoAgente, { focarNoFim } from "@/components/sistema/CampoDoAgente";
import { BotaoNovaConversa, useNovaConversa } from "@/components/sistema/NovaConversa";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, conversa, juntar } from "@/components/sistema/estilos";
import type { PropsDoAgenteDaMesa } from "@/components/mesa-videos/MesaDeVideo";
import { TAMANHOS_DO_MOTION } from "../../../supabase/functions/_shared/motion-metodo";
import { useModeloDaAcao } from "./FilmeAberto";
import { chamarMotion, CHAVES, useFilmeDaUrl } from "./motionApi";

/**
 * O diretor de motion (papel `motion`), fixo ao lado das etapas. "Eu converso
 * e o agente faz": escolher storyboard, trocar peça, pedir still ou amostra
 * são feitos na hora com Desfazer; gerar BRAND.md, storyboards, escrever cena
 * (teto por cena), renderizar e montar vêm num cartão com o custo antes.
 * Aprende o que a equipe ensina. Modelo escolhido na hora.
 */

export const ATALHOS_DO_MOTION = [
  { rotulo: "Gerar storyboards", texto: "Gere 3 storyboards para este filme." },
  { rotulo: "Stills que faltam", texto: "Tire o still de todas as cenas que ainda não têm." },
  { rotulo: "Criticar", texto: "Critique as cenas e diga o que está abaixo de 6." },
  { rotulo: "Montar", texto: "Monte o filme e renderize em todos os formatos." },
];

const CAPACIDADES = [
  "gerar o BRAND.md e a beat sheet",
  "gerar 3 storyboards e escolher um (na hora)",
  "escrever uma cena sob medida em HTML e GSAP (com teto)",
  "trocar a cena por uma peça do kit (na hora)",
  "pedir still, amostra de 5 s e a cena final",
  "medir as batidas e casar os cortes no ritmo",
  "criticar as cenas (nota por critério, só aviso)",
  "montar na Mesa Edição e renderizar",
  'aprender o que você ensinar ("nunca", "sempre", "não gostei")',
];

/** Tamanho de uma mensagem ao diretor (a estimativa do chip do modelo). */
const PARTES_DA_CONVERSA = (modeloId: string) => [{ modeloId, tipo: "texto" as const, tokensEntrada: TAMANHOS_DO_MOTION.conversa.entrada, tokensSaida: TAMANHOS_DO_MOTION.conversa.saida }];

type Mensagem = { id: string | null; papel: "usuario" | "agente" | "sistema"; conteudo: string; anexos: unknown[]; custo_usd: number | null; nova?: boolean; aviso?: string | null; local?: string };

export default function AgenteDoMotion(_: PropsDoAgenteDaMesa) {
  const { clientId, atualizarCusto, catalogoCarregando } = useMesa();
  const [filmeId] = useFilmeDaUrl();
  // O mesmo modelo da conversa que o agente sempre usou (chave mesa-motion:modelo:conversa:<cliente>), agora à vista no chip.
  const { modelo, escolhido, setEscolhido, catalogo } = useModeloDaAcao("conversa");
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [lida, setLida] = useState(false);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [nova, setNova] = useState(false);
  const [rascunho, setRascunho] = useEstadoDaTela<string>(`mesa-motion:rascunho:${clientId}`, "");
  const listaRef = useRef<HTMLDivElement | null>(null);
  const campo = useRef<HTMLTextAreaElement | null>(null);
  const novaConversa = useNovaConversa<Mensagem>({
    chave: `${clientId}:${filmeId || ""}`,
    enviando,
    mensagens,
    conversaId,
    limpar: () => {
      setMensagens([]);
      setConversaId(null);
      setNova(true);
    },
    restaurar: (c) => {
      setMensagens(c.mensagens);
      setConversaId(c.conversaId);
      setNova(false);
    },
  });

  useEffect(() => {
    if (!filmeId) return;
    let vivo = true;
    setLida(false);
    chamarMotion<any>("agente_historico", { filme_id: filmeId })
      .then((d) => {
        if (!vivo) return;
        setConversaId(d && typeof d.conversa_id === "string" ? d.conversa_id : null);
        setMensagens((Array.isArray(d && d.mensagens) ? d.mensagens : []).map((m: any) => ({ id: m.id || null, papel: m.papel, conteudo: String(m.conteudo || ""), anexos: Array.isArray(m.anexos) ? m.anexos : [], custo_usd: null })));
        setLida(true);
      })
      .catch((e) => {
        if (!vivo) return;
        setLida(true);
        avisarErro(e, "A conversa anterior não foi lida");
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmeId]);

  useEffect(() => {
    if (listaRef.current) listaRef.current.scrollTop = listaRef.current.scrollHeight;
  }, [mensagens.length, enviando]);

  const reler = () => {
    if (!filmeId) return;
    void qc.invalidateQueries({ queryKey: CHAVES.filme(filmeId) });
    void qc.invalidateQueries({ queryKey: CHAVES.fila(filmeId) });
    atualizarCusto();
  };

  const enviar = async () => {
    const m = rascunho.trim();
    if (!m || enviando || !filmeId) return;
    const local = `local-${Date.now()}`;
    setEnviando(true);
    setMensagens((l) => l.concat([{ id: null, papel: "usuario", conteudo: m, anexos: [], custo_usd: null, local }]));
    setRascunho("");
    try {
      const d = await chamarMotion<any>("agente_conversar", { filme_id: filmeId, mensagem: m, conversa_id: conversaId || undefined, nova_conversa: nova || undefined, modelo_id: modelo ? modelo.id : undefined });
      setNova(false);
      setConversaId(d && d.conversa_id ? String(d.conversa_id) : conversaId);
      if (d && acoesDaMensagem(Array.isArray(d.anexos) ? d.anexos : []).some((a) => !!a.executada_em)) reler();
      setMensagens((l) => l.concat([{ id: d && d.mensagem_id ? String(d.mensagem_id) : null, papel: "agente", conteudo: String((d && d.resposta) || ""), anexos: d && Array.isArray(d.anexos) ? d.anexos : [], custo_usd: d && typeof d.custo_usd === "number" ? d.custo_usd : null, nova: true, aviso: d && d.aviso_registro ? String(d.aviso_registro) : null }]));
      atualizarCusto();
    } catch (e) {
      // A mensagem que falha volta ao campo.
      setMensagens((l) => l.filter((x) => x.local !== local));
      avisarErro(e, "O diretor de motion não respondeu");
      setRascunho(m);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-agente-do-motion="">
      <PainelDoAgente
        titulo="Diretor de motion"
        icone={<Clapperboard className="h-4 w-4" />}
        descricao={filmeId ? "Filme aberto" : "Abra um filme"}
        acoes={
          <>
            {mensagens.length > 0 && <BotaoNovaConversa onClick={novaConversa} desativado={enviando} />}
            <AjudaRecolhida rotulo="Como o diretor de motion funciona">
              Peça em palavras simples. Escolher storyboard, trocar a peça da cena e pedir still ou amostra ele faz na hora, com Desfazer. Gerar texto com IA, escrever cena sob medida, renderizar e montar vêm num cartão com o custo antes. O que você ensinar vira regra para os próximos filmes deste cliente.
              <CapacidadesDoAgente capacidades={CAPACIDADES} />
            </AjudaRecolhida>
          </>
        }
        rotuloDasMensagens="Conversa com o diretor de motion"
        refDasMensagens={listaRef}
        compositor={
          <>
            <OQuePossoFazer
              capacidades={CAPACIDADES}
              mostrarCapacidades={false}
              atalhos={ATALHOS_DO_MOTION}
              onAtalho={(t) => {
                setRascunho(t);
                focarNoFim(campo, t);
              }}
            />
            <CampoDoAgente
              ref={campo}
              valor={rascunho}
              aoMudar={setRascunho}
              aoEnviar={() => void enviar()}
              maxLength={4000}
              disabled={!filmeId}
              placeholder={filmeId ? "Ex.: troca a cena 3 pelo cartão final e manda a amostra" : "Abra ou crie um filme na etapa"}
              aria-label="Mensagem ao diretor de motion"
            />
            <div className="flex min-w-0 items-center justify-between">
              <div className="mr-2 min-w-0">
                <ModeloDoAgente catalogo={catalogo} modelo={modelo} escolhido={escolhido} onEscolher={setEscolhido} partes={PARTES_DA_CONVERSA} carregando={catalogoCarregando} disabled={enviando} />
              </div>
              <div className="ml-auto flex min-w-0 items-center">
                <Ditado valor={rascunho} onChange={setRascunho} disabled={enviando} className="mr-1.5 min-w-0" />
                <button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void enviar()} disabled={enviando || !rascunho.trim() || !filmeId} aria-label="Enviar ao diretor de motion">
                  {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </>
        }
      >
        {!filmeId && <p className={juntar(conversa.apoio, "leading-relaxed")}>Abra ou crie um filme na etapa ao lado para conversar sobre ele.</p>}
        {filmeId && !mensagens.length && !lida && (
          <div className="space-y-2" aria-label="Lendo a conversa">
            <div className="mr-6 h-10 animate-pulse rounded-lg bg-muted" />
            <div className="ml-6 h-8 animate-pulse rounded-lg bg-muted" />
          </div>
        )}
        {filmeId && !mensagens.length && lida && <p className={juntar(conversa.apoio, "leading-relaxed")}>Diga o que o filme precisa. Quando custar, mostro o cartão com o custo antes.</p>}
        {mensagens.map((m, i) => {
          const acoes = acoesDaMensagem(m.anexos);
          return (
            <div key={m.id || m.local || `m-${i}`} className="min-w-0">
              <div className={juntar(conversa.balao, m.papel === "usuario" ? conversa.doUsuario : m.papel === "sistema" ? "bg-muted text-muted-foreground" : conversa.doAgente)}>
                <TextoDoAgente texto={m.conteudo} clientId={clientId} />
                {m.custo_usd !== null && <p className="mt-1 text-[12px] text-muted-foreground">Custo: {usd(m.custo_usd)}</p>}
              </div>
              {m.papel === "agente" && m.aviso && (
                <p className="mr-6 mt-1 flex min-w-0 items-start text-[12px] text-warning" role="alert">
                  <AlertTriangle className="mr-1.5 mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  <span className="min-w-0">{m.aviso}</span>
                </p>
              )}
              {m.papel === "agente" && (
                <AprendizadoDoAgente
                  anexos={m.anexos}
                  onEsquecer={(id) => chamarMotion("aprendizado_esquecer", { client_id: clientId, id, mensagem_id: m.id || undefined })}
                  onGuardar={(texto, tipo) => chamarMotion("aprendizado_guardar", { client_id: clientId, texto, tipo, mensagem_id: m.id || undefined })}
                />
              )}
              {m.papel === "agente" && <CaminhoDaMensagem anexos={m.anexos} recente={!!m.nova} />}
              {m.id &&
                acoes.map((a) => (
                  <div key={a.id} className="mt-2">
                    <CartaoDeAcao
                      acao={a}
                      recemFeita={!!m.nova}
                      titulo="O diretor de motion vai fazer"
                      observacao={typeof a.custo_estimado_usd === "number" && a.custo_estimado_usd > 0 ? `Custo estimado ${usd(a.custo_estimado_usd)}.` : "Sem custo de modelo (render na máquina da agência)."}
                      onPedido={(p) => chamarAcaoDoAgente("mesa-motion", String(m.id), a.id, p)}
                      onFeito={(p) => {
                        if (p !== "descartar") reler();
                      }}
                    />
                  </div>
                ))}
            </div>
          );
        })}
        {enviando && (
          <p className={juntar(conversa.apoio, "flex items-center")}>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Pensando no filme...
          </p>
        )}
      </PainelDoAgente>
    </div>
  );
}
