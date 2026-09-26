import { useMemo, useRef, useState } from "react";
import { Bot, Eye, Loader2, Send, Square } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import PainelDoAgente from "@/components/sistema/PainelDoAgente";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import { textoDoErro, usd, type ModeloIa } from "@/lib/mesa/api";
import type { AcaoDoAgente, RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import type { ProjetoDeEdicao, TrechoVisto } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import {
  estimarPasso,
  MAX_FERRAMENTAS,
  MAX_PASSOS,
  MAX_QUADROS_POR_CHAMADA,
  sugerirModeloMaisBarato,
  temposDeAmostra,
  TETO_PADRAO_USD,
} from "../../../../supabase/functions/editor-video/ferramentas";
import { contextoDoAgente, rodarAgente, type ItemDoLog } from "@/lib/editor/agente";
import { acaoDaProposta, acaoFeita } from "@/lib/editor/cartao";
import { chamarEditorVideo, emPreparacao, novoId } from "@/lib/editor/api";
import { aplicarOperacao, assinaturaDoProjeto, trilhaPrincipal, type Operacao } from "@/lib/editor/operacoes";
import { base64DoDataUrl, extrairQuadro, tempoDoQuadro } from "@/lib/editor/quadros";
import type { PropostaDaSkill } from "@/lib/editor/skills";
import type { ControleDePropostas } from "./PainelDeSkills";

/**
 * Agente editor na lateral do editor (frente V-B). O dono escolhe o modelo
 * (qualquer modelo de texto do catálogo ia_modelos) e o esforço de raciocínio
 * quando o modelo aceita; o agente só SUGERE um mais barato. Custo estimado
 * antes; teto por pedido; até MAX_PASSOS passos e MAX_FERRAMENTAS
 * ferramentas. O resultado é uma proposta com Confirmar/Cancelar e Desfazer.
 * "Assistir o vídeo": quadros no tempo exato, mandados em lotes a um modelo
 * com imagem; a descrição por trecho fica guardada no projeto.
 */

interface Mensagem {
  quem: "dono" | "agente";
  itens: ItemDoLog[];
}

const aceitaImagem = (m: ModeloIa) => {
  const mod = (m as unknown as { modalidades?: { entrada?: string[] } | null }).modalidades;
  if (mod && Array.isArray(mod.entrada)) return mod.entrada.indexOf("image") >= 0;
  return m.provedor === "openai" || /gpt|claude|gemini/i.test(m.modelo_api);
};

const nomeDoModelo = (m: ModeloIa) => m.rotulo || m.modelo_api;

export default function AgenteEditor({
  projeto,
  controle,
  onAplicarProjeto,
  urls,
}: {
  projeto: ProjetoDeEdicao;
  controle: ControleDePropostas;
  onAplicarProjeto: (p: ProjetoDeEdicao, rotulo: string) => void;
  urls: Record<string, string>;
}) {
  const { clientId, catalogo } = useMesa();
  const modelos = useMemo(() => (catalogo || []).filter((m) => m.tipo === "texto" && m.ativo).sort((a, b) => (Number(a.preco_saida_1m) || 0) - (Number(b.preco_saida_1m) || 0)), [catalogo]);
  const [escolha, setEscolha] = useEstadoDaTela<{ modelo: string; raciocinio: string; teto: number }>(`mesa-edicao:editor:agente:${clientId}`, { modelo: "", raciocinio: "", teto: TETO_PADRAO_USD }, { validar: (v) => !!v && typeof v === "object" });
  const [rascunho, setRascunho] = useEstadoDaTela<string>(`mesa-edicao:editor:agente:rascunho:${clientId}`, "", { esperaMs: 300 });
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [rodando, setRodando] = useState<string | null>(null);
  const [gasto, setGasto] = useState(0);
  const [proposta, setProposta] = useState<{ acao: AcaoDoAgente; p: PropostaDaSkill } | null>(null);
  const parar = useRef(false);
  const refMsgs = useRef<HTMLDivElement | null>(null);

  const modelo = modelos.find((m) => m.id === escolha.modelo) || modelos.find((m) => (m.padrao_para || []).indexOf("diretor_arte") >= 0) || modelos[0] || null;
  const raciocinios = (modelo && modelo.raciocinio) || [];
  const raciocinio = raciocinios.indexOf(escolha.raciocinio) >= 0 ? escolha.raciocinio : "";
  const contexto = useMemo(() => contextoDoAgente(projeto), [projeto]);
  const porPasso = modelo ? estimarPasso(modelo, contexto.length + 4000, raciocinio || null) : 0;
  const sugestao = modelo ? sugerirModeloMaisBarato(modelos, modelo.id, false, aceitaImagem) : null;
  const rolarParaBaixo = () => window.requestAnimationFrame(() => refMsgs.current && (refMsgs.current.scrollTop = refMsgs.current.scrollHeight));

  // ---------------------------------------------------------------- pedido ao agente
  const enviar = async () => {
    const pedido = rascunho.trim();
    if (!pedido || !modelo || rodando) return;
    setMensagens((l) => l.concat([{ quem: "dono", itens: [{ tipo: "resposta", texto: pedido }] }]));
    setRascunho("");
    setRodando("Pensando");
    setProposta(null);
    parar.current = false;
    rolarParaBaixo();
    const base = projeto;
    try {
      const r = await rodarAgente({
        chamar: chamarEditorVideo,
        clientId,
        sessao: novoId(),
        pedido,
        projeto: base,
        modeloId: modelo.id,
        raciocinio: raciocinio || null,
        tetoUsd: escolha.teto,
        agora: new Date().toISOString(),
        cancelado: () => parar.current,
        aoPasso: (log, g) => {
          setGasto(g);
          setRodando(log.length ? log[log.length - 1].texto.slice(0, 80) : "Pensando");
        },
      });
      setGasto(r.gasto_usd);
      setMensagens((l) => l.concat([{ quem: "agente", itens: r.log }]));
      if (r.operacoes.length) {
        const id = `agente-${Date.now().toString(36)}`;
        const p: PropostaDaSkill = { skill: "brabo", titulo: "Agente editor", resumo: r.resposta || "Proposta do agente.", operacoes: r.operacoes, avisos: [], base: "", resultado: r.resultado };
        setProposta({ acao: acaoDaProposta(id, "editor_video", p.resumo, r.operacoes, base), p: { ...p, base: assinaturaDoProjeto(base) } });
      }
    } catch (e) {
      const t = emPreparacao(e) ? "O agente editor está em preparação: falta publicar a função editor-video." : textoDoErro(e);
      setMensagens((l) => l.concat([{ quem: "agente", itens: [{ tipo: "aviso", texto: t }] }]));
    } finally {
      setRodando(null);
      rolarParaBaixo();
    }
  };

  const aoPedido = async (pedido: "confirmar" | "descartar" | "desfazer"): Promise<RespostaDaAcao> => {
    if (!proposta) return {};
    const agora = new Date().toISOString();
    if (pedido === "descartar") {
      const a = { ...proposta.acao, descartada_em: agora };
      setProposta({ ...proposta, acao: a });
      return { anexo: a };
    }
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
    const t = trilhaPrincipal(projeto);
    const chaves: string[] = [];
    (t ? t.clipes : []).forEach((c) => {
      if (!c.fonte || chaves.indexOf(c.fonte) >= 0) return;
      const f = projeto.fontes[c.fonte];
      if (f && f.midia === "video" && f.duracao_s && !projeto.visoes[c.fonte]) chaves.push(c.fonte);
    });
    return chaves;
  }, [projeto]);
  const quadrosAVer = aVer.reduce((n, k) => n + temposDeAmostra(projeto.fontes[k].duracao_s || 0, 24, 1).length, 0);
  const lotes = aVer.reduce((n, k) => n + Math.ceil(temposDeAmostra(projeto.fontes[k].duracao_s || 0, 24, 1).length / MAX_QUADROS_POR_CHAMADA), 0);
  const custoDeUmLote = (n: number) => (modeloDeVisao ? estimarPasso(modeloDeVisao, (n * 1600 + 900) * 4, null) : 0);
  const custoDaVisao = aVer.reduce((s, k) => {
    const n = temposDeAmostra(projeto.fontes[k].duracao_s || 0, 24, 1).length;
    let soma = 0;
    for (let i = 0; i < n; i += MAX_QUADROS_POR_CHAMADA) soma += custoDeUmLote(Math.min(MAX_QUADROS_POR_CHAMADA, n - i));
    return s + soma;
  }, 0);
  const [confirmarVisao, setConfirmarVisao] = useState(false);

  const assistir = async () => {
    if (!modeloDeVisao) return;
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
      setMensagens((l) => l.concat([{ quem: "agente", itens: [{ tipo: "resposta", texto: visto ? `Assisti ${visto} ${visto === 1 ? "vídeo" : "vídeos"}. O que vi ficou guardado por trecho.` : "Nada novo para assistir." }] }]));
    } catch (e) {
      const t = emPreparacao(e) ? "Assistir está em preparação: falta publicar a função editor-video." : textoDoErro(e);
      setMensagens((l) => l.concat([{ quem: "agente", itens: [{ tipo: "aviso", texto: t }] }]));
      toast.error("Não terminou de assistir", { description: t });
    } finally {
      setRodando(null);
      rolarParaBaixo();
    }
  };

  const topo = (
    <div className="space-y-1.5">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] gap-1">
        <select className={juntar(campo, "h-8 text-[12px]")} value={modelo ? modelo.id : ""} onChange={(e) => setEscolha({ ...escolha, modelo: e.target.value, raciocinio: "" })} aria-label="Modelo do agente" disabled={!modelos.length}>
          {!modelos.length && <option value="">Sem modelo no catálogo</option>}
          {modelos.map((m) => (
            <option key={m.id} value={m.id}>
              {nomeDoModelo(m)} ({m.provedor})
            </option>
          ))}
        </select>
        <select className={juntar(campo, "h-8 w-24 text-[12px]")} value={raciocinio} onChange={(e) => setEscolha({ ...escolha, raciocinio: e.target.value })} aria-label="Esforço de raciocínio" disabled={!raciocinios.length}>
          <option value="">{raciocinios.length ? "Padrão" : "Sem ajuste"}</option>
          {raciocinios.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <label className="flex items-center text-[11.5px] text-muted-foreground">
          <span className="mr-1">Teto US$</span>
          <input className={juntar(campo, "h-8 w-16 px-1.5 text-[12px] tabular-nums")} type="number" min={0.05} max={5} step={0.05} value={escolha.teto} onChange={(e) => setEscolha({ ...escolha, teto: Math.max(0.05, Math.min(5, Number(e.target.value) || TETO_PADRAO_USD)) })} aria-label="Teto por pedido em dólar" />
        </label>
      </div>
      <p className={juntar(texto.auxiliar, "truncate")}>
        ~{usd(porPasso)} por passo · até {MAX_PASSOS} passos e {MAX_FERRAMENTAS} ferramentas · gasto aqui {usd(gasto)}
      </p>
      {sugestao && (
        <button type="button" className="text-left text-[11.5px] text-primary hover:underline" onClick={() => setEscolha({ ...escolha, modelo: sugestao.id, raciocinio: "" })}>
          Sugestão: {nomeDoModelo(sugestao)} custa menos e dá conta de editar. Trocar?
        </button>
      )}
    </div>
  );

  return (
    <PainelDoAgente
      titulo="Agente editor"
      descricao="Edita com as ferramentas do editor"
      icone={<Bot className="h-4 w-4" />}
      topo={topo}
      refDasMensagens={refMsgs}
      rotuloDasMensagens="Conversa com o agente editor"
      acoes={
        <button type="button" className={botao.icone} onClick={() => (aVer.length ? setConfirmarVisao(true) : toast.info("Tudo já foi assistido."))} aria-label="Assistir o vídeo" title="Assistir o vídeo (quadros para um modelo com imagem)" disabled={!!rodando}>
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
          {proposta && <CartaoDeAcao key={proposta.acao.id} acao={proposta.acao} titulo="O agente vai mudar" onPedido={aoPedido} observacao="Nada muda até confirmar. Ctrl+Z também desfaz." />}
        </>
      }
      compositor={
        <form
          className="flex min-w-0 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar();
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
                void enviar();
              }
            }}
            placeholder={modelo ? "Ex.: corta os silêncios e põe punch-in nos ganchos" : "Nenhum modelo de texto no catálogo"}
            aria-label="Pedido para o agente editor"
            disabled={!modelo}
            maxLength={1500}
          />
          {rodando ? (
            <button type="button" className={botao.icone} onClick={() => (parar.current = true)} aria-label="Parar o agente">
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button type="submit" className={juntar(botao.primario, "h-10 w-10 px-0")} disabled={!rascunho.trim() || !modelo} aria-label="Mandar para o agente">
              <Send className="h-4 w-4" />
            </button>
          )}
        </form>
      }
    >
      {!mensagens.length && !rodando && <p className={juntar(texto.auxiliar, "px-1 py-2")}>Peça uma edição. O agente usa as mesmas ferramentas da tela e mostra a lista antes de mudar.</p>}
      {mensagens.map((m, k) => (
        <div key={k} className={juntar("mb-2 min-w-0 text-[12.5px]", m.quem === "dono" ? "ml-6 rounded-md bg-primary/10 px-2.5 py-1.5" : "mr-4")}>
          {m.itens.map((i, j) => (
            <p key={j} className={juntar("[overflow-wrap:anywhere]", i.tipo === "ferramenta" && "text-[11.5px] text-muted-foreground", i.tipo === "aviso" && "text-[11.5px] text-amber-500", i.tipo === "plano" && "italic text-muted-foreground")}>
              {i.texto}
            </p>
          ))}
        </div>
      ))}
      {rodando && (
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          {rodando}
        </p>
      )}
    </PainelDoAgente>
  );
}
