import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ClipboardCheck, Download, FileText, Loader2, Plus, Save, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { dataCurta, modelosAtivos, nomeDoModelo, padraoPara } from "@/lib/mesa/api";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import Painel from "@/components/sistema/Painel";
import { botao, campo, campoTexto, foco, juntar, superficie, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
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
import { AvisoDoBanco, AvisoDoJevCartao, BlocoRecolhivel, Cabecalho, OBJETIVOS, RotuloLargo, SeloDoStatus } from "./Comuns";
import { baixarBytes, itemSolto, montarPdf } from "./pdfNoNavegador";

/**
 * Etapa 2: o roteiro. Sem roteiro, o formulário (tipo, duração, objetivo,
 * pedido, modelo aprovado e modelo de IA) com o custo antes. Com roteiro, o
 * editor da versão atual: três ganchos, blocos de fala com tempo, direção de
 * gravação, texto na tela, apoio, CTA e legenda. Salvar cria versão nova
 * (aprovada é imutável). Refazer gancho, mudar tom e gerar de novo usam IA,
 * com o preço ao lado do botão.
 *
 * Sistema de design (26/09): seções separadas por linha (sem cartão por
 * seção), campos com rótulo em cima (CampoDeFormulario + GrupoDeCampos), ações
 * na linha do título e rascunho guardado por roteiro e versão (sair e voltar
 * não perde a edição).
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

  if (roteirosQ.isLoading) return <Carregando forma="aba" rotulo="Carregando o roteiro" />;
  if (roteiroId && !linha) {
    return (
      <EstadoVazio
        icone={<FileText className="h-5 w-5" />}
        titulo="Este roteiro não está na lista do cliente."
        acao={
          <button type="button" className={botao.secundario} onClick={onVoltar}>
            Voltar à agenda
          </button>
        }
      />
    );
  }
  if (linha) return <EditorDoRoteiro key={`${linha.id}:${linha.versao_atual}`} linha={linha} onIrPara={onIrPara} />;
  if (solto) return <RoteiroSolto roteiro={solto} onDescartar={() => setSolto(null)} />;
  if (!tarefaId && !avulso) {
    return (
      <EstadoVazio
        icone={<FileText className="h-5 w-5" />}
        titulo="Escolha uma peça na Agenda ou comece um roteiro avulso."
        acao={
          <button type="button" className={botao.secundario} onClick={onVoltar}>
            Ir para a Agenda
          </button>
        }
      />
    );
  }
  return (
    <div className="min-w-0 space-y-4">
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
  // Textos guardados por cliente e peça (ou avulso): sair e voltar mantém.
  const base = `mesa-roteiros:gerar:${mesa.clientId}:${tarefaId || "avulso"}`;
  const [tema, setTema] = useEstadoDaTela<string>(`${base}:tema`, "");
  const [pedido, setPedido] = useEstadoDaTela<string>(`${base}:pedido`, "");
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
        setTema("");
        setPedido("");
        onGerado(r.roteiro.id);
      }
    } catch (e) {
      avisarErro(e, "Não foi possível criar o rascunho");
    } finally {
      setCriando(false);
    }
  };

  return (
    <Painel
      as="section"
      data-formulario-de-roteiro=""
      titulo={peca ? `Roteiro de ${peca.titulo}` : tarefaId ? "Roteiro da peça" : "Roteiro avulso"}
      descricao={
        peca
          ? `${ROTULO_DO_FORMATO[peca.formato] || peca.formato} · ${dataCurta(peca.data)}${peca.temRoteiroDaAgenda ? " · roteiro do calendário entra como base" : ""}`
          : "Contexto do cliente, cérebro e campanha entram sozinhos."
      }
      rodape={
        <>
          <button type="button" className={botao.secundario} onClick={() => void emBranco()} disabled={criando || semTema}>
            {criando && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Começar em branco
          </button>
          <BotaoComCusto
            rotulo={
              <>
                <Wand2 className="mr-1 h-3.5 w-3.5" />
                Gerar roteiro
              </>
            }
            titulo="Roteiro gerado"
            className="h-9"
            descricao="Gera o roteiro com 3 ganchos, falas com tempo, direção, texto na tela, apoio, CTA e legenda."
            disabled={!idDoModeloIa || semTema}
            partes={() => [{ modeloId: idDoModeloIa, tipo: "texto", tokensEntrada: TAMANHO_DA_GERACAO.entrada, tokensSaida: TAMANHO_DA_GERACAO.saida }]}
            executar={() => gerarRoteiro(corpo)}
            aoConcluir={(data) => {
              if (data && data.roteiro) {
                atualizarNoCache(qc, mesa.clientId, data.roteiro);
                setTema("");
                setPedido("");
                onGerado(data.roteiro.id);
              } else if (data && data.versao) {
                toast.warning("Roteiro gerado sem guardar", { description: data.aviso_banco || "O banco ainda não guarda roteiros." });
                onSolto(normalizarRoteiro(data.versao.conteudo));
              }
            }}
          />
        </>
      }
    >
      <div className="space-y-4">
        <div className="min-w-0">
          <div className="mb-1.5 flex min-w-0 items-center">
            <span className={texto.rotulo}>Tipo de roteiro</span>
            <AjudaRecolhida className="ml-1" rotulo={`Cuidados de ${modoDoTipo(tipo).rotulo}`}>
              {modoDoTipo(tipo).cuidados}
            </AjudaRecolhida>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="radiogroup" aria-label="Tipo de roteiro">
            {MODOS_DE_ROTEIRO.map((m) => (
              <button
                key={m.valor}
                type="button"
                role="radio"
                aria-checked={tipo === m.valor}
                onClick={() => trocarTipo(m.valor)}
                className={juntar("min-w-0 rounded-md border px-2.5 py-2 text-left transition-colors", tipo === m.valor ? "border-primary bg-primary/5" : "border-border hover:border-primary/40", foco)}
              >
                <span className="block truncate text-[12.5px] font-semibold">{m.rotulo}</span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={m.estrutura.join(", ")}>
                  {m.estrutura.join(", ")}
                </span>
              </button>
            ))}
          </div>
        </div>

        <GrupoDeCampos colunas={3}>
          <CampoDeFormulario rotulo="Duração (segundos)">
            <input type="number" min={10} max={300} value={duracao} onChange={(e) => setDuracao(Math.max(10, Math.min(300, Number(e.target.value) || 10)))} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Objetivo">
            <select value={objetivo} onChange={(e) => setObjetivo(e.target.value)} className={campo}>
              {OBJETIVOS.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Modelo aprovado" ajuda="Opcional. O roteiro segue o ritmo do modelo com o conteúdo novo; a IA não copia.">
            <select value={modeloDeRoteiro} onChange={(e) => setModeloDeRoteiro(e.target.value)} className={campo} disabled={!modelosDeRoteiro.length}>
              <option value="">{modelosDeRoteiro.length ? "Sem modelo" : "Nenhum modelo ainda"}</option>
              {modelosDeRoteiro.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.escopo === "agencia" ? "Agência: " : ""}
                  {m.nome}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
          {!tarefaId && (
            <CampoDeFormulario rotulo="Tema do vídeo" obrigatorio largo apoio={semTema ? "Escreva o tema para o roteiro avulso." : undefined}>
              <input value={tema} onChange={(e) => setTema(e.target.value)} maxLength={300} placeholder="Ex.: como funciona o período de graça do INSS" className={campo} />
            </CampoDeFormulario>
          )}
          <CampoDeFormulario rotulo="Pedido da equipe" ajuda="Opcional. Como gravar, o que evitar, o que destacar." largo>
            <textarea
              value={pedido}
              onChange={(e) => setPedido(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="Ex.: a advogada grava sentada; falar de documentos sem prometer resultado"
              className={juntar(campoTexto, "min-h-[64px]")}
            />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Modelo de IA">
            <select value={idDoModeloIa} onChange={(e) => setModeloIa(e.target.value)} className={campo} aria-label="Modelo de IA">
              {textos.map((m) => (
                <option key={m.id} value={m.id}>
                  {nomeDoModelo(m)}
                  {padrao && padrao.id === m.id ? " (padrão)" : ""}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
        </GrupoDeCampos>
      </div>
    </Painel>
  );
}

// ------------------------------------------------------------------ roteiro sem banco

function RoteiroSolto({ roteiro, onDescartar }: { roteiro: Roteiro; onDescartar: () => void }) {
  const mesa = useMesa();
  return (
    <div className="min-w-0 space-y-4">
      <AvisoDoBanco />
      <Painel
        as="section"
        titulo={roteiro.titulo}
        descricao={`${roteiro.blocos.length} blocos · não fica salvo`}
        rodape={
          <>
            <button type="button" className={botao.discreto} onClick={onDescartar}>
              Fechar
            </button>
            <button
              type="button"
              className={botao.primario}
              onClick={() => {
                const p = montarPdf(mesa.clientName || "Cliente", [itemSolto(roteiro)]);
                baixarBytes(p.bytes, p.nome);
              }}
            >
              <Download className="mr-1 h-3.5 w-3.5" /> Baixar PDF
            </button>
          </>
        }
      >
        <ol className="divide-y divide-border">
          {roteiro.blocos.map((b) => (
            <li key={b.id} className="py-2 text-[13px] leading-relaxed [overflow-wrap:anywhere]">
              <span className="mr-1 font-semibold">{b.funcao}:</span>
              {b.fala}
            </li>
          ))}
        </ol>
      </Painel>
    </div>
  );
}

// ------------------------------------------------------------------ editor

const linhas = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
const ehRoteiro = (v: unknown) => !!v && typeof v === "object" && Array.isArray((v as Roteiro).blocos) && Array.isArray((v as Roteiro).ganchos) && !!(v as Roteiro).direcao;

function EditorDoRoteiro({ linha, onIrPara }: { linha: LinhaDoRoteiro; onIrPara: (etapa: IrPara, roteiroId?: string | null) => void }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const versao = versaoPorNumero(linha.versoes, linha.versao_atual);
  const original = versao ? versao.conteudo : normalizarRoteiro({}, { titulo: linha.titulo, tipo: linha.tipo });
  // Rascunho por roteiro e versão: sair e voltar (ou trocar de etapa) não perde a edição.
  const [rascunho, setRascunho] = useEstadoDaTela<Roteiro>(`mesa-roteiros:editor:${linha.id}:${linha.versao_atual}`, original, { validar: ehRoteiro, esperaMs: 400 });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<unknown>(null);
  const [pedidoGancho, setPedidoGancho] = useEstadoDaTela<string>(`mesa-roteiros:editor:gancho:${linha.id}`, "");
  const [tom, setTom] = useEstadoDaTela<string>(`mesa-roteiros:editor:tom:${linha.id}`, "");
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
  const desabilitado = travado;
  return (
    <div className="min-w-0 space-y-6" data-editor-do-roteiro={linha.id}>
      <section className="min-w-0 space-y-3">
        <div className="flex min-w-0 items-start">
          <div className="mr-3 min-w-0 flex-1">
            <input
              value={rascunho.titulo}
              onChange={(e) => mudar({ titulo: e.target.value })}
              disabled={desabilitado}
              aria-label="Título do roteiro"
              className={juntar("w-full min-w-0 rounded-sm bg-transparent text-[18px] font-semibold leading-7 outline-none", foco)}
            />
            <input
              value={rascunho.subtitulo}
              onChange={(e) => mudar({ subtitulo: e.target.value })}
              disabled={desabilitado}
              placeholder="Pergunta ou ideia central"
              aria-label="Subtítulo"
              className={juntar("w-full min-w-0 rounded-sm bg-transparent text-[13px] text-muted-foreground outline-none", foco)}
            />
          </div>
          <div className="mt-1 flex shrink-0 items-center">
            <SeloDoStatus status={linha.status} />
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-between" data-barra-do-editor="">
          <p className={juntar(texto.auxiliar, "mb-1 mr-3 min-w-0 flex-1 truncate")} data-duracao="">
            v{linha.versao_atual}
            {linha.versao_aprovada ? ` (aprovada ${linha.versao_aprovada})` : ""} · {modoDoTipo(rascunho.tipo).rotulo} · {duracao.min_s} a {duracao.max_s}s pela fala ({duracao.palavras} palavras) · alvo {rascunho.duracao_alvo_s}s
          </p>
          <div className="-m-1 flex min-w-0 flex-wrap items-center justify-end [&>*]:m-1">
            {alterado && !travado && versao && (
              <button type="button" className={botao.discreto} onClick={() => setRascunho(versao.conteudo)}>
                Descartar mudanças
              </button>
            )}
            <button type="button" className={botao.secundario} onClick={() => onIrPara("revisao", linha.id)} aria-label="Revisão e aprovação">
              <ClipboardCheck className="h-3.5 w-3.5" />
              <RotuloLargo>Revisão e aprovação</RotuloLargo>
            </button>
            <button type="button" className={botao.secundario} onClick={() => onIrPara("pdf", linha.id)} aria-label="PDF">
              <FileText className="h-3.5 w-3.5" />
              <RotuloLargo>PDF</RotuloLargo>
            </button>
            <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={travado || !alterado || salvando}>
              {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}Salvar versão
            </button>
          </div>
        </div>
        {bloqueio && <p className={juntar(superficie.poco, "px-3 py-2 text-[12.5px]")}>{bloqueio}</p>}
        {!bloqueio && linha.status === "aprovado" && <p className={texto.auxiliar}>Salvar cria a versão {linha.versao_atual + 1} em rascunho. A aprovada continua guardada.</p>}
        {erro ? <AvisoDeErro erro={erro} /> : null}
        {faltas.length > 0 && <p className={juntar(texto.auxiliar, "leading-5 [overflow-wrap:anywhere]")}>Falta: {faltas.join(" ")}</p>}
        <AvisoDoJevCartao aviso={versao ? versao.aviso : null} />
      </section>

      <BlocoRecolhivel
        chave={`mesa-roteiros:ganchos:${mesa.clientId}`}
        titulo="Gancho"
        ajuda="Três aberturas de mecanismos diferentes. A escolhida vira a fala do bloco 1; as outras vão para o PDF como aberturas para testar."
        resumo={rascunho.ganchos.length ? `${rascunho.ganchos.length} ganchos · usando o ${rascunho.gancho_escolhido + 1}` : undefined}
        data-ganchos=""
      >
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-3" role="radiogroup" aria-label="Ganchos">
          {rascunho.ganchos.map((g, i) => (
            <div key={i} className={juntar("min-w-0 rounded-md border p-2.5", rascunho.gancho_escolhido === i ? "border-primary bg-primary/5" : "border-border")}>
              <label className="flex items-start text-[13px]">
                <input
                  type="radio"
                  name={`gancho-${linha.id}`}
                  className="mr-2 mt-1"
                  checked={rascunho.gancho_escolhido === i}
                  disabled={desabilitado}
                  onChange={() => setRascunho((r) => escolherGancho(r, i))}
                  aria-label={`Usar o gancho ${i + 1}`}
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">{g.texto}</span>
              </label>
              <p className="mt-1 text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">{[g.mecanismo, g.promessa ? `promete: ${g.promessa}` : ""].filter(Boolean).join(" · ")}</p>
            </div>
          ))}
        </div>
        {!travado && (
          <div className="flex min-w-0 items-center">
            <input
              value={pedidoGancho}
              onChange={(e) => setPedidoGancho(e.target.value)}
              maxLength={300}
              placeholder="Pedido para o gancho (opcional). Ex.: mais direto"
              className={juntar(campo, "mr-2 min-w-0 flex-1")}
              aria-label="Pedido para refazer o gancho"
            />
            <BotaoComCusto
              rotulo="Refazer gancho"
              titulo="Gancho refeito"
              variant="outline"
              className="h-9 shrink-0"
              disabled={alterado || !modeloIa}
              descricao={alterado ? "Salve as mudanças antes." : "Três ganchos novos; cria uma versão nova."}
              partes={() => [{ modeloId: modeloIa, tipo: "texto", tokensEntrada: 6_000, tokensSaida: 2_500 }]}
              executar={() => chamarRoteiros("gancho_refazer", { roteiro_id: linha.id, pedido: pedidoGancho.trim() || undefined })}
              aoConcluir={(d) => {
                setPedidoGancho("");
                depoisDaIa(d);
              }}
            />
          </div>
        )}
      </BlocoRecolhivel>

      <section className="min-w-0 space-y-3 border-t border-border pt-5" data-blocos="">
        <Cabecalho
          nivel={3}
          titulo="Falas por bloco"
          estado={`${rascunho.blocos.length} blocos`}
          acoes={
            !travado ? (
              <button type="button" className={botao.discreto} onClick={novoBloco} aria-label="Novo bloco">
                <Plus className="mr-1 h-3.5 w-3.5" />
                Bloco
              </button>
            ) : null
          }
        />
        <ol className="divide-y divide-border">
          {rascunho.blocos.map((b, i) => (
            <li key={b.id} className={juntar("min-w-0 py-3", i === 0 && "border-l-2 border-primary pl-3")} data-bloco={b.id}>
              <div className="flex min-w-0 items-center">
                <span className="mr-2 shrink-0 text-[13px] font-bold tabular-nums text-primary">{String(i + 1).padStart(2, "0")}</span>
                <div className="mr-2 min-w-0 flex-1 sm:max-w-[200px]">
                  <input value={b.funcao} onChange={(e) => mudarBloco(i, { funcao: e.target.value })} disabled={desabilitado} aria-label={`Função do bloco ${i + 1}`} className={juntar(campo, "font-semibold uppercase")} />
                </div>
                <div className="mr-auto flex shrink-0 items-center text-[12px] text-muted-foreground">
                  <div className="mr-1 w-16">
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={b.segundos}
                      onChange={(e) => mudarBloco(i, { segundos: Math.max(1, Math.min(180, Number(e.target.value) || 1)) })}
                      disabled={desabilitado}
                      aria-label={`Segundos do bloco ${i + 1}`}
                      className={campo}
                    />
                  </div>
                  s
                </div>
                {!travado && (
                  <span className="ml-1 flex shrink-0 items-center">
                    <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => moverBloco(i, -1)} aria-label={`Subir o bloco ${i + 1}`}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => moverBloco(i, 1)} aria-label={`Descer o bloco ${i + 1}`}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className={juntar(botao.icone, "h-7 w-7 hover:text-destructive")} onClick={() => tirarBloco(i)} aria-label={`Tirar o bloco ${i + 1}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
              <div className="mt-2 grid min-w-0 grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-3">
                <CampoDeFormulario rotulo="Fala" largo className="md:col-span-3">
                  <textarea value={b.fala} onChange={(e) => mudarBloco(i, { fala: e.target.value })} disabled={desabilitado} rows={3} aria-label={`Fala do bloco ${i + 1}`} className={juntar(campoTexto, "leading-relaxed")} />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="O que a câmera mostra">
                  <input value={b.visual} onChange={(e) => mudarBloco(i, { visual: e.target.value })} disabled={desabilitado} aria-label={`Imagem do bloco ${i + 1}`} className={campo} />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Texto na tela">
                  <input value={b.texto_na_tela} onChange={(e) => mudarBloco(i, { texto_na_tela: e.target.value })} disabled={desabilitado} aria-label={`Texto na tela do bloco ${i + 1}`} className={campo} />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Imagem de apoio (B-roll)">
                  <input value={b.broll} onChange={(e) => mudarBloco(i, { broll: e.target.value })} disabled={desabilitado} aria-label={`Apoio do bloco ${i + 1}`} className={campo} />
                </CampoDeFormulario>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <BlocoRecolhivel chave={`mesa-roteiros:direcao:${mesa.clientId}`} titulo="Direção de gravação" data-direcao="">
        <GrupoDeCampos colunas={3}>
          {(
            [
              ["enquadramento", "Enquadramento"],
              ["ambiente", "Ambiente"],
              ["figurino", "Figurino"],
              ["objetos", "Objetos em cena"],
              ["luz", "Luz"],
              ["camera", "Câmera"],
            ] as const
          ).map(([nome, rotulo]) => (
            <CampoDeFormulario key={nome} rotulo={rotulo}>
              <input value={rascunho.direcao[nome]} onChange={(e) => mudarDirecao({ [nome]: e.target.value } as Partial<Roteiro["direcao"]>)} disabled={desabilitado} className={campo} />
            </CampoDeFormulario>
          ))}
          <CampoDeFormulario rotulo="Orientações de atuação e captação" apoio="Uma por linha." largo>
            <textarea value={rascunho.direcao.orientacoes.join("\n")} onChange={(e) => mudarDirecao({ orientacoes: linhas(e.target.value) })} disabled={desabilitado} rows={3} className={campoTexto} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Imagens de apoio gerais" apoio="Uma por linha." largo>
            <textarea value={rascunho.broll.join("\n")} onChange={(e) => mudar({ broll: linhas(e.target.value) })} disabled={desabilitado} rows={2} className={juntar(campoTexto, "min-h-[64px]")} />
          </CampoDeFormulario>
          {rascunho.tipo === "cinema" && (
            <CampoDeFormulario rotulo="Premissa (logline)" largo>
              <input value={rascunho.logline} onChange={(e) => mudar({ logline: e.target.value })} disabled={desabilitado} className={campo} />
            </CampoDeFormulario>
          )}
        </GrupoDeCampos>
      </BlocoRecolhivel>

      <BlocoRecolhivel chave={`mesa-roteiros:publicacao:${mesa.clientId}`} titulo="CTA e legenda do post" resumo={rascunho.cta ? rascunho.cta : undefined} data-publicacao="">
        <GrupoDeCampos>
          <CampoDeFormulario rotulo="CTA">
            <input value={rascunho.cta} onChange={(e) => mudar({ cta: e.target.value })} disabled={desabilitado} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Hashtags" apoio="Separadas por espaço.">
            <input value={rascunho.hashtags.join(" ")} onChange={(e) => mudar({ hashtags: e.target.value.split(/\s+/).filter(Boolean) })} disabled={desabilitado} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Legenda" largo>
            <textarea value={rascunho.legenda} onChange={(e) => mudar({ legenda: e.target.value })} disabled={desabilitado} rows={4} className={campoTexto} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Pendências antes de gravar" apoio="Uma por linha." largo>
            <textarea value={rascunho.pendencias.join("\n")} onChange={(e) => mudar({ pendencias: linhas(e.target.value) })} disabled={desabilitado} rows={2} className={juntar(campoTexto, "min-h-[64px]")} />
          </CampoDeFormulario>
        </GrupoDeCampos>
        {rascunho.fontes.length > 0 && <p className={juntar(texto.auxiliar, "leading-5 [overflow-wrap:anywhere]")}>Fontes: {rascunho.fontes.join("; ")}</p>}
      </BlocoRecolhivel>

      {!travado && (
        <BlocoRecolhivel
          chave={`mesa-roteiros:refazer:${mesa.clientId}`}
          titulo="Pedir ao roteirista"
          ajuda="Cada pedido gera uma versão nova. A atual fica no histórico da Revisão. Gerar de novo usa os comentários abertos da Revisão."
          estado={alterado ? "Salve as mudanças antes." : undefined}
          data-refazer=""
          acoes={
            <BotaoComCusto
              rotulo={
                <>
                  <Wand2 className="mr-1 h-3.5 w-3.5" />
                  Gerar de novo
                </>
              }
              titulo="Roteiro gerado de novo"
              variant="outline"
              className="h-9"
              disabled={alterado || !modeloIa}
              descricao="Escreve o roteiro de novo, com os comentários abertos da Revisão."
              partes={() => [{ modeloId: modeloIa, tipo: "texto", tokensEntrada: TAMANHO_DA_GERACAO.entrada, tokensSaida: TAMANHO_DA_GERACAO.saida }]}
              executar={() => chamarRoteiros("gerar", { client_id: mesa.clientId, roteiro_id: linha.id, tipo: linha.tipo, duracao_s: rascunho.duracao_alvo_s, objetivo: rascunho.objetivo || undefined })}
              aoConcluir={depoisDaIa}
            />
          }
        >
          <div className="flex min-w-0 items-center">
            <input value={tom} onChange={(e) => setTom(e.target.value)} maxLength={160} placeholder="Tom novo. Ex.: mais leve e próximo" className={juntar(campo, "mr-2 min-w-0 flex-1")} aria-label="Tom novo" />
            <BotaoComCusto
              rotulo="Mudar o tom"
              titulo="Tom mudado"
              variant="outline"
              className="h-9 shrink-0"
              disabled={alterado || tom.trim().length < 3 || !modeloIa}
              partes={() => [{ modeloId: modeloIa, tipo: "texto", tokensEntrada: TAMANHO_DA_GERACAO.entrada, tokensSaida: TAMANHO_DA_GERACAO.saida }]}
              executar={() => chamarRoteiros("tom_mudar", { roteiro_id: linha.id, tom: tom.trim() })}
              aoConcluir={(d) => {
                setTom("");
                depoisDaIa(d);
              }}
            />
          </div>
        </BlocoRecolhivel>
      )}
    </div>
  );
}
