import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ClipboardCheck, Download, FileText, Loader2, Plus, Save, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useMesa } from "@/components/mesa/MesaContexto";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { dataCurta, modelosAtivos, nomeDoModelo, padraoPara } from "@/lib/mesa/api";
import {
  duracaoEstimada,
  escolherGancho,
  faltasDoRoteiro,
  hashDoRoteiro,
  MODOS_DE_ROTEIRO,
  modoDoTipo,
  motivoParaNaoEditar,
  normalizarRoteiro,
  ROTULO_DO_FORMATO,
  TAMANHO_DA_GERACAO,
  versaoPorNumero,
  type BlocoDoRoteiro,
  type LinhaDoRoteiro,
  type Roteiro,
  type TipoDeRoteiro,
} from "../../../supabase/functions/_shared/roteiro-modelo";
import { atualizarNoCache, chamarRoteiros, gerarRoteiro, roteiroDaPeca, salvarVersao, useModelos, usePecasDeVideo, useRoteiros } from "./roteirosApi";
import { AvisoDoBanco, AvisoDoJevCartao, CAMPO, OBJETIVOS, SeloDoStatus } from "./Comuns";
import { baixarBytes, itemSolto, montarPdf } from "./pdfNoNavegador";

/**
 * Etapa 2: o roteiro. Sem roteiro, o formulário (tipo, duração, objetivo,
 * pedido, modelo aprovado e modelo de IA) com o custo antes. Com roteiro, o
 * editor da versão atual: três ganchos, blocos de fala com tempo, direção de
 * gravação, texto na tela, apoio, CTA e legenda. Salvar cria versão nova
 * (aprovada é imutável). Refazer gancho, mudar tom e gerar de novo usam IA,
 * com o preço ao lado do botão.
 */

type IrPara = "revisao" | "pdf";

export default function EtapaRoteiro({
  roteiroId,
  tarefaId,
  avulso,
  modeloId,
  onAberto,
  onIrPara,
  onVoltar,
}: {
  roteiroId: string | null;
  tarefaId: string | null;
  avulso: boolean;
  modeloId: string | null;
  onAberto: (id: string) => void;
  onIrPara: (etapa: IrPara, roteiroId?: string | null) => void;
  onVoltar: () => void;
}) {
  const { clientId } = useMesa();
  const roteirosQ = useRoteiros(clientId);
  const lista = roteirosQ.data ? roteirosQ.data.lista : [];
  const linha = roteiroId ? lista.filter((r) => r.id === roteiroId)[0] || null : tarefaId ? roteiroDaPeca(lista, tarefaId) : null;
  // Roteiro gerado sem banco (SQL pendente): fica só nesta tela.
  const [solto, setSolto] = useState<Roteiro | null>(null);

  useEffect(() => {
    if (linha && !roteiroId) onAberto(linha.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linha ? linha.id : ""]);

  if (roteirosQ.isLoading) {
    return <p className="flex items-center text-[12.5px] text-muted-foreground"><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Carregando o roteiro...</p>;
  }
  if (roteiroId && !linha) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
        Este roteiro não está na lista do cliente.
        <Button type="button" size="sm" variant="outline" className="ml-2 h-8" onClick={onVoltar}>Voltar à agenda</Button>
      </div>
    );
  }
  if (linha) return <EditorDoRoteiro key={`${linha.id}:${linha.versao_atual}`} linha={linha} onIrPara={onIrPara} />;
  if (solto) return <RoteiroSolto roteiro={solto} onDescartar={() => setSolto(null)} />;
  if (!tarefaId && !avulso) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center">
        <p className="text-[14px] font-medium">Escolha uma peça de vídeo na Agenda ou comece um roteiro avulso.</p>
        <Button type="button" size="sm" variant="outline" className="mt-3 h-8" onClick={onVoltar}>Ir para a Agenda</Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {roteirosQ.data && roteirosQ.data.indisponivel && <AvisoDoBanco />}
      <FormularioDeGeracao tarefaId={tarefaId} modeloInicial={modeloId} onGerado={(id) => onAberto(id)} onSolto={setSolto} />
    </div>
  );
}

