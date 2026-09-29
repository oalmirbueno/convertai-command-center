import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, Eye, Loader2, Send, Square, Timer } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, campoTexto, conversa, juntar, texto } from "@/components/sistema/estilos";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import { textoDoErro, usd, type ModeloIa } from "@/lib/mesa/api";
import type { AcaoDoAgente, RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import type { ProjetoDeEdicao, TrechoVisto } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import {
  estimarPasso,
  MAX_FERRAMENTAS,
  MAX_PASSOS,
  MAX_QUADROS_POR_CHAMADA,
  MAX_TEXTO_DO_PEDIDO,
  sugerirModeloMaisBarato,
  temposDeAmostra,
  TETO_PADRAO_USD,
} from "../../../../supabase/functions/editor-video/ferramentas";
import { contextoDoAgente, rodarAgente, type ItemDoLog } from "@/lib/editor/agente";
import { acaoDaProposta, acaoFeita } from "@/lib/editor/cartao";
import { chamarEditorVideo, emPreparacao, novoId } from "@/lib/editor/api";
import { aplicarOperacao, assinaturaDoProjeto, trilhaPrincipal, type Operacao } from "@/lib/editor/operacoes";
import { base64DoDataUrl, extrairQuadro, tempoDoQuadro } from "@/lib/editor/quadros";
import { proporSkill, skillPorId, skillPorPalavras, type IdDaSkill, type PropostaDaSkill } from "@/lib/editor/skills";
import { custoDaFala, fontesSemFala, lerFalaDaEntrada, marcarFalaDoProjeto, pedidoPrecisaDeFala, skillPrecisaDeFala } from "@/lib/editor/fala";
import { tempoFino } from "@/lib/editor/tempo";
import type { ControleDePropostas } from "./PainelDeSkills";
import { pegarPedidoPendente, temPedidoPendente } from "./ponteDoAgente";

/**
 * Agente editor (frente V-B; frente Q, 26/09: virou a lateral fixa da etapa
 * Editar). Em cima, o dono escolhe o MODELO (qualquer modelo de texto ativo do
 * catálogo ia_modelos: GPT da OpenAI, Claude pela OpenRouter...), com o preço
 * por milhão de tokens, o esforço de raciocínio quando o modelo aceita e o
 * teto por pedido; a tela mostra o custo estimado por pedido antes. O agente
 * só SUGERE um mais barato.
 *
 * O agente EDITA: o laço (editor-video/agente_passo) pede ferramentas, a tela
 * roda as operações puras numa cópia e o fim é uma proposta com
 * Confirmar/Cancelar e Desfazer. Pedido que precisa da fala (edição dinâmica,
 * silêncio, legenda) e vídeo sem fala marcada: antes, o Timestamp, com o
 * custo à vista e o clique do dono; depois o agente segue no projeto já com a
 * fala. Atalhos rodam as skills direto (de graça, sem modelo).
 */

interface Mensagem {
  quem: "dono" | "agente";
  itens: ItemDoLog[];
}

interface Preparo {
  /** Pedido livre (vai ao modelo depois) ou skill direta. */
  pedido: string | null;
  skill: IdDaSkill | null;
  fontes: string[];
  custoFala: number;
}

const ATALHOS: { skill: IdDaSkill; rotulo: string }[] = [
  { skill: "brabo", rotulo: "Edição dinâmica" },
  { skill: "cortar_silencios", rotulo: "Cortar silêncios" },
  { skill: "legendas", rotulo: "Legendas" },
  { skill: "punch_in", rotulo: "Punch-in" },
];

export const aceitaImagem = (m: ModeloIa) => {
  const mod = (m as unknown as { modalidades?: { entrada?: string[] } | null }).modalidades;
  if (mod && Array.isArray(mod.entrada)) return mod.entrada.indexOf("image") >= 0;
  return m.provedor === "openai" || /gpt|claude|gemini/i.test(m.modelo_api);
};

const nomeDoModelo = (m: ModeloIa) => m.rotulo || m.modelo_api;

const PROVEDORES: Record<string, string> = { openai: "OpenAI", openrouter: "OpenRouter", anthropic: "Anthropic", google: "Google" };
export const nomeDoProvedor = (p: string) => PROVEDORES[p] || p;

const precoCurto = (v: number | null) => {
  const n = Number(v);
  if (!isFinite(n) || v === null) return "?";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: n < 1 ? 2 : 1 });
};

