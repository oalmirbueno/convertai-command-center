import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Globe, Lightbulb, Loader2, Send, Shuffle, Undo2, Wand2 } from "lucide-react";
import { EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import { Ditado } from "@/components/mesa/Ditado";
import { useMesa } from "@/components/mesa/MesaContexto";
import { chamarFuncao, padraoPara, usd } from "@/lib/mesa/api";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import CampoDoAgente, { focarNoFim } from "@/components/sistema/CampoDoAgente";
import { BotaoNovaConversa, useNovaConversa } from "@/components/sistema/NovaConversa";
import { botao, campo, conversa, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import HistoricoDoAgente from "@/components/agentes/HistoricoDoAgente";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { modoDoTipo } from "../../../supabase/functions/_shared/roteiro-modelo";
import {
  ANEXO_DAS_IDEIAS,
  BUSCAS_NAS_IDEIAS,
  type IdeiaDeTema,
  ideiasDoAnexo,
  type LinhaDaFonte,
  type PreenchimentoDoRoteiro,
  preenchimentoDaIdeia,
  ROTULO_DO_ANGULO,
  rotuloDoObjetivo,
  TAMANHO_DAS_IDEIAS,
} from "../../../supabase/functions/mesa-roteiros/modulos/ideias-de-tema";
import { BlocoRecolhivel } from "./Comuns";
import { useBiblioteca } from "./roteirosApi";

/**
 * "Ideias com o agente" no roteiro avulso (02/10). O dono: "quero conversar,
 * não tenho ideia do tema; ele traz temas do mundo real, pensa junto, sempre
 * respondendo a pergunta do cliente, com foco em conversão e autoridade".
 *
 * Conversa com o estrategista de temas (ação ideias_conversar da função
 * mesa-roteiros): cada rodada traz de 5 a 8 ideias ranqueadas (Jev), com a
 * pergunta do cliente, o gancho, o ângulo, o modelo da base, o porquê de
 * agora com a fonte e a promessa. "Usar este tema" preenche o formulário na
 * hora, com Desfazer; quando é o agente que propõe ("usa a 3"), vem o cartão
 * com Confirmar. Gerar o roteiro é o botão do formulário, um clique depois.
 */

export interface MensagemDasIdeias {
  id: string | null;
  papel: "usuario" | "agente" | "sistema";
  conteudo: string;
  ideias: IdeiaDeTema[];
  fontes: LinhaDaFonte[];
  /** Apelido da ideia que o agente propôs preencher (o cartão com Confirmar). */
  preencher: string | null;
  ranking: "jev" | "regra" | null;
  custo_usd: number | null;
  local?: string;
}

export const ATALHOS_DAS_IDEIAS = [
  { rotulo: "Me dá ideias", texto: "Me traga ideias de tema para o próximo vídeo." },
  { rotulo: "Mais conversão", texto: "Mais ideias de conversão: as objeções que impedem o cliente de comprar." },
  { rotulo: "Mais polêmico", texto: "Mais polêmico, sem mentir e sem atacar ninguém." },
  { rotulo: "O que está em alta", texto: "O que está em alta agora no nicho? Traga ideias pegando o assunto do momento." },
];

function fontesDoAnexo(anexos: unknown[]): { fontes: LinhaDaFonte[]; preencher: string | null; ranking: "jev" | "regra" | null } {
  const a = anexos.filter((x) => x && typeof x === "object" && (x as { tipo?: unknown }).tipo === ANEXO_DAS_IDEIAS)[0] as { fontes?: unknown; preencher?: unknown; ranking?: unknown } | undefined;
  if (!a) return { fontes: [], preencher: null, ranking: null };
  const fontes = (Array.isArray(a.fontes) ? a.fontes : []).filter((f): f is LinhaDaFonte => !!f && typeof f === "object" && typeof (f as LinhaDaFonte).texto === "string");
  return { fontes, preencher: typeof a.preencher === "string" ? a.preencher : null, ranking: a.ranking === "jev" ? "jev" : a.ranking === "regra" ? "regra" : null };
}

export function normalizarHistoricoDasIdeias(data: any): { conversaId: string | null; mensagens: MensagemDasIdeias[] } {
  const lista = data && Array.isArray(data.mensagens) ? data.mensagens : [];
  return {
    conversaId: data && typeof data.conversa_id === "string" ? data.conversa_id : null,
    mensagens: lista
      .filter((m: any) => m && (m.papel === "usuario" || m.papel === "agente" || m.papel === "sistema"))
      .map((m: any) => {
        const anexos = Array.isArray(m.anexos) ? m.anexos : [];
        const f = fontesDoAnexo(anexos);
        return { id: m.id ? String(m.id) : null, papel: m.papel, conteudo: String(m.conteudo || ""), ideias: ideiasDoAnexo(anexos), fontes: f.fontes, preencher: f.preencher, ranking: f.ranking, custo_usd: null };
      }),
  };
}

const numeroDa = (apelido: string) => apelido.replace(/^i/, "");
const nota10 = (n: number) => (Math.round(n * 100) / 10).toFixed(1).replace(".", ",");

/** O que muda no formulário, linha a linha (vai no cartão de confirmar). */
export function linhasDoPreenchimento(v: PreenchimentoDoRoteiro, nomeDoModelo: string | null): string[] {
  return [
    `Tema: ${v.tema}`,
    `Objetivo: ${v.objetivo === "auto" ? "Automático" : rotuloDoObjetivo(v.objetivo)}`,
    `Modelo da base: ${v.modeloBase === "auto" ? "Automático" : nomeDoModelo || v.modeloBase}`,
    `Tipo: ${modoDoTipo(v.tipo).rotulo}, ${v.duracao_s}s`,
    "Pedido da equipe: pergunta, gancho, esqueleto e porquê",
  ];
}

export default function IdeiasDeTema({
  preenchidoCom,
  onPreencher,
  onDesfazer,
}: {
  /** Apelido da ideia que está no formulário agora (para o Desfazer). */
  preenchidoCom: string | null;
  onPreencher: (valores: PreenchimentoDoRoteiro, ideia: IdeiaDeTema) => void;
  onDesfazer: () => void;
}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const modelo = padraoPara(catalogo, "estrategista");
  const avisarErro = useAvisarErro();
  const bibliotecaQ = useBiblioteca(clientId);
  const proprios = bibliotecaQ.data ? bibliotecaQ.data.lista.map((p) => p.ficha) : [];
  const [mensagens, setMensagens] = useState<MensagemDasIdeias[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [lida, setLida] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [nova, setNova] = useState(false);
  const [rascunho, setRascunho] = useEstadoDaTela<string>(`mesa-roteiros:ideias:rascunho:${clientId}`, "");
  const [web, setWeb] = useEstadoDaTela<boolean>(`mesa-roteiros:ideias:web:${clientId}`, true);
  const [hashtags, setHashtags] = useEstadoDaTela<string>(`mesa-roteiros:ideias:hashtags:${clientId}`, "");
  /** Cartões do agente já resolvidos nesta tela (mensagem -> "feito" | "cancelado"). */
  const [cartoes, setCartoes] = useState<Record<string, "feito" | "cancelado">>({});
  const campoRef = useRef<HTMLTextAreaElement | null>(null);
  const lista = useRef<HTMLDivElement | null>(null);
  // Histórico das conversas: trocar (nova, continuar uma antiga) relê a conversa ativa.
  const [releitura, setReleitura] = useState(0);
  const aoTrocarDeConversa = () => {
    setConversaId(null);
    setNova(false);
    setReleitura((n) => n + 1);
  };

  const novaConversa = useNovaConversa<MensagemDasIdeias>({
    chave: `${clientId}:ideias`,
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
    chamarFuncao<any>("mesa-roteiros", { acao: "ideias_historico", client_id: clientId })
      .then((d) => {
        if (!vivo) return;
        const h = normalizarHistoricoDasIdeias(d);
        setConversaId(h.conversaId);
        setMensagens(h.mensagens);
        setLida(true);
      })
      .catch((e) => {
        if (!vivo) return;
        setLida(true);
        avisarErro(e, "As ideias anteriores não foram lidas");
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, releitura]);

  useEffect(() => {
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [mensagens.length, enviando]);

  const todas = mensagens.reduce<IdeiaDeTema[]>((t, m) => t.concat(m.ideias), []);
  const ideiaPorApelido = (a: string | null) => (a ? todas.filter((i) => i.apelido === a)[0] || null : null);

  const enviar = async (textoPedido?: string) => {
    const m = (textoPedido !== undefined ? textoPedido : rascunho).trim();
    if (enviando) return;
    const local = `local-${Date.now()}`;
    const mostrado = m || ATALHOS_DAS_IDEIAS[0].texto;
    setEnviando(true);
    setMensagens((l) => l.concat([{ id: null, papel: "usuario", conteudo: mostrado, ideias: [], fontes: [], preencher: null, ranking: null, custo_usd: null, local }]));
    if (textoPedido === undefined) setRascunho("");
    try {
      const d = await chamarFuncao<any>("mesa-roteiros", {
        acao: "ideias_conversar",
        client_id: clientId,
        mensagem: mostrado,
        conversa_id: conversaId || undefined,
        nova_conversa: nova || undefined,
        web,
        hashtags: hashtags.split(/[\s,]+/).map((h) => h.replace(/^#/, "")).filter(Boolean).slice(0, 3),
      });
      setNova(false);
      setConversaId(d && d.conversa_id ? String(d.conversa_id) : conversaId);
      const ideias: IdeiaDeTema[] = d && Array.isArray(d.ideias) ? ideiasDoAnexo([{ tipo: ANEXO_DAS_IDEIAS, ideias: d.ideias }]) : [];
      const escolhida = d && d.preencher && typeof d.preencher === "object" ? (d.preencher as IdeiaDeTema) : null;
      setMensagens((l) =>
        l.concat([
          {
            id: d && d.mensagem_id ? String(d.mensagem_id) : `sem-registro-${Date.now()}`,
            papel: "agente",
            conteudo: String((d && d.resposta) || ""),
            ideias,
            fontes: d && Array.isArray(d.fontes) ? d.fontes : [],
            preencher: escolhida ? escolhida.apelido : null,
            ranking: d && d.ranking === "jev" ? "jev" : "regra",
            custo_usd: d && typeof d.custo_usd === "number" ? d.custo_usd : null,
          },
        ]),
      );
      atualizarCusto();
    } catch (e) {
      setMensagens((l) => l.filter((x) => x.local !== local));
      avisarErro(e, "O agente não trouxe as ideias");
      if (textoPedido === undefined) setRascunho(m);
    } finally {
      setEnviando(false);
    }
  };

  const usar = (ideia: IdeiaDeTema) => onPreencher(preenchimentoDaIdeia(ideia, proprios), ideia);
  const pedirNoCampo = (t: string) => {
    setRascunho(t);
    focarNoFim(campoRef, t);
  };
  const ultimaComFontes = mensagens.slice().reverse().filter((m) => m.fontes.length)[0] || null;

  return (
    <BlocoRecolhivel
      chave={`mesa-roteiros:ideias:${clientId}`}
      titulo="Ideias com o agente"
      icone={<Lightbulb className="h-4 w-4" />}
      divisoria={false}
      resumo={todas.length ? `${todas.length} ideias` : undefined}
      ajuda="Sem tema? Converse. O agente lê o contexto da marca, os roteiros e posts do cliente, as referências e o que está em alta (web e Instagram), e traz temas que respondem a pergunta real do cliente. Peça mais assim, misture duas, mais polêmico ou foque num assunto. Usar este tema preenche o formulário abaixo; depois é só gerar."
      acoes={
        <>
          <HistoricoDoAgente chave={{ clientId, agente: "estrategista", referenciaTipo: "mesa_roteiros_ideias", referenciaId: null }} aoTrocar={aoTrocarDeConversa} />
          {mensagens.length > 0 && <BotaoNovaConversa onClick={novaConversa} desativado={enviando} />}
        </>
      }
      data-ideias-de-tema=""
    >
      <div className="min-w-0 space-y-3">
        {ultimaComFontes && <LinhaDasFontes fontes={ultimaComFontes.fontes} />}

        <div ref={lista} className="min-w-0 space-y-3 scrollbar-hidden lg:max-h-[640px] lg:overflow-y-auto lg:overscroll-contain" aria-label="Conversa de ideias" aria-live="polite">
          {!mensagens.length && !lida && <div className="h-10 animate-pulse rounded-lg bg-muted" aria-label="Lendo as ideias" />}
          {!mensagens.length && lida && <p className={juntar(conversa.apoio, "leading-relaxed")}>Sem tema? Peça ideias ou diga o que tem em mente.</p>}
          {mensagens.map((m, i) => {
            const proposta = m.papel === "agente" ? ideiaPorApelido(m.preencher) : null;
            const chaveDoCartao = m.id || `m-${i}`;
            return (
              <div key={m.id || m.local || `m-${i}`} className="min-w-0 space-y-2">
                <div className={juntar(conversa.balao, m.papel === "usuario" ? conversa.doUsuario : m.papel === "sistema" ? "bg-muted text-muted-foreground" : conversa.doAgente)}>
                  <TextoDoAgente texto={m.conteudo} clientId={clientId} />
                  {m.custo_usd !== null && <p className="mt-1 text-[12px] text-muted-foreground">Custo: {usd(m.custo_usd)}</p>}
                </div>
                {m.ideias.length > 0 && (
                  <ol className="-mx-2 min-w-0 divide-y divide-border/50" aria-label="Ideias de tema" data-lista-de-ideias="">
                    {m.ideias.map((ideia, k) => (
                      <LinhaDaIdeia
                        key={ideia.apelido}
                        ideia={ideia}
                        maisForte={k === 0 && m.ideias.length > 1}
                        ranking={m.ranking}
                        noFormulario={preenchidoCom === ideia.apelido}
                        onUsar={() => usar(ideia)}
                        onMaisAssim={() => void enviar(`Mais assim, na linha da ${numeroDa(ideia.apelido)}.`)}
                        onMisturar={() => pedirNoCampo(`Mistura a ${numeroDa(ideia.apelido)} com a `)}
                        desativado={enviando}
                      />
                    ))}
                  </ol>
                )}
                {proposta && cartoes[chaveDoCartao] !== "cancelado" && (
                  <CartaoDePreencher
                    ideia={proposta}
                    valores={preenchimentoDaIdeia(proposta, proprios)}
                    feito={cartoes[chaveDoCartao] === "feito" && preenchidoCom === proposta.apelido}
                    onConfirmar={() => {
                      usar(proposta);
                      setCartoes((c) => ({ ...c, [chaveDoCartao]: "feito" }));
                    }}
                    onCancelar={() => setCartoes((c) => ({ ...c, [chaveDoCartao]: "cancelado" }))}
                    onDesfazer={() => {
                      onDesfazer();
                      setCartoes((c) => {
                        const n = { ...c };
                        delete n[chaveDoCartao];
                        return n;
                      });
                    }}
                  />
                )}
              </div>
            );
          })}
          {enviando && (
            <p className={juntar(conversa.apoio, "flex items-center")}>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Lendo o mundo real e pensando nos temas...
            </p>
          )}
        </div>

        <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1" aria-label="Atalhos de ideias">
          {ATALHOS_DAS_IDEIAS.map((a) => (
            <button key={a.rotulo} type="button" className={juntar(botao.barra, "border border-border")} onClick={() => void enviar(a.texto)} disabled={enviando}>
              {a.rotulo}
            </button>
          ))}
          <button type="button" className={juntar(botao.barra, "border border-border")} onClick={() => pedirNoCampo("Foca em ")} disabled={enviando}>
            Foca em...
          </button>
        </div>

        <CampoDoAgente
          ref={campoRef}
          valor={rascunho}
          aoMudar={setRascunho}
          aoEnviar={() => void enviar()}
          maxLength={2000}
          placeholder="Ex.: quero algo de autoridade sobre o que o cliente erra antes de contratar"
          aria-label="Mensagem ao agente de ideias"
        />
        <div className="flex min-w-0 flex-wrap items-center">
          <button
            type="button"
            role="switch"
            aria-checked={web}
            onClick={() => setWeb(!web)}
            className={juntar(botao.barra, "mr-1.5 border", web ? "border-primary/50 text-foreground" : "border-border")}
            title={web ? "Pesquisa na web ligada" : "Pesquisa na web desligada"}
          >
            <Globe className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Web {web ? "ligada" : "desligada"}
          </button>
          <div className="mr-1.5 w-[170px] min-w-0">
            <input
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              maxLength={120}
              placeholder="#hashtags do nicho"
              aria-label="Hashtags para olhar no Instagram"
              className={juntar(campo, "h-8 text-[12px]")}
            />
          </div>
          <div className="mr-2 min-w-0 flex-1 truncate">
            <EstimativaInline partes={modelo ? [{ modeloId: modelo.id, tipo: "texto", tokensEntrada: TAMANHO_DAS_IDEIAS.entrada, tokensSaida: TAMANHO_DAS_IDEIAS.saida, buscasWeb: web ? BUSCAS_NAS_IDEIAS : 0 }] : null} />
          </div>
          <Ditado valor={rascunho} onChange={setRascunho} disabled={enviando} className="mr-1.5 min-w-0" />
          <button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void enviar()} disabled={enviando} aria-label="Pedir ideias ao agente">
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </BlocoRecolhivel>
  );
}

/** As fontes da última rodada: o que funcionou e o que ficou de fora (detalhe no "?"). */
function LinhaDasFontes({ fontes }: { fontes: LinhaDaFonte[] }) {
  const nomes: Record<string, string> = { web: "Web", instagram: "Instagram", referencias: "Referências", publicados: "Perfil", roteiros: "Roteiros" };
  return (
    <div className="flex min-w-0 flex-wrap items-center" data-fontes-das-ideias="">
      <span className={juntar(texto.auxiliar, "mr-1.5")}>Fontes:</span>
      {fontes.map((f) => (
        <span key={f.fonte} className={juntar(etiqueta, "mb-1 mr-1", f.ok ? "bg-primary/10 text-foreground" : "bg-muted text-muted-foreground line-through")} data-fonte={f.fonte} data-ok={f.ok ? "sim" : "nao"}>
          {nomes[f.fonte] || f.fonte}
        </span>
      ))}
      <AjudaRecolhida className="mb-1" rotulo="O que entrou nas ideias">
        <span className="block space-y-1">
          {fontes.map((f) => (
            <span key={f.fonte} className="block">
              {f.texto}
            </span>
          ))}
        </span>
      </AjudaRecolhida>
    </div>
  );
}

function LinhaDaIdeia({
  ideia,
  maisForte,
  ranking,
  noFormulario,
  onUsar,
  onMaisAssim,
  onMisturar,
  desativado,
}: {
  ideia: IdeiaDeTema;
  maisForte: boolean;
  ranking: "jev" | "regra" | null;
  noFormulario: boolean;
  onUsar: () => void;
  onMaisAssim: () => void;
  onMisturar: () => void;
  desativado: boolean;
}) {
  const [aberta, setAberta] = useState(false);
  const meta = [ROTULO_DO_ANGULO[ideia.angulo], rotuloDoObjetivo(ideia.objetivo), ideia.modelo_base_nome || modoDoTipo(ideia.tipo).rotulo].filter(Boolean).join(" · ");
  return (
    <li className="min-w-0 rounded-lg px-2 py-3 transition-colors hover:bg-muted/40" data-ideia={ideia.apelido}>
      <div className="flex min-w-0 items-start">
        <span className="mr-2 mt-0.5 shrink-0 text-[13px] font-bold tabular-nums text-primary">{numeroDa(ideia.apelido)}</span>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 flex-wrap items-center text-[14px] font-semibold leading-5 [overflow-wrap:anywhere]">
            <span className="mr-2 min-w-0">{ideia.tema}</span>
            {maisForte && <span className={juntar(etiqueta, "bg-primary/10 text-primary")}>Mais forte</span>}
          </p>
          <p className="mt-1 text-[13px] italic leading-5 text-foreground/90 [overflow-wrap:anywhere]">"{ideia.pergunta_do_cliente}"</p>
          <p className="mt-1 text-[13px] leading-5 [overflow-wrap:anywhere]">
            <span className="font-medium">Gancho:</span> {ideia.gancho}
          </p>
          <p className={juntar(texto.auxiliar, "mt-1 leading-5 [overflow-wrap:anywhere]")}>
            {meta}
            {ranking === "jev" ? ` · nota ${nota10(ideia.notas.total)}` : ""}
          </p>
          {ideia.por_que_agora && (
            <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
              Por que agora: {ideia.por_que_agora}
              {ideia.fonte && (
                <a href={ideia.fonte.url} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex items-center text-primary underline-offset-2 hover:underline">
                  {ideia.fonte.titulo}
                  <ExternalLink className="ml-0.5 h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </p>
          )}
          {ideia.promessa && <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">Promessa: {ideia.promessa}</p>}
          {aberta && ideia.esqueleto.length > 0 && (
            <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-[12.5px] leading-5 [overflow-wrap:anywhere]" data-esqueleto="">
              {ideia.esqueleto.map((p, k) => (
                <li key={k}>{p}</li>
              ))}
            </ol>
          )}
          <div className="-m-1 mt-1.5 flex min-w-0 flex-wrap items-center [&>*]:m-1">
            <button type="button" className={juntar(noFormulario ? botao.secundario : botao.primario, "h-8 text-[12px]")} onClick={onUsar} disabled={desativado || noFormulario} aria-label={`Usar o tema ${numeroDa(ideia.apelido)}`}>
              {noFormulario ? <Check className="mr-1 h-3.5 w-3.5" /> : <Wand2 className="mr-1 h-3.5 w-3.5" />}
              {noFormulario ? "No formulário" : "Usar este tema"}
            </button>
            <button type="button" className={juntar(botao.discreto, "h-8 text-[12px]")} onClick={onMaisAssim} disabled={desativado}>
              Mais assim
            </button>
            <button type="button" className={juntar(botao.discreto, "h-8 text-[12px]")} onClick={onMisturar} disabled={desativado}>
              <Shuffle className="mr-1 h-3.5 w-3.5" />
              Misturar
            </button>
            {ideia.esqueleto.length > 0 && (
              <button type="button" className={juntar(botao.discreto, "h-8 text-[12px]")} onClick={() => setAberta(!aberta)} aria-expanded={aberta}>
                {aberta ? "Esconder esqueleto" : "Esqueleto"}
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/** O agente propôs preencher com uma ideia: a equipe confirma (nada muda antes). */
function CartaoDePreencher({
  ideia,
  valores,
  feito,
  onConfirmar,
  onCancelar,
  onDesfazer,
}: {
  ideia: IdeiaDeTema;
  valores: PreenchimentoDoRoteiro;
  feito: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
  onDesfazer: () => void;
}) {
  return (
    <div className="mr-2 min-w-0 rounded-lg border border-primary/30 px-3.5 py-3" data-cartao-preencher={ideia.apelido}>
      <p className="text-[13px] font-semibold">{feito ? `Formulário preenchido com a ideia ${numeroDa(ideia.apelido)}` : `Preencher o roteiro com a ideia ${numeroDa(ideia.apelido)}?`}</p>
      {!feito && (
        <ul className="mt-1.5 space-y-0.5 text-[12.5px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
          {linhasDoPreenchimento(valores, ideia.modelo_base_nome).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <div className="-m-1 mt-2 flex min-w-0 flex-wrap items-center [&>*]:m-1">
        {feito ? (
          <button type="button" className={juntar(botao.secundario, "h-8 text-[12px]")} onClick={onDesfazer}>
            <Undo2 className="mr-1 h-3.5 w-3.5" />
            Desfazer
          </button>
        ) : (
          <>
            <button type="button" className={juntar(botao.primario, "h-8 text-[12px]")} onClick={onConfirmar}>
              Confirmar
            </button>
            <button type="button" className={juntar(botao.discreto, "h-8 text-[12px]")} onClick={onCancelar}>
              Cancelar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
