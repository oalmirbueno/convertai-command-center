import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BriefcaseBusiness, Loader2, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useAvisarErro } from "@/components/mesa/Custo";
import { Ditado } from "@/components/mesa/Ditado";
import { useMesa } from "@/components/mesa/MesaContexto";
import { chamarFuncao, usd } from "@/lib/mesa/api";
import CartaoDeAcao, { CapacidadesDoAgente, OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import ModeloDoAgente from "@/components/agentes/ModeloDoAgente";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { CaminhoDaMensagem } from "@/components/agentes/CaminhoPronto";
import AprendizadoDoAgente from "@/components/agentes/AprendizadoDoAgente";
import { acoesDaMensagem, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import { lerArquivosDoAgente, tamanhoLegivel } from "@/components/mesa/leituraDeArquivos";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import CampoDoAgente, { focarNoFim } from "@/components/sistema/CampoDoAgente";
import { BotaoNovaConversa, useNovaConversa } from "@/components/sistema/NovaConversa";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import { botao, conversa, juntar } from "@/components/sistema/estilos";
import { CHAVES, relerTudo } from "./propostaApi";
import { tiraOLink } from "../../../supabase/functions/_shared/proposta-comercial";

/**
 * O estrategista comercial da Mesa Proposta, fixo ao lado das etapas. A
 * equipe manda informação e arquivos (transcrição, notas, PDF, Word,
 * planilha) na conversa: o texto é lido aqui no navegador e vira material da
 * proposta. Ele pergunta o que falta em vez de inventar; headline, validade,
 * mostrar/ocultar bloco e item com o preço dito vão direto, com Desfazer;
 * escrever, pesquisar o mercado e reescrever bloco usam IA e vêm no cartão
 * com o custo. O que a equipe ensina vira regra (Aprendi, Segui).
 */

export const ATALHOS_DA_PROPOSTA = [
  { rotulo: "Escreva a proposta", texto: "Escreva a proposta com o que já temos e a pesquisa de mercado." },
  { rotulo: "Pesquise o mercado", texto: "Pesquise concorrentes e a faixa de preço do nicho na região do cliente." },
  { rotulo: "O que falta?", texto: "O que falta para esta proposta ficar pronta para enviar?" },
  { rotulo: "Headline mais direta", texto: "Reescreva a capa com uma headline mais direta, de benefício." },
  { rotulo: "Monte os 3 pacotes", texto: "Monte os 3 pacotes (essencial, recomendado e completo) com a biblioteca de serviços." },
  { rotulo: "Resuma a reunião", texto: "Resuma a reunião que colei nas notas e na transcrição." },
  { rotulo: "Ajuste a margem", texto: "Ajuste os preços para a margem de 30%." },
];

const CAPACIDADES = [
  "ler a transcrição, as notas e os arquivos que você mandar",
  "escrever a proposta nos 12 blocos, com pesquisa de mercado (fonte e data em cada número)",
  "reescrever um bloco e trocar a headline",
  "adicionar item com o preço que você disser, e mudar a validade",
  "mostrar ou ocultar blocos",
  "montar os 3 pacotes com a biblioteca da agência (o preço vem de lá)",
  "ajustar os preços pela margem que você disser, pela hora técnica",
  "resumir a reunião colada em notas organizadas",
  "aprender o que você ensinar (\"nunca\", \"sempre\", \"não gostei\")",
];

type Mensagem = { id: string | null; papel: "usuario" | "agente" | "sistema"; conteudo: string; anexos: unknown[]; custo_usd: number | null; nova?: boolean; aviso?: string | null; local?: string };
type ArquivoPronto = { id: string; nome: string; tipo: string; texto: string; tamanho: number };

/** Ações do agente que só mexem no contexto (não no que o cliente vê): não tiram o link. */
const OPERACOES_SO_DE_CONTEXTO = ["resumir_reuniao"];

/** Tamanho de uma mensagem ao estrategista (a estimativa do chip do modelo). */
const PARTES_DA_CONVERSA = (modeloId: string) => [{ modeloId, tipo: "texto" as const, tokensEntrada: 9000, tokensSaida: 1500 }];

export default function AgenteDaProposta({
  propostaId,
  statusDaProposta = null,
  modeloId,
  modeloEscolhido = "",
  onModelo,
  rascunho,
  onRascunho,
}: {
  propostaId: string | null;
  /** Frente UXS: numa proposta enviada, o cartão de Confirmar avisa que a ação tira o link do cliente. */
  statusDaProposta?: string | null;
  /** O modelo que vai ser usado (o escolhido na página ou o padrão do papel "proposta"). */
  modeloId: string | null;
  /** O que a pessoa escolheu ("" = padrão): o mesmo estado da etapa Rascunho (MesaProposta). */
  modeloEscolhido?: string;
  onModelo?: (id: string) => void;
  rascunho: string;
  onRascunho: (v: string) => void;
}) {
  const { clientId, atualizarCusto, catalogo, catalogoCarregando } = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [lida, setLida] = useState(false);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [nova, setNova] = useState(false);
  const [arquivos, setArquivos] = useState<ArquivoPronto[]>([]);
  const [lendo, setLendo] = useState(false);
  const lista = useRef<HTMLDivElement | null>(null);
  const entrada = useRef<HTMLInputElement | null>(null);
  const campo = useRef<HTMLTextAreaElement | null>(null);
  const modelo = modeloId ? catalogo.find((x) => x.id === modeloId) || null : null;
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
    chamarFuncao<any>("mesa-proposta", { acao: "agente_historico", client_id: clientId })
      .then((d) => {
        if (!vivo) return;
        const l = d && Array.isArray(d.mensagens) ? d.mensagens : [];
        setConversaId(d && typeof d.conversa_id === "string" ? d.conversa_id : null);
        setMensagens(l.map((m: any) => ({ id: m.id ? String(m.id) : null, papel: m.papel, conteudo: String(m.conteudo || ""), anexos: Array.isArray(m.anexos) ? m.anexos : [], custo_usd: null })));
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
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [mensagens.length, enviando]);

  const anexar = (entradaDeArquivos: FileList | null) => {
    const todos = entradaDeArquivos ? (Array.prototype.slice.call(entradaDeArquivos) as File[]) : [];
    if (!todos.length) return;
    setLendo(true);
    lerArquivosDoAgente(todos, arquivos.reduce((n, a) => n + a.texto.length, 0))
      .then((r) => {
        if (r.lidos.length) setArquivos((l) => l.concat(r.lidos.map((a) => ({ id: a.id, nome: a.nome, tipo: a.tipo, texto: a.texto, tamanho: a.tamanho }))));
        const recusados = r.naoLidos.map((n) => `${n.nome}: ${n.motivo}`).concat(r.imagens.map((i) => `${i.name}: imagem não entra na proposta (a logo vem da marca do cliente e entra na capa sozinha; veja no Modelo visual do Rascunho).`));
        if (recusados.length) toast.error("Alguns arquivos não foram lidos", { description: recusados.slice(0, 3).join(" ") });
      })
      .catch(() => toast.error("Não deu para ler os arquivos", { description: "Tente de novo ou mande em PDF." }))
      .finally(() => {
        setLendo(false);
        if (entrada.current) entrada.current.value = "";
      });
  };

  const enviar = async () => {
    const m = rascunho.trim();
    if ((!m && !arquivos.length) || enviando) return;
    const texto = m || "Anexei arquivos com o material da reunião.";
    const local = `local-${Date.now()}`;
    const anexosDoPedido = arquivos;
    setEnviando(true);
    setMensagens((l) => l.concat([{ id: null, papel: "usuario", conteudo: anexosDoPedido.length ? `${texto}\n(${anexosDoPedido.map((a) => a.nome).join(", ")})` : texto, anexos: [], custo_usd: null, local }]));
    onRascunho("");
    setArquivos([]);
    try {
      const d = await chamarFuncao<any>("mesa-proposta", {
        acao: "agente_conversar",
        client_id: clientId,
        proposta_id: propostaId || undefined,
        mensagem: texto,
        arquivos: anexosDoPedido.length ? anexosDoPedido.map((a) => ({ nome: a.nome, tipo: a.tipo, texto: a.texto })) : undefined,
        conversa_id: conversaId || undefined,
        nova_conversa: nova || undefined,
        modelo_id: modeloId || undefined,
      });
      setNova(false);
      setConversaId(d && d.conversa_id ? String(d.conversa_id) : conversaId);
      if (anexosDoPedido.length || (d && acoesDaMensagem(Array.isArray(d.anexos) ? d.anexos : []).some((a) => !!a.executada_em))) relerTudo(qc, clientId, propostaId);
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
      // A mensagem que falha volta ao campo, com os arquivos.
      setMensagens((l) => l.filter((x) => x.local !== local));
      avisarErro(e, "O estrategista não respondeu");
      onRascunho(m);
      setArquivos(anexosDoPedido);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-agente-proposta="">
      <PainelDoAgente
        titulo="Estrategista comercial"
        icone={<BriefcaseBusiness className="h-4 w-4" />}
        descricao={propostaId ? "Conversa sobre a proposta aberta" : "Crie ou abra uma proposta"}
        acoes={
          <>
            {mensagens.length > 0 && <BotaoNovaConversa onClick={novaConversa} desativado={enviando} />}
            <AjudaRecolhida rotulo="Como o estrategista funciona">
              Mande a transcrição, as notas e os arquivos da reunião. Ele pergunta o que falta em vez de inventar. Número de mercado só com fonte e data; preço só o que você disser. Escrever, pesquisar e reescrever usam IA e pedem Confirmar com o custo. Enviar ao cliente é o Confirmar da etapa Enviar.
              <CapacidadesDoAgente capacidades={CAPACIDADES} />
            </AjudaRecolhida>
          </>
        }
        rotuloDasMensagens="Conversa com o estrategista comercial"
        refDasMensagens={lista}
        compositor={
          <>
            <OQuePossoFazer
              capacidades={CAPACIDADES}
              mostrarCapacidades={false}
              atalhos={ATALHOS_DA_PROPOSTA}
              onAtalho={(t) => {
                onRascunho(t);
                focarNoFim(campo, t);
              }}
            />
            {arquivos.length > 0 && (
              <ul className="-m-0.5 flex flex-wrap" aria-label="Arquivos para mandar">
                {arquivos.map((a) => (
                  <li key={a.id} className="m-0.5 inline-flex min-w-0 max-w-full items-center rounded-md bg-muted px-2 py-1 text-[12px]">
                    <span className="min-w-0 truncate">{a.nome}</span>
                    <span className="ml-1 shrink-0 text-muted-foreground">{tamanhoLegivel(a.tamanho)}</span>
                    <button type="button" className={juntar(botao.icone, "ml-1 h-6 w-6")} aria-label={`Tirar ${a.nome}`} onClick={() => setArquivos((l) => l.filter((x) => x.id !== a.id))}>
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <CampoDoAgente
              ref={campo}
              valor={rascunho}
              aoMudar={onRascunho}
              aoEnviar={() => void enviar()}
              maxLength={4000}
              placeholder="Ex.: cole a transcrição ou diga o preço do site"
              aria-label="Mensagem ao estrategista"
            />
            <div className="flex min-w-0 items-center justify-between">
              <div className="mr-2 min-w-0">
                <ModeloDoAgente catalogo={catalogo} modelo={modelo} escolhido={modeloEscolhido} onEscolher={onModelo} partes={PARTES_DA_CONVERSA} carregando={catalogoCarregando} disabled={enviando} />
              </div>
              <div className="ml-auto flex min-w-0 items-center">
                <input ref={entrada} type="file" multiple className="hidden" onChange={(e) => anexar(e.target.files)} accept=".txt,.md,.csv,.tsv,.json,.srt,.vtt,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rtf,.html" />
                <button type="button" className={juntar(botao.icone, "mr-1")} onClick={() => entrada.current && entrada.current.click()} disabled={lendo || enviando} aria-label="Anexar arquivos">
                  {lendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                </button>
                <Ditado valor={rascunho} onChange={onRascunho} disabled={enviando} className="mr-1.5 min-w-0" />
                <button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void enviar()} disabled={enviando || (!rascunho.trim() && !arquivos.length)} aria-label="Enviar ao estrategista">
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
        {!mensagens.length && lida && <p className={juntar(conversa.apoio, "leading-relaxed")}>Mande o material da reunião. Ação com custo vem num cartão para confirmar.</p>}
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
                  onEsquecer={(id) => chamarFuncao("mesa-proposta", { acao: "aprendizado_esquecer", client_id: clientId, id, mensagem_id: m.id || undefined })}
                  onGuardar={(texto, tipo) => chamarFuncao("mesa-proposta", { acao: "aprendizado_guardar", client_id: clientId, texto, tipo, mensagem_id: m.id || undefined })}
                />
              )}
              {m.papel === "agente" && <CaminhoDaMensagem anexos={m.anexos} recente={!!m.nova} />}
              {m.id &&
                acoes.map((a) => (
                  <div key={a.id} className="mt-2">
                    <CartaoDeAcao
                      acao={a}
                      recemFeita={!!m.nova}
                      titulo="O estrategista vai fazer na proposta"
                      observacao={`${
                        typeof a.custo_estimado_usd === "number" && a.custo_estimado_usd > 0
                          ? `Custo estimado: ${usd(a.custo_estimado_usd)} da carteira. Desfazer volta a versão anterior; o gasto não volta.`
                          : "Sem custo. Dá para desfazer."
                      }${
                        statusDaProposta && !a.executada_em && tiraOLink(statusDaProposta, a.itens.some((i) => OPERACOES_SO_DE_CONTEXTO.indexOf(i.operacao) < 0) ? ["conteudo"] : [])
                          ? " Confirmar tira o link atual do cliente; depois é só Enviar de novo."
                          : ""
                      }`}
                      onPedido={(p) => chamarAcaoDoAgente("mesa-proposta", String(m.id), a.id, p)}
                      onFeito={(p) => {
                        if (p === "descartar") return;
                        relerTudo(qc, clientId, propostaId);
                        void qc.invalidateQueries({ queryKey: CHAVES.propostas(clientId) });
                        atualizarCusto();
                      }}
                    />
                  </div>
                ))}
            </div>
          );
        })}
        {enviando && (
          <p className={juntar(conversa.apoio, "flex items-center")}>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Pensando na proposta...
          </p>
        )}
      </PainelDoAgente>
    </div>
  );
}
