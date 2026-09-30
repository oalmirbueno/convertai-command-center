import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Circle, CircleSlash, Loader2, Play, RotateCcw, Sparkles, Square, TriangleAlert, Wand2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useKitDaMarca } from "@/components/mesa/kitDaMesa";
import Secao from "@/components/sistema/Secao";
import { botao, campo, juntar, lista, rolagem, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { estimarLocal, modeloDoPapel, modelosAtivos, nomeDoModelo, textoDoErro, usd, type ModeloIa } from "@/lib/mesa/api";
import { TEMAS_DO_BRANDBOOK } from "../../../supabase/functions/mesa-identidade/modulos/brandbook";
import { ROTULO_DA_VERSAO, TIPOS_DE_LOGO, type VersaoDaLogo } from "../../../supabase/functions/mesa-identidade/modulos/leitura-da-logo";
import { linkDaFamilia } from "../../../supabase/functions/_shared/tipografia-da-marca";
import { etapasDoProjeto, faltaNaEtapa, rotuloDaEtapa, type EtapaDaIdentidade } from "../../../supabase/functions/_shared/identidade-etapas";
import {
  checklistDaMarca,
  type CustoDoPasso,
  type ExecucaoDoCompletar,
  normalizarExecucao,
  novaExecucao,
  type OpcoesDoCompletar,
  PASSOS_DO_COMPLETAR,
  type PassoId,
  planoDeCompletar,
  resumoDoChecklist,
  rotuloDoPasso,
  totalDoPlano,
} from "../../../supabase/functions/mesa-identidade/modulos/completar-marca";
import { chamarIdentidade, CHAVES, useBrandbooks, useSituacaoDoArquivo, type ProjetoDeIdentidade } from "./identidadeApi";
import { Pastilha, SeletorDoModelo, useModeloDaAcao, useProjetoDaMesa } from "./Comuns";
import { desfazerPasso, relerProjeto, Rodada, rodarExecucao } from "./rodadaDoCompletar";
import { SeletorDoMotion } from "./VideoDaMarca";
import ResultadoDaMarca from "./ResultadoDaMarca";

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Modelos que enxergam imagem (quando o catálogo diz; sem a informação, todos os de texto). */
function modelosDeVisao(catalogo: ModeloIa[]): ModeloIa[] {
  const ativos = modelosAtivos(catalogo, "texto");
  const comImagem = ativos.filter((m) => {
    const mod = (m as unknown as { modalidades?: { entrada?: string[] } | null }).modalidades;
    return !!(mod && Array.isArray(mod.entrada) && mod.entrada.indexOf("image") >= 0);
  });
  return comImagem.length ? comImagem : ativos;
}

/** O modelo da leitura por visão igual ao da função: o escolhido; senão o padrão de leitura; senão o do papel identidade. */
export function modeloDaVisaoNaTela(catalogo: ModeloIa[], escolhido?: string | null): ModeloIa | null {
  const ativos = modelosAtivos(catalogo, "texto");
  if (escolhido) {
    const m = ativos.filter((x) => x.id === escolhido)[0];
    if (m) return m;
  }
  return ativos.filter((m) => (m.padrao_para || []).indexOf("leitura") >= 0)[0] || modeloDoPapel(catalogo, "identidade");
}

function SeletorDaVisao({ valor, onEscolher }: { valor: string; onEscolher: (id: string) => void }) {
  const { catalogo } = useMesa();
  const padrao = modeloDaVisaoNaTela(catalogo, null);
  const lista2 = modelosDeVisao(catalogo);
  return (
    <select className={juntar(campo, "m-1 h-8 w-auto max-w-[240px] text-[12px]")} value={lista2.some((m) => m.id === valor) ? valor : ""} onChange={(e) => onEscolher(e.target.value)} aria-label="Modelo que lê a logo" data-seletor-de-modelo="visao">
      <option value="">{padrao ? `Padrão: ${nomeDoModelo(padrao)}` : "Padrão de leitura"}</option>
      {lista2.map((m) => (
        <option key={m.id} value={m.id}>
          {nomeDoModelo(m)}
        </option>
      ))}
    </select>
  );
}

const ICONE_DO_ESTADO: Record<string, JSX.Element> = {
  pendente: <Circle className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" />,
  parado: <Square className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" />,
  rodando: <Loader2 className="mr-3 h-4 w-4 shrink-0 animate-spin text-primary" />,
  feito: <CheckCircle2 className="mr-3 h-4 w-4 shrink-0 text-primary" />,
  pulado: <CircleSlash className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" />,
  falhou: <TriangleAlert className="mr-3 h-4 w-4 shrink-0 text-destructive" />,
};

/**
 * Checklist de completude da marca (etapa Início) e o "Completar tudo"
 * (IDV3). O plano abre numa janela central com o custo total antes e
 * Confirmar; roda em passos com andamento e Parar; no fim, as perguntas em
 * aberto, o Desfazer de cada passo e o resultado (pacote, aprovação, kit).
 */
export default function CompletarMarca({ abrirJa = false, onAberto }: { abrirJa?: boolean; onAberto?: () => void }) {
  const { projeto } = useProjetoDaMesa();
  const versoes = useBrandbooks(projeto.id);
  const guideline = obj(projeto.dados.guideline);
  const bb = (versoes.data || []).filter((v) => v.id === guideline.brandbook_id)[0] || (versoes.data || [])[0] || null;
  const situacao = useSituacaoDoArquivo(bb ? bb.arquivo_pdf_id : null);
  const comNaming = projeto.modo === "zero" || projeto.com_naming;
  const semCaminhos = projeto.modo === "completar";
  const itens = useMemo(
    () => checklistDaMarca(projeto.dados, { brandbook: bb ? { versao: bb.versao, enviado: !!bb.arquivo_pdf_id, aprovado: !!(situacao.data && situacao.data.approval_status === "approved") } : null }, { comNaming, semCaminhos }),
    [projeto.versao, bb ? bb.id : "", situacao.data ? situacao.data.approval_status : "", comNaming, semCaminhos],
  );
  const resumo = resumoDoChecklist(itens);
  const [janela, setJanela] = useState<{ passos: PassoId[] | null } | null>(null);
  const execucao = normalizarExecucao(obj(projeto.dados.completar).execucao);
  const pendentes = execucao && !execucao.terminada_em ? execucao.passos.filter((p) => p.estado === "pendente" || p.estado === "parado").map((p) => p.id) : [];
  const perguntas = arr(obj(projeto.dados.completar).perguntas).map(obj).filter((p) => p.texto);

  useEffect(() => {
    if (abrirJa) {
      setJanela({ passos: pendentes.length ? pendentes : null });
      if (onAberto) onAberto();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirJa]);

  return (
    <>
      <Secao
        titulo="Completude da marca"
        descricao={`${resumo.feitos} de ${resumo.total}`}
        recolher={false}
        ajuda="O que a marca já tem e o que falta para ficar completa e profissional. Completar tudo mostra o plano com o custo antes; cada passo só preenche o que está vazio, usa o que o painel já sabe (contexto, dossiê, briefing, arquivos e, se pedir, a web) e fica editável depois. O que não tem base vira pergunta. A logo nunca é redesenhada."
        acao={
          <>
            {pendentes.length > 0 && (
              <button type="button" className={juntar(botao.discreto, "m-1 h-8")} onClick={() => setJanela({ passos: pendentes })} data-retomar-completar="">
                <Play className="mr-1.5 h-3.5 w-3.5" /> Retomar ({pendentes.length})
              </button>
            )}
            <button type="button" className={juntar(botao.primario, "m-1 h-8")} onClick={() => setJanela({ passos: null })} data-completar-tudo="">
              <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Completar tudo
            </button>
          </>
        }
      >
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Checklist da marca" data-checklist-da-marca="">
          {itens.map((i) => (
            <li key={i.id} className={lista.linha} data-item-do-checklist={i.id} data-tem={i.tem ? "sim" : "nao"}>
              {i.tem ? <CheckCircle2 className="mr-3 h-4 w-4 shrink-0 text-primary" /> : <Circle className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate")}>{i.rotulo}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>{i.detalhe}</span>
              </span>
              {!i.tem && i.passo && (
                <button type="button" className={juntar(botao.discreto, "ml-2 h-8 shrink-0")} onClick={() => setJanela({ passos: [i.passo as PassoId] })} data-completar-item={i.passo}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Completar
                </button>
              )}
            </li>
          ))}
        </ul>
      </Secao>

      <LeituraDaLogo />

      {perguntas.length > 0 && (
        <Secao titulo="Perguntas em aberto" descricao={`${perguntas.length}`} divisoria recolher={`mesa-identidade:${projeto.id}:perguntas`} ajuda="O que não tinha base nas fontes. Responda com o cliente e preencha na etapa; nada foi inventado.">
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Perguntas em aberto">
            {perguntas.map((p, k) => (
              <li key={k} className={lista.linha}>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block")}>{String(p.texto)}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>{rotuloDoPasso(p.passo as PassoId)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {janela && <JanelaDoCompletar passosIniciais={janela.passos} onFechar={() => setJanela(null)} />}
    </>
  );
}

const ROTULO_DO_FUNDO: Record<string, string> = { transparente: "Fundo transparente", claro: "Fundo claro", escuro: "Fundo escuro", cor: "Fundo de cor", misto: "Fundo com foto ou degradê" };
const ROTULO_DA_ORIENTACAO: Record<string, string> = { horizontal: "Horizontal", vertical: "Vertical", quadrada: "Compacta" };

/**
 * O que a leitura da logo achou (IDV3): as cores por código (com quanto cada
 * uma aparece), o fundo, a orientação, o símbolo, a forma e o estilo por
 * visão, a fonte parecida (sugestão com o link do Google Fonts) e as versões
 * que precisam de designer. Tudo editável nas etapas; a logo não muda.
 */
function LeituraDaLogo() {
  const { projeto } = useProjetoDaMesa();
  const l = obj(projeto.dados.leitura_da_logo);
  const a = obj(l.analise);
  const v = obj(l.visao);
  const cores = arr(l.cores).map(obj).filter((c) => c.hex);
  const designer = arr(obj(l.versoes).designer).map(obj);
  const geradas = arr(obj(l.versoes).geradas).map(String);
  if (!cores.length && !v.em) return null;
  const tipo = TIPOS_DE_LOGO.filter((t) => t.valor === v.tipo_de_logo)[0];
  const parecidas = arr(obj(v.fonte).parecidas).map(obj);
  const linhas: Array<{ rotulo: string; valor: string }> = [];
  if (a.fundo) linhas.push({ rotulo: "Arquivo", valor: [ROTULO_DO_FUNDO[String(a.fundo)], ROTULO_DA_ORIENTACAO[String(a.orientacao)], obj(a.simbolo).separavel ? "símbolo separável" : "símbolo junto do nome"].filter(Boolean).join(" · ") });
  if (tipo) linhas.push({ rotulo: "Tipo", valor: tipo.rotulo });
  if (v.forma) linhas.push({ rotulo: "Forma", valor: String(v.forma) });
  if (v.estilo) linhas.push({ rotulo: "Estilo", valor: String(v.estilo) });
  if (obj(v.fonte).descricao) linhas.push({ rotulo: "Letra", valor: String(obj(v.fonte).descricao) });
  if (geradas.length) linhas.push({ rotulo: "Versões por código", valor: geradas.map((x) => ROTULO_DA_VERSAO[x as VersaoDaLogo] || x).join(", ") });
  if (designer.length) linhas.push({ rotulo: "Precisa de designer", valor: designer.map((d) => ROTULO_DA_VERSAO[d.versao as VersaoDaLogo] || String(d.versao)).join(", ") });
  return (
    <Secao titulo="Leitura da logo" descricao={cores.length ? `${cores.length} cores` : undefined} divisoria recolher={`mesa-identidade:${projeto.id}:leitura`} ajuda="Cores lidas nos pixels (sem o fundo), com quanto cada uma aparece. Forma, estilo e letra lidos por visão pelo modelo escolhido: é descrição, nunca redesenho. A fonte parecida é sugestão de família equivalente do Google Fonts, não a fonte original; confirme com o cliente.">
      {cores.length > 0 && (
        <div className="-m-1 mb-2 flex min-w-0 flex-wrap" data-cores-da-logo="">
          {cores.map((c) => (
            <span key={String(c.hex)} className={juntar(texto.auxiliar, "m-1 inline-flex items-center tabular-nums")}>
              <span className="mr-1.5 inline-block h-5 w-5 rounded border border-border" style={{ background: String(c.hex) }} />
              {String(c.hex)} · {Math.round((Number(c.parte) || 0) * 100)}%
            </span>
          ))}
        </div>
      )}
      <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Leitura da logo">
        {linhas.map((x) => (
          <li key={x.rotulo} className={lista.linha}>
            <span className={juntar(texto.rotulo, "w-36 shrink-0")}>{x.rotulo}</span>
            <span className={juntar(texto.corpo, "min-w-0 flex-1")}>{x.valor}</span>
          </li>
        ))}
        {parecidas.length > 0 && (
          <li className={lista.linha}>
            <span className={juntar(texto.rotulo, "w-36 shrink-0")}>Fonte parecida</span>
            <span className="min-w-0 flex-1">
              {parecidas.map((p) => (
                <a key={String(p.familia)} className={juntar(texto.corpo, "mr-3 text-primary underline-offset-2 hover:underline")} href={linkDaFamilia(String(p.familia))} target="_blank" rel="noopener noreferrer">
                  {String(p.familia)}
                  {p.conferida ? "" : " (conferir)"}
                </a>
              ))}
              <Pastilha tom="alerta">sugestão</Pastilha>
            </span>
          </li>
        )}
      </ul>
    </Secao>
  );
}

type Fase = "plano" | "rodando" | "fim";

/** A janela central do "Completar tudo": plano com custo e Confirmar, andamento com Parar e o resultado. */
function JanelaDoCompletar({ passosIniciais, onFechar }: { passosIniciais: PassoId[] | null; onFechar: () => void }) {
  const mesa = useMesa();
  const { projeto, guardar, irPara } = useProjetoDaMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const kit = useKitDaMarca(mesa.clientId, projeto.marca_id);
  const [modeloTexto, setModeloTexto] = useModeloDaAcao("identidade");
  const [modeloVisao, setModeloVisao] = useEstadoDaTela<string>("mesa-identidade:modelo:visao", "", { validar: (v) => typeof v === "string" });
  const [modeloMotion, setModeloMotion] = useEstadoDaTela<string>("mesa-identidade:modelo:motion", "", { validar: (v) => typeof v === "string" });
  const [opcoes, setOpcoes] = useState<OpcoesDoCompletar>({ usarWeb: false, refazer: false, modeloDoBrandbook: "paginado", tema: String(obj(projeto.dados.guideline).tema || "classico"), video: { apresentacao: true, filme: false } });
  const [escolhidos, setEscolhidos] = useState<PassoId[]>(passosIniciais && passosIniciais.length ? passosIniciais : PASSOS_DO_COMPLETAR.map((p) => p.id));
  const [fase, setFase] = useState<Fase>("plano");
  const [execucao, setExecucao] = useState<ExecucaoDoCompletar | null>(null);
  const [parando, setParando] = useState(false);
  const [concluindo, setConcluindo] = useState(false);
  const pararRef = useRef(false);
  const rodadaRef = useRef<Rodada | null>(null);
  const temLogo = !!obj(obj(obj(projeto.dados.sistema).logos).principal).caminho;
  const plano = useMemo(
    () => planoDeCompletar(projeto.dados, { temLogo, modo: projeto.modo, comNaming: projeto.modo === "zero" || projeto.com_naming }, { ...opcoes, passos: escolhidos }),
    [projeto.versao, temLogo, JSON.stringify(opcoes), escolhidos.join(",")],
  );
  const precoDe = (c: CustoDoPasso): number | null => {
    const m = c.papel === "visao" ? modeloDaVisaoNaTela(mesa.catalogo, modeloVisao || null) : c.papel === "motion" ? modeloDoPapel(mesa.catalogo, "motion", modeloMotion || null) : modeloDoPapel(mesa.catalogo, "identidade", modeloTexto || null);
    return estimarLocal([{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: c.entrada, tokensSaida: c.saida, ...(c.buscas ? { buscasWeb: c.buscas } : {}) }], mesa.catalogo);
  };
  const total = totalDoPlano(plano, precoDe);
  const rodam = plano.filter((p) => p.roda);
  const usaVisao = rodam.some((p) => p.id === "leitura");
  const usaMotion = rodam.some((p) => p.id === "video") && !!(opcoes.video && opcoes.video.filme);
  const usaGuideline = rodam.some((p) => p.id === "guideline");
  const usaVideo = escolhidos.indexOf("video") >= 0;

  const nomeDaMarca = String((projeto.dados.naming && projeto.dados.naming.nome) || mesa.clientName || "Marca");
  const kitDaRodada = kit.kit ? { paleta: kit.kit.paleta as unknown as Array<Record<string, unknown>> | null, tipografia: (obj((kit.kit.contexto as unknown) || {}).tipografia as { titulo?: string; texto?: string } | undefined) || null } : null;

  const confirmar = async () => {
    const e = novaExecucao(typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `x${Date.now()}`, plano, opcoes, "mesa");
    if (!e.passos.length) {
      toast.info("Nada para rodar: o que foi escolhido já está feito.");
      return;
    }
    pararRef.current = false;
    setParando(false);
    setExecucao(e);
    setFase("rodando");
    const r = new Rodada(projeto, {
      clientId: mesa.clientId,
      marcaId: projeto.marca_id,
      nomeDaMarca,
      modelos: { texto: modeloTexto || null, visao: modeloVisao || null, motion: modeloMotion || null },
      opcoes,
      kit: kitDaRodada,
      guardar: (p: ProjetoDeIdentidade) => guardar(p),
    });
    rodadaRef.current = r;
    try {
      const fim = await rodarExecucao(r, e, { parar: () => pararRef.current, aoMudar: setExecucao, textoDoErro: (x) => textoDoErro(x) });
      setExecucao(fim);
      const falhas = fim.passos.filter((p) => p.estado === "falhou").length;
      if (falhas) toast.warning(`${falhas} ${falhas === 1 ? "passo falhou" : "passos falharam"}: veja o motivo na lista.`);
      else toast.success(fim.parada_em ? "Parado: o que rodou ficou salvo" : "Marca completada");
    } catch (x) {
      avisarErro(x, "A rodada parou com erro");
    } finally {
      setFase("fim");
      mesa.atualizarCusto();
      void qc.invalidateQueries({ queryKey: CHAVES.brandbooks(projeto.id) });
      void qc.invalidateQueries({ queryKey: CHAVES.projeto(projeto.id) });
    }
  };

  const desfazer = async (id: PassoId) => {
    if (!execucao) return;
    const passo = execucao.passos.filter((p) => p.id === id)[0];
    if (!passo || !passo.antes) return;
    try {
      const r = rodadaRef.current || new Rodada(await relerProjeto(projeto.id), { clientId: mesa.clientId, marcaId: projeto.marca_id, nomeDaMarca, modelos: {}, opcoes, kit: null, guardar: (p: ProjetoDeIdentidade) => guardar(p) });
      r.aceitar(await relerProjeto(projeto.id));
      await desfazerPasso(r, passo);
      const nova = { ...execucao, passos: execucao.passos.map((p) => (p.id === id ? { ...p, estado: "pulado" as const, resumo: `Desfeito. ${p.resumo}`.slice(0, 400), antes: null } : p)) };
      await r.salvar("completar", { execucao: nova });
      setExecucao(nova);
      toast.success(`${rotuloDoPasso(id)}: voltou como estava`);
    } catch (e) {
      avisarErro(e, "Não foi possível desfazer");
    }
  };

  /** Fecha, em ordem, as etapas que já têm o mínimo (para na primeira que falta; a Entrega fica com a equipe). */
  const concluirProntas = async () => {
    setConcluindo(true);
    let atual = await relerProjeto(projeto.id).catch(() => projeto);
    let fechadas = 0;
    try {
      for (const e of etapasDoProjeto(atual) as EtapaDaIdentidade[]) {
        if (e === "inicio" || e === "entrega" || atual.concluidas.indexOf(e) >= 0) continue;
        if (faltaNaEtapa(e, atual.dados).length) break;
        const r = await chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("etapa_concluir", { projeto_id: atual.id, etapa: e });
        atual = r.projeto;
        guardar(atual);
        fechadas += 1;
      }
      toast.success(fechadas ? `${fechadas} ${fechadas === 1 ? "etapa concluída" : "etapas concluídas"}` : "Nenhuma etapa pronta para fechar");
    } catch (e) {
      avisarErro(e, "Parou ao concluir as etapas");
    } finally {
      setConcluindo(false);
    }
  };

  const feitos = execucao ? execucao.passos.filter((p) => p.estado === "feito").length : 0;
  const n = execucao ? execucao.passos.length : 0;

  return (
    <Dialog open onOpenChange={(v) => !v && fase !== "rodando" && onFechar()}>
      <DialogContent className="max-w-2xl" data-janela-do-completar={fase}>
        <DialogHeader>
          <DialogTitle>{fase === "plano" ? "Completar a marca" : fase === "rodando" ? "Completando a marca" : "Marca completada"}</DialogTitle>
          <DialogDescription>
            {fase === "plano" ? "Só preenche o que está vazio. A logo nunca é redesenhada." : fase === "rodando" ? `${feitos} de ${n} passos. Parar vale depois do passo atual.` : execucao ? `${feitos} de ${n} passos feitos · ${usd(execucao.custo_usd)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {fase === "plano" && (
          <div className={juntar("min-w-0", rolagem.janela)}>
            <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Passos do plano" data-plano-do-completar="">
              {plano.map((p) => {
                const marcado = escolhidos.indexOf(p.id) >= 0;
                const custo = p.roda ? totalDoPlano([p], precoDe).total : 0;
                return (
                  <li key={p.id} className={lista.linha} data-passo-do-plano={p.id} data-roda={p.roda ? "sim" : "nao"}>
                    <input
                      type="checkbox"
                      className="mr-3 h-4 w-4 shrink-0 accent-primary"
                      checked={marcado}
                      aria-label={p.rotulo}
                      onChange={(e) => setEscolhidos(e.target.checked ? escolhidos.concat([p.id]) : escolhidos.filter((x) => x !== p.id))}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={juntar(texto.corpo, "block truncate")}>{p.rotulo}</span>
                      <span className={juntar(texto.auxiliar, "block truncate")}>{p.roda ? p.detalhe : p.motivo}</span>
                    </span>
                    {p.roda && <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>{p.custos.length ? usd(custo) : "sem custo"}</span>}
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex min-w-0 flex-wrap items-center">
              <span className={juntar(texto.rotulo, "m-1")}>Texto</span>
              <SeletorDoModelo papel="identidade" valor={modeloTexto} onEscolher={setModeloTexto} />
              {usaVisao && (
                <>
                  <span className={juntar(texto.rotulo, "m-1")}>Visão</span>
                  <SeletorDaVisao valor={modeloVisao} onEscolher={setModeloVisao} />
                </>
              )}
              {usaMotion && (
                <>
                  <span className={juntar(texto.rotulo, "m-1")}>Filme</span>
                  <SeletorDoMotion valor={modeloMotion} onEscolher={setModeloMotion} />
                </>
              )}
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center">
              {usaGuideline && (
                <>
                  <select className={juntar(campo, "m-1 h-8 w-auto text-[12px]")} value={opcoes.modeloDoBrandbook} aria-label="Modelo do brandbook" onChange={(e) => setOpcoes({ ...opcoes, modeloDoBrandbook: e.target.value === "prancha" ? "prancha" : "paginado" })}>
                    <option value="paginado">Brandbook de 24 páginas</option>
                    <option value="prancha">Prancha-resumo</option>
                  </select>
                  <select className={juntar(campo, "m-1 h-8 w-auto text-[12px]")} value={opcoes.tema} aria-label="Tema do brandbook" onChange={(e) => setOpcoes({ ...opcoes, tema: e.target.value })}>
                    {TEMAS_DO_BRANDBOOK.map((t) => (
                      <option key={t.valor} value={t.valor}>
                        Tema {t.rotulo}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {usaVideo && (
                <>
                  <label className={juntar(texto.corpo, "m-1 flex items-center")}>
                    <input type="checkbox" className="mr-1.5 h-4 w-4 accent-primary" checked={!!(opcoes.video && opcoes.video.apresentacao)} onChange={(e) => setOpcoes({ ...opcoes, video: { apresentacao: e.target.checked, filme: !!(opcoes.video && opcoes.video.filme) } })} />
                    Apresentação em vídeo
                  </label>
                  <label className={juntar(texto.corpo, "m-1 flex items-center")}>
                    <input type="checkbox" className="mr-1.5 h-4 w-4 accent-primary" checked={!!(opcoes.video && opcoes.video.filme)} onChange={(e) => setOpcoes({ ...opcoes, video: { apresentacao: !!(opcoes.video && opcoes.video.apresentacao), filme: e.target.checked } })} />
                    Filme cinematográfico
                  </label>
                </>
              )}
              <label className={juntar(texto.corpo, "m-1 flex items-center")}>
                <input type="checkbox" className="mr-1.5 h-4 w-4 accent-primary" checked={!!opcoes.usarWeb} onChange={(e) => setOpcoes({ ...opcoes, usarWeb: e.target.checked })} />
                Usar a web (site e Instagram)
              </label>
              <label className={juntar(texto.corpo, "m-1 flex items-center")}>
                <input type="checkbox" className="mr-1.5 h-4 w-4 accent-primary" checked={!!opcoes.refazer} onChange={(e) => setOpcoes({ ...opcoes, refazer: e.target.checked })} />
                Refazer o que já tem
              </label>
            </div>
            {!temLogo && <p className={juntar(texto.auxiliar, "mt-2 text-warning")}>Sem a logo principal no Sistema, só Briefing e Estratégia rodam.</p>}
          </div>
        )}

        {fase !== "plano" && execucao && (
          <div className={juntar("min-w-0", rolagem.janela)}>
            <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Andamento" data-andamento-do-completar="">
              {execucao.passos.map((p) => (
                <li key={p.id} className={lista.linha} data-passo-executado={p.id} data-estado={p.estado}>
                  {ICONE_DO_ESTADO[p.estado]}
                  <span className="min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate")}>{rotuloDoPasso(p.id)}</span>
                    <span className={juntar(texto.auxiliar, "block truncate", p.estado === "falhou" && "text-destructive")} title={p.resumo}>
                      {p.resumo || (p.estado === "pendente" ? "Na fila" : p.estado === "parado" ? "Parado" : "")}
                    </span>
                  </span>
                  {p.custo_usd > 0 && <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>{usd(p.custo_usd)}</span>}
                  {fase === "fim" && p.estado === "feito" && p.antes && (
                    <button type="button" className={juntar(botao.icone, "ml-1")} aria-label={`Desfazer ${rotuloDoPasso(p.id)}`} title="Desfazer" onClick={() => void desfazer(p.id)}>
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {fase === "fim" && (
              <div className="mt-3 min-w-0">
                <ResultadoDaMarca />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {fase === "plano" && (
            <>
              <button type="button" className={botao.discreto} onClick={onFechar}>
                Cancelar
              </button>
              <button type="button" className={botao.primario} disabled={!rodam.length} onClick={() => void confirmar()} data-confirmar-completar="">
                Confirmar{total.semPreco ? " (preço a conferir)" : total.total > 0 ? ` (${usd(total.total)})` : " (sem custo de IA)"}
              </button>
            </>
          )}
          {fase === "rodando" && (
            <button
              type="button"
              className={botao.secundario}
              disabled={parando}
              onClick={() => {
                pararRef.current = true;
                setParando(true);
              }}
              data-parar-completar=""
            >
              <Square className="mr-1.5 h-4 w-4" /> {parando ? "Parando depois deste passo" : "Parar"}
            </button>
          )}
          {fase === "fim" && (
            <>
              <button type="button" className={botao.discreto} disabled={concluindo} onClick={() => void concluirProntas()} data-concluir-prontas="">
                {concluindo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />} Concluir as etapas prontas
              </button>
              <button type="button" className={botao.discreto} onClick={() => { onFechar(); irPara(projeto.modo === "completar" ? "sistema" : "guideline"); }}>
                Revisar {rotuloDaEtapa(projeto.modo === "completar" ? "sistema" : "guideline")}
              </button>
              <button type="button" className={botao.primario} onClick={onFechar}>
                Fechar
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