/** "US$ 4/20 por 1M" (entrada/saída por milhão de tokens). */
export const precoDoModelo = (m: Pick<ModeloIa, "preco_entrada_1m" | "preco_saida_1m">) => `US$ ${precoCurto(m.preco_entrada_1m)}/${precoCurto(m.preco_saida_1m)} por 1M`;

/** Família do modelo para agrupar o seletor (pelo nome do modelo, não pela rota). */
export function familiaDoModelo(m: Pick<ModeloIa, "modelo_api" | "provedor">): string {
  const api = String(m.modelo_api || "").toLowerCase();
  if (api.indexOf("claude") >= 0) return "Claude (Anthropic)";
  if (api.indexOf("gpt") >= 0 || api.indexOf("o3") === 0 || api.indexOf("o4") === 0 || m.provedor === "openai") return "GPT (OpenAI)";
  if (api.indexOf("gemini") >= 0) return "Gemini (Google)";
  return "Outros";
}

/** Modelos de texto ativos, do mais barato ao mais caro, agrupados por família. */
export function modelosDoAgente(catalogo: ModeloIa[]): { familia: string; modelos: ModeloIa[] }[] {
  const ativos = (catalogo || []).filter((m) => m.tipo === "texto" && m.ativo).sort((a, b) => (Number(a.preco_saida_1m) || 0) - (Number(b.preco_saida_1m) || 0));
  const grupos: { familia: string; modelos: ModeloIa[] }[] = [];
  ativos.forEach((m) => {
    const f = familiaDoModelo(m);
    let g = grupos.find((x) => x.familia === f);
    if (!g) {
      g = { familia: f, modelos: [] };
      grupos.push(g);
    }
    g.modelos.push(m);
  });
  const ordem = ["GPT (OpenAI)", "Claude (Anthropic)", "Gemini (Google)", "Outros"];
  return grupos.sort((a, b) => ordem.indexOf(a.familia) - ordem.indexOf(b.familia));
}

/** Custo estimado de um pedido: típico (2 passos: editar e conferir) e o máximo (6 passos, preso ao teto). */
export function custoDoPedido(porPasso: number, teto: number): { tipico: number; maximo: number } {
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { tipico: r(Math.min(teto, porPasso * 2)), maximo: r(Math.min(teto, porPasso * MAX_PASSOS)) };
}

/** Pedido que vai ao modelo: com a dica da skill quando as palavras apontam uma (regra fixa, sem IA). */
export function pedidoComDica(pedido: string): string {
  const s = skillPorPalavras(pedido);
  const skill = s ? skillPorId(s) : null;
  const base = pedido.slice(0, MAX_TEXTO_DO_PEDIDO - 220);
  if (skill) return `${base}\n\n(Dica da tela: a skill "${skill.id}" (${skill.rotulo}) faz esse pedido. Chame aplicar_skill com ela, confira o resultado e termine.)`;
  // Pedido geral de editar ("pode editar ele"): o método da Mesa Edição é a edição dinâmica.
  const t = pedido.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/\bedit|\bedicao\b/.test(t)) return `${base}\n\n(Dica da tela: pedido geral de edição. O método da casa é a edição dinâmica, skill "brabo". Aplique e ajuste só o que o pedido disser.)`;
  return base;
}