// ------------------------------------------------------------------ formulário de geração

function FormularioDeGeracao({ tarefaId, modeloInicial, onGerado, onSolto }: { tarefaId: string | null; modeloInicial: string | null; onGerado: (id: string) => void; onSolto: (r: Roteiro) => void }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const pecasQ = usePecasDeVideo(mesa.clientId);
  const modelosQ = useModelos(mesa.clientId);
  const peca = tarefaId ? (pecasQ.data || []).filter((p) => p.id === tarefaId)[0] || null : null;
  const modelosDeRoteiro = modelosQ.data ? modelosQ.data.lista : [];
  const [modeloDeRoteiro, setModeloDeRoteiro] = useState<string>(modeloInicial || "");
  const escolhido = modelosDeRoteiro.filter((m) => m.id === modeloDeRoteiro)[0] || null;
  const [tipo, setTipo] = useState<TipoDeRoteiro>("fala_camera");
  const [duracao, setDuracao] = useState<number>(modoDoTipo("fala_camera").duracao_padrao_s);
  const [objetivo, setObjetivo] = useState("ensinar");
  const [tema, setTema] = useState("");
  const [pedido, setPedido] = useState("");
  const textos = modelosAtivos(mesa.catalogo, "texto");
  const padrao = padraoPara(mesa.catalogo, "estrategista");
  const [modeloIa, setModeloIa] = useState<string>("");
  const idDoModeloIa = modeloIa || (padrao ? padrao.id : "");
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    if (escolhido) {
      setTipo(escolhido.tipo);
      setDuracao(escolhido.estrutura.duracao_alvo_s);
    }
  }, [escolhido ? escolhido.id : ""]);

  const trocarTipo = (t: TipoDeRoteiro) => {
    setTipo(t);
    setDuracao(modoDoTipo(t).duracao_padrao_s);
  };

  const semTema = !tarefaId && !tema.trim();
  const corpo = {
    client_id: mesa.clientId,
    task_id: tarefaId,
    tipo,
    duracao_s: duracao,
    objetivo: (OBJETIVOS.filter((o) => o.valor === objetivo)[0] || OBJETIVOS[0]).rotulo,
    pedido: pedido.trim() || undefined,
    tema: tema.trim() || undefined,
    modelo_id: idDoModeloIa || null,
    modelo_roteiro_id: modeloDeRoteiro || null,
  };

  const emBranco = async () => {
    setCriando(true);
    try {
      const r = await chamarRoteiros("roteiro_criar", { client_id: mesa.clientId, task_id: tarefaId, tipo, titulo: tema.trim() || undefined, modelo_roteiro_id: modeloDeRoteiro || null });
      if (r.roteiro) {
        atualizarNoCache(qc, mesa.clientId, r.roteiro);
        onGerado(r.roteiro.id);
      }
    } catch (e) {
      avisarErro(e, "Não foi possível criar o rascunho");
    } finally {
      setCriando(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4" data-formulario-de-roteiro="">
      <h2 className="text-[15px] font-semibold">{peca ? `Roteiro de ${peca.titulo}` : tarefaId ? "Roteiro da peça" : "Roteiro avulso"}</h2>
      {peca && (
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {ROTULO_DO_FORMATO[peca.formato] || peca.formato} · {dataCurta(peca.data)}
          {peca.temRoteiroDaAgenda ? " · o roteiro gravado no calendário entra como base" : ""}
        </p>
      )}
      <p className="mt-1 text-[12px] text-muted-foreground">Contexto do cliente, cérebro e campanha entram sozinhos. Você só diz o formato e o que quer.</p>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4" role="radiogroup" aria-label="Tipo de roteiro">
        {MODOS_DE_ROTEIRO.map((m) => (
          <button
            key={m.valor}
            type="button"
            role="radio"
            aria-checked={tipo === m.valor}
            onClick={() => trocarTipo(m.valor)}
            className={`min-w-0 rounded-xl border p-2.5 text-left transition-colors ${tipo === m.valor ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
          >
            <span className="block truncate text-[12.5px] font-semibold">{m.rotulo}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{m.estrutura.join(", ")}</span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">{modoDoTipo(tipo).cuidados}</p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block min-w-0 text-[12px]">
          <span className="mb-1 block text-muted-foreground">Duração (segundos)</span>
          <input type="number" min={10} max={300} value={duracao} onChange={(e) => setDuracao(Math.max(10, Math.min(300, Number(e.target.value) || 10)))} className={CAMPO} />
        </label>
        <label className="block min-w-0 text-[12px]">
          <span className="mb-1 block text-muted-foreground">Objetivo</span>
          <select value={objetivo} onChange={(e) => setObjetivo(e.target.value)} className={CAMPO}>
            {OBJETIVOS.map((o) => (
              <option key={o.valor} value={o.valor}>{o.rotulo}</option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 text-[12px]">
          <span className="mb-1 block text-muted-foreground">Modelo aprovado (opcional)</span>
          <select value={modeloDeRoteiro} onChange={(e) => setModeloDeRoteiro(e.target.value)} className={CAMPO} disabled={!modelosDeRoteiro.length}>
            <option value="">{modelosDeRoteiro.length ? "Sem modelo" : "Nenhum modelo ainda"}</option>
            {modelosDeRoteiro.map((m) => (
              <option key={m.id} value={m.id}>{m.escopo === "agencia" ? "Agência: " : ""}{m.nome}</option>
            ))}
          </select>
        </label>
      </div>
      {!tarefaId && (
        <label className="mt-3 block text-[12px]">
          <span className="mb-1 block text-muted-foreground">Tema do vídeo</span>
          <input value={tema} onChange={(e) => setTema(e.target.value)} maxLength={300} placeholder="Ex.: como funciona o período de graça do INSS" className={CAMPO} />
        </label>
      )}
      <label className="mt-3 block text-[12px]">
        <span className="mb-1 block text-muted-foreground">Pedido da equipe (opcional)</span>
        <Textarea value={pedido} onChange={(e) => setPedido(e.target.value)} rows={2} maxLength={2000} placeholder="Ex.: a advogada grava sentada; falar de documentos sem prometer resultado" className="text-[12.5px]" />
      </label>
      <div className="mt-3 flex min-w-0 flex-wrap items-center">
        <label className="mr-3 flex min-w-0 items-center text-[12px] text-muted-foreground">
          <span className="mr-1.5 shrink-0">Modelo de IA</span>
          <select value={idDoModeloIa} onChange={(e) => setModeloIa(e.target.value)} className={`${CAMPO} w-auto max-w-[220px]`} aria-label="Modelo de IA">
            {textos.map((m) => (
              <option key={m.id} value={m.id}>{nomeDoModelo(m)}{padrao && padrao.id === m.id ? " (padrão)" : ""}</option>
            ))}
          </select>
        </label>
        <div className="mt-2 flex items-center sm:mt-0">
          <Button type="button" size="sm" variant="outline" className="mr-2 h-8 text-[12px]" onClick={() => void emBranco()} disabled={criando || semTema}>
            {criando && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Começar em branco
          </Button>
          <BotaoComCusto
            rotulo={<><Wand2 className="mr-1 h-3.5 w-3.5" />Gerar roteiro</>}
            titulo="Roteiro gerado"
            descricao="Gera o roteiro com 3 ganchos, falas com tempo, direção, texto na tela, apoio, CTA e legenda."
            disabled={!idDoModeloIa || semTema}
            partes={() => [{ modeloId: idDoModeloIa, tipo: "texto", tokensEntrada: TAMANHO_DA_GERACAO.entrada, tokensSaida: TAMANHO_DA_GERACAO.saida }]}
            executar={() => gerarRoteiro(corpo)}
            aoConcluir={(data) => {
              if (data && data.roteiro) {
                atualizarNoCache(qc, mesa.clientId, data.roteiro);
                onGerado(data.roteiro.id);
              } else if (data && data.versao) {
                toast.warning("Roteiro gerado sem guardar", { description: data.aviso_banco || "O banco ainda não guarda roteiros." });
                onSolto(normalizarRoteiro(data.versao.conteudo));
              }
            }}
          />
        </div>
      </div>
      {semTema && <p className="mt-2 text-[11.5px] text-muted-foreground">Escreva o tema para o roteiro avulso.</p>}
    </section>
  );
}

// ------------------------------------------------------------------ roteiro sem banco

function RoteiroSolto({ roteiro, onDescartar }: { roteiro: Roteiro; onDescartar: () => void }) {
  const mesa = useMesa();
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <AvisoDoBanco />
      <h2 className="text-[15px] font-semibold">{roteiro.titulo}</h2>
      <ol className="space-y-2">
        {roteiro.blocos.map((b) => (
          <li key={b.id} className="rounded-lg bg-muted/50 p-2.5 text-[12.5px]">
            <span className="mr-1 font-semibold">{b.funcao}:</span>
            {b.fala}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap">
        <Button type="button" size="sm" className="mr-2 h-8 text-[12px]" onClick={() => {
          const p = montarPdf(mesa.clientName || "Cliente", [itemSolto(roteiro)]);
          baixarBytes(p.bytes, p.nome);
        }}>
          <Download className="mr-1 h-3.5 w-3.5" /> Baixar PDF
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={onDescartar}>Fechar</Button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ editor

const linhas = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

function EditorDoRoteiro({ linha, onIrPara }: { linha: LinhaDoRoteiro; onIrPara: (etapa: IrPara, roteiroId?: string | null) => void }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const versao = versaoPorNumero(linha.versoes, linha.versao_atual);
  const [rascunho, setRascunho] = useState<Roteiro>(() => (versao ? versao.conteudo : normalizarRoteiro({}, { titulo: linha.titulo, tipo: linha.tipo })));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const [pedidoGancho, setPedidoGancho] = useState("");
  const [tom, setTom] = useState("");
  const bloqueio = motivoParaNaoEditar(linha.status, !!linha.arquivado_em);
  const alterado = useMemo(() => !versao || versao.hash !== hashDoRoteiro(normalizarRoteiro(rascunho)), [rascunho, versao]);
  const duracao = duracaoEstimada(rascunho);
  const faltas = faltasDoRoteiro(rascunho);
  const padrao = padraoPara(mesa.catalogo, "estrategista");
  const modeloIa = padrao ? padrao.id : "";

  const mudar = (parte: Partial<Roteiro>) => setRascunho((r) => ({ ...r, ...parte }));
  const mudarBloco = (i: number, parte: Partial<BlocoDoRoteiro>) =>
    setRascunho((r) => ({ ...r, blocos: r.blocos.map((b, k) => (k === i ? { ...b, ...parte } : b)) }));
  const moverBloco = (i: number, delta: number) =>
    setRascunho((r) => {
      const j = i + delta;
      if (j < 0 || j >= r.blocos.length) return r;
      const b = r.blocos.slice();
      const x = b[i];
      b[i] = b[j];
      b[j] = x;
      return { ...r, blocos: b.map((y, k) => ({ ...y, ordem: k + 1 })) };
    });
  const tirarBloco = (i: number) => setRascunho((r) => ({ ...r, blocos: r.blocos.filter((_, k) => k !== i).map((y, k) => ({ ...y, ordem: k + 1 })) }));
  const novoBloco = () =>
    setRascunho((r) => {
      let n = r.blocos.length + 1;
      while (r.blocos.some((b) => b.id === `b${n}`)) n++;
      return { ...r, blocos: r.blocos.concat([{ id: `b${n}`, ordem: r.blocos.length + 1, funcao: "Bloco", fala: "", segundos: 5, visual: "a definir", texto_na_tela: "", broll: "" }]) };
    });
  const mudarDirecao = (parte: Partial<Roteiro["direcao"]>) => setRascunho((r) => ({ ...r, direcao: { ...r.direcao, ...parte } }));

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const r = await salvarVersao(linha.id, normalizarRoteiro(rascunho, { tipo: linha.tipo }), linha.versao_atual);
      if (r.sem_mudanca) toast.info("Nada mudou nesta versão.");
      else toast.success(`Versão ${r.versao ? r.versao.numero : ""} salva`);
      atualizarNoCache(qc, mesa.clientId, r.roteiro);
    } catch (e) {
      setErro(e);
    } finally {
      setSalvando(false);
    }
  };

  const depoisDaIa = (data: any) => {
    if (data && data.roteiro) atualizarNoCache(qc, mesa.clientId, data.roteiro);
  };

  const travado = !!bloqueio;
  return (
    <div className="space-y-4" data-editor-do-roteiro={linha.id}>
      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex min-w-0 flex-wrap items-start">
          <div className="mr-auto min-w-0 flex-1">
            <input value={rascunho.titulo} onChange={(e) => mudar({ titulo: e.target.value })} disabled={travado} aria-label="Título do roteiro" className="w-full min-w-0 bg-transparent text-[18px] font-semibold outline-none" />
            <input value={rascunho.subtitulo} onChange={(e) => mudar({ subtitulo: e.target.value })} disabled={travado} placeholder="Pergunta ou ideia central" aria-label="Subtítulo" className="w-full min-w-0 bg-transparent text-[12.5px] text-muted-foreground outline-none" />
          </div>
          <div className="mt-1 flex shrink-0 items-center">
            <SeloDoStatus status={linha.status} />
            <span className="ml-2 text-[11.5px] text-muted-foreground">versão {linha.versao_atual}{linha.versao_aprovada ? ` · aprovada ${linha.versao_aprovada}` : ""}</span>
          </div>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground" data-duracao="">
          {modoDoTipo(rascunho.tipo).rotulo} · {duracao.min_s} a {duracao.max_s}s pela fala ({duracao.palavras} palavras) · alvo {rascunho.duracao_alvo_s}s
        </p>
        {bloqueio && <p className="mt-2 rounded-lg bg-muted px-2.5 py-1.5 text-[12px]">{bloqueio}</p>}
        {!bloqueio && linha.status === "aprovado" && <p className="mt-2 text-[11.5px] text-muted-foreground">Salvar cria a versão {linha.versao_atual + 1} em rascunho. A aprovada continua guardada.</p>}
        <div className="mt-3 flex flex-wrap items-center">
          <Button type="button" size="sm" className="mb-1 mr-2 h-8 text-[12px]" onClick={() => void salvar()} disabled={travado || !alterado || salvando}>
            {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}Salvar versão
          </Button>
          {alterado && !travado && (
            <Button type="button" size="sm" variant="ghost" className="mb-1 mr-2 h-8 text-[12px]" onClick={() => versao && setRascunho(versao.conteudo)}>Descartar mudanças</Button>
          )}
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-2 h-8 text-[12px]" onClick={() => onIrPara("revisao", linha.id)}>
            <ClipboardCheck className="mr-1 h-3.5 w-3.5" />Revisão e aprovação
          </Button>
          <Button type="button" size="sm" variant="outline" className="mb-1 h-8 text-[12px]" onClick={() => onIrPara("pdf", linha.id)}>
            <FileText className="mr-1 h-3.5 w-3.5" />PDF
          </Button>
        </div>
        {erro ? <AvisoDeErro erro={erro} className="mt-2" /> : null}
        {faltas.length > 0 && <p className="mt-2 text-[11.5px] text-muted-foreground">Falta: {faltas.join(" ")}</p>}
      </section>

      <AvisoDoJevCartao aviso={versao ? versao.aviso : null} />

      <section className="rounded-2xl border border-border bg-card p-4" data-ganchos="">
        <h3 className="text-[13.5px] font-semibold">Gancho</h3>
        <p className="text-[11.5px] text-muted-foreground">Três aberturas de mecanismos diferentes. A escolhida vira a fala do bloco 1; as outras vão para o PDF como aberturas para testar.</p>
        <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-3" role="radiogroup" aria-label="Ganchos">
          {rascunho.ganchos.map((g, i) => (
            <div key={i} className={`min-w-0 rounded-xl border p-2.5 ${rascunho.gancho_escolhido === i ? "border-primary bg-primary/5" : "border-border"}`}>
              <label className="flex items-start text-[12.5px]">
                <input type="radio" name={`gancho-${linha.id}`} className="mr-2 mt-1" checked={rascunho.gancho_escolhido === i} disabled={travado} onChange={() => setRascunho((r) => escolherGancho(r, i))} aria-label={`Usar o gancho ${i + 1}`} />
                <span className="min-w-0 [overflow-wrap:anywhere]">{g.texto}</span>
              </label>
              <p className="mt-1 text-[11px] text-muted-foreground">{[g.mecanismo, g.promessa ? `promete: ${g.promessa}` : ""].filter(Boolean).join(" · ")}</p>
            </div>
          ))}
        </div>
        {!travado && (
          <div className="mt-3 flex min-w-0 flex-wrap items-center">
            <input value={pedidoGancho} onChange={(e) => setPedidoGancho(e.target.value)} maxLength={300} placeholder="Pedido para o gancho (opcional). Ex.: mais direto" className={`${CAMPO} mb-1 mr-2 flex-1`} aria-label="Pedido para refazer o gancho" />
            <BotaoComCusto
              rotulo="Refazer gancho"
              titulo="Gancho refeito"
              variant="outline"
              disabled={alterado || !modeloIa}
              descricao={alterado ? "Salve as mudanças antes." : "Três ganchos novos; cria uma versão nova."}
              partes={() => [{ modeloId: modeloIa, tipo: "texto", tokensEntrada: 6_000, tokensSaida: 2_500 }]}
              executar={() => chamarRoteiros("gancho_refazer", { roteiro_id: linha.id, pedido: pedidoGancho.trim() || undefined })}
              aoConcluir={depoisDaIa}
            />
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4" data-blocos="">
        <div className="flex items-center">
          <h3 className="mr-auto text-[13.5px] font-semibold">Falas por bloco</h3>
          {!travado && (
            <Button type="button" size="sm" variant="ghost" className="h-8 text-[12px]" onClick={novoBloco}>
              <Plus className="mr-1 h-3.5 w-3.5" />Bloco
            </Button>
          )}
        </div>
        <ol className="mt-2 space-y-3">
          {rascunho.blocos.map((b, i) => (
            <li key={b.id} className={`rounded-xl border p-3 ${i === 0 ? "border-foreground/20 bg-foreground/[0.03]" : "border-border"}`} data-bloco={b.id}>
              <div className="flex min-w-0 flex-wrap items-center">
                <span className="mr-2 text-[13px] font-bold text-primary">{String(i + 1).padStart(2, "0")}</span>
                <input value={b.funcao} onChange={(e) => mudarBloco(i, { funcao: e.target.value })} disabled={travado} aria-label={`Função do bloco ${i + 1}`} className={`${CAMPO} mr-2 w-40 font-semibold uppercase`} />
                <label className="mr-auto flex items-center text-[11.5px] text-muted-foreground">
                  <input type="number" min={1} max={180} value={b.segundos} onChange={(e) => mudarBloco(i, { segundos: Math.max(1, Math.min(180, Number(e.target.value) || 1)) })} disabled={travado} aria-label={`Segundos do bloco ${i + 1}`} className={`${CAMPO} mr-1 w-16`} />s
                </label>
                {!travado && (
                  <span className="flex items-center">
                    <button type="button" className="p-1 text-muted-foreground hover:text-foreground" onClick={() => moverBloco(i, -1)} aria-label={`Subir o bloco ${i + 1}`}><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button type="button" className="p-1 text-muted-foreground hover:text-foreground" onClick={() => moverBloco(i, 1)} aria-label={`Descer o bloco ${i + 1}`}><ArrowDown className="h-3.5 w-3.5" /></button>
                    <button type="button" className="p-1 text-muted-foreground hover:text-destructive" onClick={() => tirarBloco(i)} aria-label={`Tirar o bloco ${i + 1}`}><Trash2 className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </div>
              <Textarea value={b.fala} onChange={(e) => mudarBloco(i, { fala: e.target.value })} disabled={travado} rows={3} aria-label={`Fala do bloco ${i + 1}`} className="mt-2 text-[13px] leading-relaxed" />
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                <input value={b.visual} onChange={(e) => mudarBloco(i, { visual: e.target.value })} disabled={travado} placeholder="O que a câmera mostra" aria-label={`Imagem do bloco ${i + 1}`} className={CAMPO} />
                <input value={b.texto_na_tela} onChange={(e) => mudarBloco(i, { texto_na_tela: e.target.value })} disabled={travado} placeholder="Texto na tela" aria-label={`Texto na tela do bloco ${i + 1}`} className={CAMPO} />
                <input value={b.broll} onChange={(e) => mudarBloco(i, { broll: e.target.value })} disabled={travado} placeholder="Imagem de apoio (B-roll)" aria-label={`Apoio do bloco ${i + 1}`} className={CAMPO} />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4" data-direcao="">
        <h3 className="text-[13.5px] font-semibold">Direção de gravação</h3>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ["enquadramento", "Enquadramento"],
            ["ambiente", "Ambiente"],
            ["figurino", "Figurino"],
            ["objetos", "Objetos em cena"],
            ["luz", "Luz"],
            ["camera", "Câmera"],
          ] as const).map(([campo, rotulo]) => (
            <label key={campo} className="block min-w-0 text-[12px]">
              <span className="mb-1 block text-muted-foreground">{rotulo}</span>
              <input value={rascunho.direcao[campo]} onChange={(e) => mudarDirecao({ [campo]: e.target.value } as Partial<Roteiro["direcao"]>)} disabled={travado} className={CAMPO} />
            </label>
          ))}
        </div>
        <label className="mt-2 block text-[12px]">
          <span className="mb-1 block text-muted-foreground">Orientações de atuação e captação (uma por linha)</span>
          <Textarea value={rascunho.direcao.orientacoes.join("\n")} onChange={(e) => mudarDirecao({ orientacoes: linhas(e.target.value) })} disabled={travado} rows={3} className="text-[12.5px]" />
        </label>
        <label className="mt-2 block text-[12px]">
          <span className="mb-1 block text-muted-foreground">Imagens de apoio gerais (uma por linha)</span>
          <Textarea value={rascunho.broll.join("\n")} onChange={(e) => mudar({ broll: linhas(e.target.value) })} disabled={travado} rows={2} className="text-[12.5px]" />
        </label>
        {rascunho.tipo === "cinema" && (
          <label className="mt-2 block text-[12px]">
            <span className="mb-1 block text-muted-foreground">Premissa (logline)</span>
            <input value={rascunho.logline} onChange={(e) => mudar({ logline: e.target.value })} disabled={travado} className={CAMPO} />
          </label>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4" data-publicacao="">
        <h3 className="text-[13.5px] font-semibold">CTA e legenda do post</h3>
        <label className="mt-2 block text-[12px]">
          <span className="mb-1 block text-muted-foreground">CTA</span>
          <input value={rascunho.cta} onChange={(e) => mudar({ cta: e.target.value })} disabled={travado} className={CAMPO} />
        </label>
        <label className="mt-2 block text-[12px]">
          <span className="mb-1 block text-muted-foreground">Legenda</span>
          <Textarea value={rascunho.legenda} onChange={(e) => mudar({ legenda: e.target.value })} disabled={travado} rows={4} className="text-[12.5px]" />
        </label>
        <label className="mt-2 block text-[12px]">
          <span className="mb-1 block text-muted-foreground">Hashtags (separadas por espaço)</span>
          <input value={rascunho.hashtags.join(" ")} onChange={(e) => mudar({ hashtags: e.target.value.split(/\s+/).filter(Boolean) })} disabled={travado} className={CAMPO} />
        </label>
        <label className="mt-2 block text-[12px]">
          <span className="mb-1 block text-muted-foreground">Pendências antes de gravar (uma por linha)</span>
          <Textarea value={rascunho.pendencias.join("\n")} onChange={(e) => mudar({ pendencias: linhas(e.target.value) })} disabled={travado} rows={2} className="text-[12.5px]" />
        </label>
        {rascunho.fontes.length > 0 && <p className="mt-2 text-[11.5px] text-muted-foreground">Fontes: {rascunho.fontes.join("; ")}</p>}
      </section>

      {!travado && (
        <section className="rounded-2xl border border-border bg-card p-4" data-refazer="">
          <h3 className="text-[13.5px] font-semibold">Pedir ao roteirista</h3>
          <p className="text-[11.5px] text-muted-foreground">Cada pedido gera uma versão nova. A atual fica no histórico da Revisão.{alterado ? " Salve as mudanças antes." : ""}</p>
          <div className="mt-2 flex min-w-0 flex-wrap items-center">
            <input value={tom} onChange={(e) => setTom(e.target.value)} maxLength={160} placeholder="Tom novo. Ex.: mais leve e próximo" className={`${CAMPO} mb-1 mr-2 flex-1`} aria-label="Tom novo" />
            <BotaoComCusto
              rotulo="Mudar o tom"
              titulo="Tom mudado"
              variant="outline"
              disabled={alterado || tom.trim().length < 3 || !modeloIa}
              partes={() => [{ modeloId: modeloIa, tipo: "texto", tokensEntrada: TAMANHO_DA_GERACAO.entrada, tokensSaida: TAMANHO_DA_GERACAO.saida }]}
              executar={() => chamarRoteiros("tom_mudar", { roteiro_id: linha.id, tom: tom.trim() })}
              aoConcluir={depoisDaIa}
            />
          </div>
          <div className="mt-2">
            <BotaoComCusto
              rotulo={<><Wand2 className="mr-1 h-3.5 w-3.5" />Gerar de novo</>}
              titulo="Roteiro gerado de novo"
              variant="outline"
              disabled={alterado || !modeloIa}
              descricao="Escreve o roteiro de novo, com os comentários abertos da Revisão."
              partes={() => [{ modeloId: modeloIa, tipo: "texto", tokensEntrada: TAMANHO_DA_GERACAO.entrada, tokensSaida: TAMANHO_DA_GERACAO.saida }]}
              executar={() => chamarRoteiros("gerar", { client_id: mesa.clientId, roteiro_id: linha.id, tipo: linha.tipo, duracao_s: rascunho.duracao_alvo_s, objetivo: rascunho.objetivo || undefined })}
              aoConcluir={depoisDaIa}
            />
          </div>
        </section>
      )}
    </div>
  );
}
