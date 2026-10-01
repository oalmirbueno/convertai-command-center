import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Palette, Send } from "lucide-react";
import { useAvisarErro } from "@/components/mesa/Custo";
import { Ditado } from "@/components/mesa/Ditado";
import { useMesa } from "@/components/mesa/MesaContexto";
import { chamarFuncao, modeloDoPapel, usd } from "@/lib/mesa/api";
import CartaoDeAcao, { CapacidadesDoAgente, OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import ModeloDoAgente from "@/components/agentes/ModeloDoAgente";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { CaminhoDaMensagem } from "@/components/agentes/CaminhoPronto";
import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import { acoesDaMensagem, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import CampoDoAgente, { focarNoFim } from "@/components/sistema/CampoDoAgente";
import { BotaoNovaConversa, useNovaConversa } from "@/components/sistema/NovaConversa";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import { botao, conversa, juntar } from "@/components/sistema/estilos";
import { TAMANHOS_DA_IDENTIDADE } from "../../../supabase/functions/mesa-identidade/modulos/identidade-etapas";

/**
 * O diretor de marca (agente da Mesa Identidade, papel identidade), fixo ao
 * lado das etapas. Conduz o projeto na sequência e, quando a equipe pede,
 * age no contrato comum: concluir etapa, escolher nome ou caminho e montar o
 * brandbook vão na hora, com Desfazer; gerar nomes e caminhos (IA), enviar
 * para aprovação e levar ao kit pedem Confirmar, com o custo antes. Aprende
 * o que a equipe ensina (identidade e naming em separado).
 */

export const ATALHOS_DO_DIRETOR = [
  { rotulo: "O que falta?", texto: "O que falta para fechar a etapa atual?" },
  { rotulo: "Montar a estratégia", texto: "Monte a estratégia de marca a partir do briefing e da pesquisa." },
  { rotulo: "Três paletas", texto: "Proponha 3 paletas para a marca." },
  { rotulo: "Pares de fonte", texto: "Sugira pares de fonte do Google Fonts para a marca." },
  { rotulo: "Taglines", texto: "Gere taglines e slogans a partir da estratégia." },
  { rotulo: "Gerar nomes", texto: "Gere uma rodada de nomes com os critérios do briefing." },
  { rotulo: "Três caminhos", texto: "Gere 3 caminhos criativos." },
  { rotulo: "Montar o brandbook", texto: "Monte o brandbook de 24 páginas." },
  { rotulo: "Levar ao kit", texto: "Leve ao kit da marca a paleta, a tipografia e a logo do brandbook." },
];

const CAPACIDADES = [
  "dizer o que falta em cada etapa e fechar a etapa (na hora)",
  "montar a estratégia, propor 3 paletas, sugerir pares de fonte e gerar taglines (com custo no cartão e Desfazer)",
  "gerar nomes por técnica e caminhos criativos (com custo no cartão)",
  "escolher nome e caminho (na hora, com Desfazer)",
  "montar o brandbook no modelo pedido (na hora)",
  "enviar o brandbook para aprovação e levar ao kit (com Confirmar)",
  "aprender o que você ensinar (\"nunca\", \"sempre\", \"não gostei\")",
];

/** Tamanho de uma mensagem ao diretor (a estimativa do chip do modelo). */
const PARTES_DA_CONVERSA = (modeloId: string) => [{ modeloId, tipo: "texto" as const, tokensEntrada: TAMANHOS_DA_IDENTIDADE.conversa.entrada, tokensSaida: TAMANHOS_DA_IDENTIDADE.conversa.saida }];

export function observacaoDoDiretor(a: { itens: Array<{ operacao: string }>; custo_estimado_usd?: number | null; sem_desfazer?: boolean }): string {
  const custo = typeof a.custo_estimado_usd === "number" && a.custo_estimado_usd > 0 ? `Custo estimado: ${usd(a.custo_estimado_usd)} da carteira.` : "Sem custo.";
  if (a.itens.some((i) => i.operacao === "enviar_para_aprovacao")) return `${custo} O PDF vai para Arquivos com a revisão da agência pedida e não volta pelo Desfazer.`;
  return `${custo} ${a.custo_estimado_usd ? "O Desfazer volta o que havia; o gasto não volta." : "Dá para desfazer."}`;
}

interface Mensagem {
  id: string | null;
  papel: "usuario" | "agente" | "sistema";
  conteudo: string;
  anexos: unknown[];
  custo_usd: number | null;
  nova?: boolean;
  aviso?: string | null;
  local?: string;
}

export default function AgenteDiretorDeMarca({ projetoId, rascunho, onRascunho }: { projetoId: string | null; rascunho: string; onRascunho: (v: string) => void }) {
  const { clientId, atualizarCusto, catalogo, catalogoCarregando } = useMesa();
  // Modelo do agente escolhido na hora, numa chave só dele: a das etapas
  // (mesa-identidade:modelo:identidade) é de cada ação e não muda a conversa.
  // Vazio = o padrão do papel "identidade", como antes.
  const [modeloEscolhido, setModeloEscolhido] = useEstadoDaTela<string>("mesa-identidade:agente:modelo", "", { validar: (v) => typeof v === "string" });
  const modelo = modeloDoPapel(catalogo, "identidade", modeloEscolhido || null);
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [lida, setLida] = useState(false);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [nova, setNova] = useState(false);
  const listaRef = useRef<HTMLDivElement | null>(null);
  const campo = useRef<HTMLTextAreaElement | null>(null);
  const novaConversa = useNovaConversa<Mensagem>({
    chave: clientId,
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
    let vivo = true;
    chamarFuncao<any>("mesa-identidade", { acao: "agente_historico", client_id: clientId })
      .then((d) => {
        if (!vivo) return;
        setConversaId(d && typeof d.conversa_id === "string" ? d.conversa_id : null);
        setMensagens(((d && d.mensagens) || []).map((m: any) => ({ id: m.id ? String(m.id) : null, papel: m.papel, conteudo: String(m.conteudo || ""), anexos: Array.isArray(m.anexos) ? m.anexos : [], custo_usd: null })));
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
  }, [clientId]);

  useEffect(() => {
    if (listaRef.current) listaRef.current.scrollTop = listaRef.current.scrollHeight;
  }, [mensagens.length, enviando]);

  const reler = () => {
    void queryClient.invalidateQueries({ queryKey: ["mesa-identidade"] });
    atualizarCusto();
  };

  const enviar = async () => {
    const m = rascunho.trim();
    if (!m || enviando) return;
    const local = `local-${Date.now()}`;
    setEnviando(true);
    setMensagens((l) => l.concat([{ id: null, papel: "usuario", conteudo: m, anexos: [], custo_usd: null, local }]));
    onRascunho("");
    try {
      const d = await chamarFuncao<any>("mesa-identidade", {
        acao: "agente_conversar",
        client_id: clientId,
        mensagem: m,
        projeto_id: projetoId || undefined,
        conversa_id: conversaId || undefined,
        nova_conversa: nova || undefined,
        // Só o escolhido vai: sem escolha, a função usa o padrão do papel (como antes).
        modelo_id: modeloEscolhido && modelo && modelo.id === modeloEscolhido ? modelo.id : undefined,
      });
      setNova(false);
      setConversaId(d && d.conversa_id ? String(d.conversa_id) : conversaId);
      if (d && acoesDaMensagem(Array.isArray(d.anexos) ? d.anexos : []).some((a) => !!a.executada_em)) reler();
      setMensagens((l) =>
        l.concat([
          {
            id: d && d.mensagem_id ? String(d.mensagem_id) : null,
            papel: "agente",
            conteudo: String((d && d.resposta) || ""),
            anexos: d && Array.isArray(d.anexos) ? d.anexos : [],
            custo_usd: d && typeof d.custo_usd === "number" ? d.custo_usd : null,
            nova: true,
            aviso: d && typeof d.aviso_registro === "string" && d.aviso_registro ? d.aviso_registro : null,
          },
        ]),
      );
      atualizarCusto();
    } catch (e) {
      // A mensagem que falhou volta ao campo (e a bolha otimista sai).
      setMensagens((l) => l.filter((x) => x.local !== local));
      avisarErro(e, "O diretor de marca não respondeu");
      onRascunho(m);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-agente-identidade="">
      <PainelDoAgente
        titulo="Diretor de marca"
        icone={<Palette className="h-4 w-4" />}
        descricao={projetoId ? "Conversa sobre o projeto aberto" : "Abra ou crie um projeto no Início"}
        acoes={
          <>
            {mensagens.length > 0 && <BotaoNovaConversa onClick={novaConversa} desativado={enviando} />}
            <AjudaRecolhida rotulo="Como o diretor de marca funciona">
              Peça o que precisa. Fechar etapa, escolher nome ou caminho e montar o brandbook ele faz na hora, com Desfazer. Gerar nomes e caminhos, montar a estratégia, propor paletas, sugerir fontes e gerar taglines usam IA e vêm num cartão com o custo; enviar para aprovação e levar ao kit também pedem Confirmar. A logo final é sempre o arquivo da equipe. O que você ensinar vira regra; dá para esquecer.
              <CapacidadesDoAgente capacidades={CAPACIDADES} />
            </AjudaRecolhida>
          </>
        }
        rotuloDasMensagens="Conversa com o diretor de marca"
        refDasMensagens={listaRef}
        compositor={
          <>
            <OQuePossoFazer
              capacidades={CAPACIDADES}
              mostrarCapacidades={false}
              atalhos={ATALHOS_DO_DIRETOR}
              onAtalho={(t) => {
                onRascunho(t);
                focarNoFim(campo, t);
              }}
            />
            <CampoDoAgente
              ref={campo}
              valor={rascunho}
              aoMudar={onRascunho}
              aoEnviar={() => void enviar()}
              maxLength={4000}
              placeholder="Ex.: gere 3 caminhos mais sóbrios"
              aria-label="Mensagem ao diretor de marca"
            />
            <div className="flex min-w-0 items-center justify-between">
              <div className="mr-2 min-w-0">
                <ModeloDoAgente catalogo={catalogo} modelo={modelo} escolhido={modeloEscolhido} onEscolher={setModeloEscolhido} partes={PARTES_DA_CONVERSA} carregando={catalogoCarregando} disabled={enviando} />
              </div>
              <div className="ml-auto flex min-w-0 items-center">
                <Ditado valor={rascunho} onChange={onRascunho} disabled={enviando} className="mr-1.5 min-w-0" />
                <button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void enviar()} disabled={enviando || !rascunho.trim()} aria-label="Enviar ao diretor de marca">
                  {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </>
        }
      >
        {!mensagens.length && !lida && (
          <div className="space-y-2" aria-label="Lendo a conversa">
            <div className="mr-6 h-10 animate-pulse rounded-lg bg-muted" />
            <div className="ml-6 h-8 animate-pulse rounded-lg bg-muted" />
          </div>
        )}
        {!mensagens.length && lida && <p className={juntar(conversa.apoio, "leading-relaxed")}>Peça o que precisa. Quando for uma ação, eu mostro a lista com o custo e você confirma.</p>}
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
                  <span className="min-w-0 [overflow-wrap:anywhere]">{m.aviso}</span>
                </p>
              )}
              {m.papel === "agente" && (
                <AprendizadoDoAgente
                  anexos={m.anexos}
                  onEsquecer={(id) => chamarFuncao("mesa-identidade", { acao: "aprendizado_esquecer", client_id: clientId, id, mensagem_id: m.id || undefined })}
                  onGuardar={(texto, tipo) => chamarFuncao("mesa-identidade", { acao: "aprendizado_guardar", client_id: clientId, texto, tipo, mensagem_id: m.id || undefined })}
                />
              )}
              {m.papel === "agente" && <CaminhoDaMensagem anexos={m.anexos} recente={!!m.nova} />}
              {m.id &&
                acoes.map((a) => (
                  <div key={a.id} className="mt-2">
                    <CartaoDeAcao
                      acao={a}
                      recemFeita={!!m.nova}
                      titulo="O diretor de marca vai fazer"
                      observacao={observacaoDoDiretor(a)}
                      onPedido={(p) => chamarAcaoDoAgente("mesa-identidade", String(m.id), a.id, p)}
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
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Pensando na marca...
          </p>
        )}
      </PainelDoAgente>
    </div>
  );
}