export default function AgenteEditor({
  projeto,
  controle,
  onAplicarProjeto,
  urls,
  semEditor,
}: {
  projeto: ProjetoDeEdicao | null;
  controle: ControleDePropostas | null;
  onAplicarProjeto: ((p: ProjetoDeEdicao, rotulo: string) => void) | null;
  urls: Record<string, string>;
  /** Sem editor aberto: o que a lateral diz (o seletor de modelo continua em cima). */
  semEditor?: ReactNode;
}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const grupos = useMemo(() => modelosDoAgente(catalogo || []), [catalogo]);
  const modelos = useMemo(() => grupos.reduce((l, g) => l.concat(g.modelos), [] as ModeloIa[]), [grupos]);
  const [escolha, setEscolha] = useEstadoDaTela<{ modelo: string; raciocinio: string; teto: number }>(`mesa-edicao:editor:agente:${clientId}`, { modelo: "", raciocinio: "", teto: TETO_PADRAO_USD }, { validar: (v) => !!v && typeof v === "object" });
  const [rascunho, setRascunho] = useEstadoDaTela<string>(`mesa-edicao:editor:agente:rascunho:${clientId}`, "", { esperaMs: 300 });
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [rodando, setRodando] = useState<string | null>(null);
  const [gasto, setGastoNaTela] = useState(0);
  const gastoRef = useRef(0);
  const setGasto = (v: number | ((x: number) => number)) => {
    gastoRef.current = typeof v === "function" ? v(gastoRef.current) : v;
    setGastoNaTela(gastoRef.current);
  };
  const [proposta, setProposta] = useState<{ acao: AcaoDoAgente; p: PropostaDaSkill } | null>(null);
  const [preparo, setPreparo] = useState<Preparo | null>(null);
  const parar = useRef(false);
  const refMsgs = useRef<HTMLDivElement | null>(null);
  const pendente = temPedidoPendente(clientId);

  const modelo = modelos.find((m) => m.id === escolha.modelo) || modelos.find((m) => (m.padrao_para || []).indexOf("diretor_arte") >= 0) || modelos[0] || null;
  const raciocinios = (modelo && modelo.raciocinio) || [];
  const raciocinio = raciocinios.indexOf(escolha.raciocinio) >= 0 ? escolha.raciocinio : "";
  const contexto = useMemo(() => (projeto ? contextoDoAgente(projeto) : ""), [projeto]);
  const porPasso = modelo ? estimarPasso(modelo, contexto.length + 4000, raciocinio || null) : 0;
  const custo = custoDoPedido(porPasso, escolha.teto);
  const sugestao = modelo ? sugerirModeloMaisBarato(modelos, modelo.id, false, aceitaImagem) : null;
  const rolarParaBaixo = () => window.requestAnimationFrame(() => refMsgs.current && (refMsgs.current.scrollTop = refMsgs.current.scrollHeight));
  const falar = (quem: Mensagem["quem"], itens: ItemDoLog[]) => setMensagens((l) => l.concat([{ quem, itens }]));

  // Pedido deixado pelo agente de edição das outras etapas: vai para o campo quando o editor abriu (nada roda sem o clique).
  const comProjeto = !!projeto;
  useEffect(() => {
    if (!comProjeto) return;
    const p = pegarPedidoPendente(clientId);
    if (!p) return;
    setRascunho(p);
    falar("agente", [{ tipo: "resposta", texto: "Recebi o seu pedido do agente de edição. Confira o modelo e o custo em cima e mande." }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, pendente, comProjeto]);

  // ---------------------------------------------------------------- proposta (skill direta ou do agente)
  const proporDaSkill = (id: IdDaSkill, base: ProjetoDeEdicao) => {
    const prop = proporSkill(id, base, { agora: new Date().toISOString(), selecionados: [] });
    if (!prop.operacoes.length) {
      falar("agente", [{ tipo: "aviso", texto: `${prop.titulo}: ${prop.resumo}${prop.avisos.length ? ` ${prop.avisos.join(" ")}` : ""}` }]);
      return;
    }
    const acao = acaoDaProposta(`skill-${id}-${Date.now().toString(36)}`, "editor_video", `${prop.titulo}: ${prop.resumo}`, prop.operacoes, base, prop.avisos);
    setProposta({ acao, p: prop.base ? prop : { ...prop, base: assinaturaDoProjeto(base) } });
    falar("agente", [{ tipo: "resposta", texto: `${prop.titulo}: ${prop.resumo} Confira a lista e confirme.` }]);
  };

  const rodarPedido = async (pedido: string, base: ProjetoDeEdicao) => {
    if (!modelo) return;
    setRodando("Pensando");
    parar.current = false;
    const antes = gastoRef.current;
    try {
      const r = await rodarAgente({
        chamar: chamarEditorVideo,
        clientId,
        sessao: novoId(),
        pedido: pedidoComDica(pedido),
        projeto: base,
        modeloId: modelo.id,
        raciocinio: raciocinio || null,
        tetoUsd: escolha.teto,
        agora: new Date().toISOString(),
        cancelado: () => parar.current,
        aoPasso: (log, g) => {
          setGasto(antes + g);
          setRodando(log.length ? log[log.length - 1].texto.slice(0, 80) : "Pensando");
        },
      });
      setGasto(antes + r.gasto_usd);
      const itens = r.log.slice();
      if (!r.operacoes.length) itens.push({ tipo: "aviso", texto: "Nada mudou na linha do tempo. Use um atalho abaixo ou diga o que mudar (ex.: corta os silêncios)." });
      falar("agente", itens);
      if (r.operacoes.length) {
        const id = `agente-${Date.now().toString(36)}`;
        const p: PropostaDaSkill = { skill: "brabo", titulo: "Agente editor", resumo: r.resposta || "Proposta do agente.", operacoes: r.operacoes, avisos: [], base: assinaturaDoProjeto(base), resultado: r.resultado };
        setProposta({ acao: acaoDaProposta(id, "editor_video", p.resumo, r.operacoes, base), p });
      }
    } catch (e) {
      const t = emPreparacao(e) ? "O agente editor está em preparação: falta publicar a função editor-video." : textoDoErro(e);
      falar("agente", [{ tipo: "aviso", texto: t }]);
    } finally {
      setRodando(null);
      atualizarCusto();
      rolarParaBaixo();
    }
  };

  /** Fontes sem fala: as que a Entrada já marcou entram de graça; o resto paga o Timestamp. */
  const faltaDeFala = (p: ProjetoDeEdicao) => {
    const fontes = fontesSemFala(p);
    const pagas = fontes.filter((k) => {
      const f = p.fontes[k];
      return !(f && f.arquivo_id && lerFalaDaEntrada(clientId, f.arquivo_id));
    });
    return { fontes, custo: custoDaFala(p, pagas) };
  };

  const seguir = async (pr: Preparo, comFala: boolean) => {
    if (!projeto) return;
    setPreparo(null);
    let base = projeto;
    if (comFala && pr.fontes.length) {
      setRodando("Marcando a fala");
      parar.current = false;
      try {
        const r = await marcarFalaDoProjeto(base, pr.fontes, { clientId, urls, agora: new Date().toISOString(), aoAndar: (t) => setRodando(t.slice(0, 90)), cancelado: () => parar.current });
        base = r.projeto;
        setGasto((g) => g + r.custo_usd);
        if (onAplicarProjeto) onAplicarProjeto(base, "Fala marcada");
        falar("agente", [{ tipo: "ferramenta", texto: `Timestamp: fala de ${r.marcadas} ${r.marcadas === 1 ? "vídeo marcada" : "vídeos marcada"} (${usd(r.custo_usd)}).` }]);
      } catch (e) {
        const t = emPreparacao(e) ? "O Timestamp está em preparação: falta publicar a função editor-video." : textoDoErro(e);
        falar("agente", [{ tipo: "aviso", texto: `Não marquei a fala: ${t}` }]);
        setRodando(null);
        atualizarCusto();
        rolarParaBaixo();
        return;
      }
      setRodando(null);
    }
    if (pr.skill) proporDaSkill(pr.skill, base);
    else if (pr.pedido) await rodarPedido(pr.pedido, base);
    atualizarCusto();
    rolarParaBaixo();
  };

  const comecar = (pr: Omit<Preparo, "fontes" | "custoFala">, precisa: boolean) => {
    if (!projeto) return;
    setProposta(null);
    const falta = precisa ? faltaDeFala(projeto) : { fontes: [], custo: 0 };
    const completo: Preparo = { ...pr, fontes: falta.fontes, custoFala: falta.custo };
    if (falta.fontes.length && falta.custo > 0) {
      setPreparo(completo);
      rolarParaBaixo();
      return;
    }
    void seguir(completo, falta.fontes.length > 0);
  };

  // ---------------------------------------------------------------- pedido ao agente
  const enviar = () => {
    const pedido = rascunho.trim();
    if (!pedido || !modelo || rodando || !projeto) return;
    falar("dono", [{ tipo: "resposta", texto: pedido }]);
    setRascunho("");
    rolarParaBaixo();
    comecar({ pedido, skill: null }, pedidoPrecisaDeFala(pedido));
  };

  const atalho = (id: IdDaSkill, rotulo: string) => {
    if (rodando || !projeto) return;
    falar("dono", [{ tipo: "resposta", texto: rotulo }]);
    rolarParaBaixo();
    comecar({ pedido: null, skill: id }, skillPrecisaDeFala(id));
  };

  const aoPedido = async (pedido: "confirmar" | "descartar" | "desfazer"): Promise<RespostaDaAcao> => {
    if (!proposta) return {};
    const agora = new Date().toISOString();
    if (pedido === "descartar") {
      const a = { ...proposta.acao, descartada_em: agora };
      setProposta({ ...proposta, acao: a });
      return { anexo: a };
    }
    if (!controle) throw new Error("O editor não está aberto.");
    if (pedido === "desfazer") {
      const ok = controle.desfazer(proposta.p);
      const a = { ...acaoFeita(proposta.acao, agora), desfeita_em: ok ? agora : null };
      setProposta({ ...proposta, acao: a });
      return { anexo: a, voltaram: ok ? proposta.acao.itens.length : 0 };
    }
    if (!controle.aplicar(proposta.p, "Agente editor")) throw new Error("O projeto mudou depois da proposta. Peça de novo ao agente.");
    const a = acaoFeita(proposta.acao, agora);
    setProposta({ ...proposta, acao: a });
    return { anexo: a, feitos: a.itens.length, falhas: 0 };
  };

  // ---------------------------------------------------------------- assistir (visão)
  const modeloDeVisao = modelo && aceitaImagem(modelo) ? modelo : modelos.find(aceitaImagem) || null;
  const aVer = useMemo(() => {
    if (!projeto) return [] as string[];
    const t = trilhaPrincipal(projeto);
    const chaves: string[] = [];
    (t ? t.clipes : []).forEach((c) => {
      if (!c.fonte || chaves.indexOf(c.fonte) >= 0) return;
      const f = projeto.fontes[c.fonte];
      if (f && f.midia === "video" && f.duracao_s && !projeto.visoes[c.fonte]) chaves.push(c.fonte);
    });
    return chaves;
  }, [projeto]);
  const amostrasDe = (k: string) => (projeto ? temposDeAmostra(projeto.fontes[k].duracao_s || 0, 24, 1).length : 0);
  const quadrosAVer = aVer.reduce((n, k) => n + amostrasDe(k), 0);
  const lotes = aVer.reduce((n, k) => n + Math.ceil(amostrasDe(k) / MAX_QUADROS_POR_CHAMADA), 0);
  const custoDeUmLote = (n: number) => (modeloDeVisao ? estimarPasso(modeloDeVisao, (n * 1600 + 900) * 4, null) : 0);
  const custoDaVisao = aVer.reduce((s, k) => {
    const n = amostrasDe(k);
    let soma = 0;
    for (let i = 0; i < n; i += MAX_QUADROS_POR_CHAMADA) soma += custoDeUmLote(Math.min(MAX_QUADROS_POR_CHAMADA, n - i));
    return s + soma;
  }, 0);
  const [confirmarVisao, setConfirmarVisao] = useState(false);

  const assistir = async () => {
    if (!modeloDeVisao || !projeto || !onAplicarProjeto) return;
    setConfirmarVisao(false);
    setRodando("Assistindo");
    parar.current = false;
    const referencia = novoId();
    let atual = projeto;
    let visto = 0;
    try {
      for (const chave of aVer) {
        const url = urls[chave];
        const f = projeto.fontes[chave];
        if (!url || !f.duracao_s) continue;
        const tempos = temposDeAmostra(f.duracao_s, 24, 1).map((t) => tempoDoQuadro(t, projeto.fps));
        const trechos: TrechoVisto[] = [];
        let amostras = 0;
        for (let i = 0; i < tempos.length; i += MAX_QUADROS_POR_CHAMADA) {
          if (parar.current) throw new Error("Parado. O que já foi visto ficou guardado.");
          const lote = tempos.slice(i, i + MAX_QUADROS_POR_CHAMADA);
          setRodando(`Vendo ${f.nome}: ${Math.min(i + lote.length, tempos.length)} de ${tempos.length} quadros`);
          const quadros: { tempo_s: number; jpeg_base64: string }[] = [];
          for (const t of lote) {
            const q = await extrairQuadro(url, t, { largura: 384, qualidade: 0.6 });
            if (q) quadros.push({ tempo_s: q.tempo_s, jpeg_base64: base64DoDataUrl(q.dataUrl) });
          }
          if (!quadros.length) throw new Error(`Não deu para ler os quadros de ${f.nome} aqui.`);
          const r = await chamarEditorVideo<{ trechos: TrechoVisto[]; custo_usd: number }>({
            acao: "visao_descrever",
            client_id: clientId,
            fonte: chave,
            modelo_id: modeloDeVisao.id,
            quadros,
            referencia_id: referencia,
            custo_maximo_usd: custoDeUmLote(quadros.length),
          });
          (r.trechos || []).forEach((x) => trechos.push(x));
          amostras += quadros.length;
          setGasto((g) => g + (Number(r.custo_usd) || 0));
        }
        const op: Operacao = { op: "visao", fonte: chave, visao: { trechos: trechos.slice(0, 120), modelo: modeloDeVisao.id, em: new Date().toISOString(), amostras } };
        atual = aplicarOperacao(atual, op);
        visto++;
        onAplicarProjeto(atual, `Visão de ${f.nome}`);
      }
      falar("agente", [{ tipo: "resposta", texto: visto ? `Assisti ${visto} ${visto === 1 ? "vídeo" : "vídeos"}. O que vi ficou guardado por trecho.` : "Nada novo para assistir." }]);
    } catch (e) {
      const t = emPreparacao(e) ? "Assistir está em preparação: falta publicar a função editor-video." : textoDoErro(e);
      falar("agente", [{ tipo: "aviso", texto: t }]);
      toast.error("Não terminou de assistir", { description: t });
    } finally {
      setRodando(null);
      atualizarCusto();
      rolarParaBaixo();
    }
  };

  // ---------------------------------------------------------------- telas
  const topo = (
    <div className="space-y-1.5" data-seletor-do-agente-editor="">
      <select
        className={juntar(campo, "h-9 text-[12.5px]")}
        value={modelo ? modelo.id : ""}
        onChange={(e) => setEscolha({ ...escolha, modelo: e.target.value, raciocinio: "" })}
        aria-label="Modelo do agente"
        disabled={!modelos.length}
        title={modelo ? `${nomeDoModelo(modelo)} pela ${nomeDoProvedor(modelo.provedor)}. ${precoDoModelo(modelo)} tokens (entrada/saída).` : undefined}
      >
        {!modelos.length && <option value="">Sem modelo de texto ativo no catálogo</option>}
        {grupos.map((g) => (
          <optgroup key={g.familia} label={g.familia}>
            {g.modelos.map((m) => (
              <option key={m.id} value={m.id}>
                {nomeDoModelo(m)} · {nomeDoProvedor(m.provedor)} · {precoDoModelo(m)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="flex min-w-0 items-center">
        <select className={juntar(campo, "mr-1 h-8 min-w-0 flex-1 text-[12px]")} value={raciocinio} onChange={(e) => setEscolha({ ...escolha, raciocinio: e.target.value })} aria-label="Esforço de raciocínio" disabled={!raciocinios.length}>
          <option value="">{raciocinios.length ? "Raciocínio padrão" : "Sem ajuste de raciocínio"}</option>
          {raciocinios.map((r) => (
            <option key={r} value={r}>
              Raciocínio {r}
            </option>
          ))}
        </select>
        <label className="flex shrink-0 items-center text-[11.5px] text-muted-foreground">
          <span className="mr-1">Teto US$</span>
          <input className={juntar(campo, "h-8 w-16 px-1.5 text-[12px] tabular-nums")} type="number" min={0.05} max={5} step={0.05} value={escolha.teto} onChange={(e) => setEscolha({ ...escolha, teto: Math.max(0.05, Math.min(5, Number(e.target.value) || TETO_PADRAO_USD)) })} aria-label="Teto por pedido em dólar" />
        </label>
      </div>
      <p className={juntar(texto.auxiliar, "truncate")} data-custo-do-pedido="" title={`~${usd(porPasso)} por passo; até ${MAX_PASSOS} passos e ${MAX_FERRAMENTAS} ferramentas por pedido.`}>
        Pedido ~{usd(custo.tipico)} (máx. {usd(custo.maximo)}) · gasto aqui {usd(gasto)}
      </p>
      {sugestao && (
        <button type="button" className="text-left text-[11.5px] text-primary hover:underline" onClick={() => setEscolha({ ...escolha, modelo: sugestao.id, raciocinio: "" })}>
          Sugestão: {nomeDoModelo(sugestao)} custa menos e dá conta de editar. Trocar?
        </button>
      )}
    </div>
  );

  const cartaoDoPreparo = preparo && projeto && (
    <div className="rounded-md bg-muted/50 px-2.5 py-2 text-[12px]" data-preparo-da-fala="">
      <p className="mb-1.5 flex items-start">
        <Timer className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span>
          Primeiro marco a fala de {preparo.fontes.length} {preparo.fontes.length === 1 ? "vídeo" : "vídeos"} ({tempoFino(preparo.fontes.reduce((s, k) => s + (projeto.fontes[k].duracao_s || 0), 0))}) com o Timestamp: <strong className="tabular-nums">{usd(preparo.custoFala)}</strong>.{" "}
          {preparo.pedido ? `Depois o agente edita (~${usd(custo.tipico)}).` : "A skill é de graça."}
        </span>
      </p>
      <div className="flex flex-wrap">
        <button type="button" className={juntar(botao.primario, "mb-1 mr-1 h-8")} onClick={() => void seguir(preparo, true)} data-marcar-e-seguir="">
          Marcar e seguir por ~{usd(preparo.custoFala + (preparo.pedido ? custo.tipico : 0))}
        </button>
        <button type="button" className={juntar(botao.secundario, "mb-1 mr-1 h-8")} onClick={() => void seguir(preparo, false)}>
          Sem marcar
        </button>
        <button type="button" className={juntar(botao.discreto, "mb-1 h-8")} onClick={() => setPreparo(null)}>
          Cancelar
        </button>
      </div>
    </div>
  );

  return (
    <PainelDoAgente
      titulo="Agente editor"
      descricao={modelo ? `${nomeDoModelo(modelo)} · edita a linha do tempo` : "Edita a linha do tempo"}
      icone={<Bot className="h-4 w-4" />}
      topo={topo}
      refDasMensagens={refMsgs}
      rotuloDasMensagens="Conversa com o agente editor"
      acoes={
        <button type="button" className={botao.icone} onClick={() => (aVer.length ? setConfirmarVisao(true) : toast.info(projeto ? "Tudo já foi assistido." : "Abra um vídeo no editor."))} aria-label="Assistir o vídeo" title="Assistir o vídeo (quadros para um modelo com imagem)" disabled={!!rodando || !projeto}>
          <Eye className="h-4 w-4" />
        </button>
      }
      avisos={
        <>
          {confirmarVisao && (
            <div className="flex flex-wrap items-center rounded-md bg-muted/50 px-2.5 py-2 text-[12px]">
              <span className="mb-1 mr-auto">
                Assistir {aVer.length} {aVer.length === 1 ? "vídeo" : "vídeos"} ({quadrosAVer} quadros, {lotes} {lotes === 1 ? "envio" : "envios"}) com {modeloDeVisao ? nomeDoModelo(modeloDeVisao) : "nenhum modelo com imagem"}: ~{usd(custoDaVisao)}
              </span>
              <button type="button" className={juntar(botao.primario, "mb-1 mr-1 h-8")} onClick={() => void assistir()} disabled={!modeloDeVisao}>
                Assistir por ~{usd(custoDaVisao)}
              </button>
              <button type="button" className={juntar(botao.discreto, "mb-1 h-8")} onClick={() => setConfirmarVisao(false)}>
                Cancelar
              </button>
            </div>
          )}
          {cartaoDoPreparo}
          {proposta && <CartaoDeAcao key={proposta.acao.id} acao={proposta.acao} titulo="O agente vai mudar" onPedido={aoPedido} observacao="Nada muda até confirmar. Ctrl+Z também desfaz." />}
        </>
      }
      compositor={
        <div className="min-w-0">
          <div className="flex flex-wrap" role="group" aria-label="Atalhos do agente editor">
            {ATALHOS.map((a) => (
              <button
                key={a.skill}
                type="button"
                disabled={!!rodando || !projeto}
                onClick={() => atalho(a.skill, a.rotulo)}
                data-atalho-do-editor={a.skill}
                className="mb-1 mr-1 max-w-full truncate rounded-full border border-border bg-background px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
              >
                {a.rotulo}
              </button>
            ))}
          </div>
          <form
            className="flex min-w-0 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              enviar();
            }}
          >
            <textarea
              className={juntar(campoTexto, "mr-1.5 min-h-[40px] flex-1 resize-none py-2")}
              rows={2}
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviar();
                }
              }}
              placeholder={!modelo ? "Nenhum modelo de texto ativo no catálogo" : projeto ? "Ex.: edite com a skill do Brabo" : "Abra um vídeo no editor"}
              aria-label="Pedido para o agente editor"
              disabled={!modelo || !projeto}
              maxLength={MAX_TEXTO_DO_PEDIDO}
            />
            {rodando ? (
              <button type="button" className={botao.icone} onClick={() => (parar.current = true)} aria-label="Parar o agente">
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button type="submit" className={juntar(botao.primario, "h-10 w-10 px-0")} disabled={!rascunho.trim() || !modelo || !projeto} aria-label="Mandar para o agente">
                <Send className="h-4 w-4" />
              </button>
            )}
          </form>
        </div>
      }
    >
      {!projeto && <div className={juntar(texto.auxiliar, "px-1 py-2")} data-agente-sem-editor="">{semEditor || "Abra um vídeo no editor para o agente editar."}</div>}
      {projeto && !mensagens.length && !rodando && <p className={juntar(conversa.apoio, "px-1 py-2")}>Peça uma edição ou use um atalho. Você confere a lista antes.</p>}
      {mensagens.map((m, k) => (
        <div key={k} className={juntar(conversa.balao, "space-y-1", m.quem === "dono" ? conversa.doUsuario : conversa.doAgente)}>
          {m.itens.map((i, j) => (
            <p key={j} className={juntar("[overflow-wrap:anywhere]", i.tipo === "ferramenta" && "text-[12.5px] text-muted-foreground", i.tipo === "aviso" && "text-[12.5px] text-amber-500", i.tipo === "plano" && "italic text-muted-foreground")}>
              {i.texto}
            </p>
          ))}
        </div>
      ))}
      {rodando && (
        <p className={juntar(conversa.apoio, "flex items-center")}>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          {rodando}
        </p>
      )}
    </PainelDoAgente>
  );
}
