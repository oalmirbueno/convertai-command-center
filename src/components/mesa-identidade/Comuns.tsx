import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import { useMesa, useUrlDaMesa } from "@/components/mesa/MesaContexto";
import { botao, campo, etiqueta, foco, juntar, texto, toqueCompacto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { modeloDoPapel, modelosAtivos, nomeDoModelo, precoDoModelo, textoDoErro, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";
import { destinoDoQueFalta, etapaFeita, etapasDoProjeto, faltaComDestino, podeAbrir, rotuloDaEtapa, TAMANHOS_DA_IDENTIDADE, type DestinoDoQueFalta, type EtapaDaIdentidade } from "../../../supabase/functions/_shared/identidade-etapas";
import type { ProjetoDeIdentidade } from "./identidadeApi";
import { useGravacoesDaMesa, useResumoDasGravacoes } from "./gravacao";

/** Peças repetidas nas etapas da Mesa Identidade. */

export interface ProjetoDaMesa {
  projeto: ProjetoDeIdentidade;
  /** Salvar parcial de uma parte dos dados (briefing, pesquisa, sistema...). Lança em erro (a tela avisa). */
  salvarParte: (parte: string, valor: Record<string, unknown>, opcoes?: { substituir?: boolean }) => Promise<ProjetoDeIdentidade>;
  concluir: (etapa: EtapaDaIdentidade) => Promise<void>;
  reabrir: (etapa: EtapaDaIdentidade) => Promise<void>;
  irPara: (etapa: EtapaDaIdentidade) => void;
  /** Guarda a resposta da função (projeto novo) no cache. */
  guardar: (p: ProjetoDeIdentidade | null | undefined) => void;
}

const Contexto = createContext<ProjetoDaMesa | null>(null);

export function ProjetoProvider({ valor, children }: { valor: ProjetoDaMesa; children: ReactNode }) {
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useProjetoDaMesa(): ProjetoDaMesa {
  const v = useContext(Contexto);
  if (!v) throw new Error("useProjetoDaMesa fora da Mesa Identidade");
  return v;
}

export function useProjetoOpcional(): ProjetoDaMesa | null {
  return useContext(Contexto);
}

/**
 * Modelo que a função vai usar (papel identidade ou naming; sem ele, o do
 * estrategista), para o custo antes sair igual ao da função.
 */
export function modeloDoPapelNaTela(catalogo: ModeloIa[], papel: "identidade" | "naming"): ModeloIa | null {
  return modeloDoPapel(catalogo, papel);
}

export type AlvoDoCusto = "naming" | "conceito" | "pesquisa" | "conversa" | "estrategia" | "paletas" | "fontes" | "slogans" | "idiomas";

/** O papel que paga cada ação (naming, slogans e idiomas são do criador de nomes). */
export const papelDoAlvo = (alvo: AlvoDoCusto): "identidade" | "naming" => (alvo === "naming" || alvo === "slogans" || alvo === "idiomas" ? "naming" : "identidade");

export function partesDoCusto(catalogo: ModeloIa[], alvo: AlvoDoCusto, escolhidoId?: string | null, comWeb = false): ParteDaEstimativa[] {
  const m = modeloDoPapel(catalogo, papelDoAlvo(alvo), escolhidoId || null);
  const t = TAMANHOS_DA_IDENTIDADE[alvo];
  const buscas = alvo === "pesquisa" ? TAMANHOS_DA_IDENTIDADE.pesquisa.buscas : comWeb ? 3 : 0;
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: t.entrada, tokensSaida: t.saida, ...(buscas ? { buscasWeb: buscas } : {}) }];
}

/** As cópias abertas do modelo de cada papel (UXS 30/09): trocar numa troca em todas. */
const ouvintesDoModelo = new Set<(papel: string, id: string) => void>();

/**
 * O modelo escolhido na hora para as ações de IA da mesa (por papel, lembrado
 * no navegador). Vazio = o padrão do papel (modeloDoPapel). UXS 30/09: uma
 * escolha só por papel; o seletor do cabeçalho da etapa e os botões de IA
 * leem a mesma (antes cada cópia tinha estado próprio e valia a última).
 */
export function useModeloDaAcao(papel: "identidade" | "naming"): [string, (id: string) => void] {
  const { catalogo } = useMesa();
  const [id, setId] = useEstadoDaTela<string>(`mesa-identidade:modelo:${papel}`, "", { validar: (v) => typeof v === "string" });
  useEffect(() => {
    const ouvir = (p: string, v: string) => {
      if (p === papel) setId(v);
    };
    ouvintesDoModelo.add(ouvir);
    return () => {
      ouvintesDoModelo.delete(ouvir);
    };
  }, [papel, setId]);
  // O modelo lembrado que saiu do catálogo (desligado ou indisponível) volta ao padrão e nunca vai ao
  // servidor como modelo_id (QA 30/09: o seletor mostrava "Padrão" e a ação mandava o id velho, recusado).
  const valido = id && catalogo.length > 0 && !modelosAtivos(catalogo, "texto").some((m) => m.id === id) ? "" : id;
  return [
    valido,
    (v: string) => {
      setId(v);
      ouvintesDoModelo.forEach((o) => o(papel, v));
    },
  ];
}

/** Nome curto do modelo (sem o nome da empresa), para aparecer no botão de IA longe do seletor. */
export function nomeCurtoDoModelo(catalogo: ModeloIa[], papel: "identidade" | "naming", escolhidoId?: string | null): string {
  const m = modeloDoPapel(catalogo, papel, escolhidoId || null);
  if (!m) return "";
  const nome = nomeDoModelo(m).replace(/^(Claude|OpenAI|Anthropic|Google)\s+/i, "").trim();
  return nome.length > 18 ? `${nome.slice(0, 17)}...` : nome;
}

/** Rótulo do botão de IA com o nome curto do modelo ("Propor 3 paletas · Sonnet 4.5"). */
export function RotuloComModelo({ rotulo, papel, modeloId }: { rotulo: ReactNode; papel: "identidade" | "naming"; modeloId?: string | null }) {
  const { catalogo } = useMesa();
  const nome = nomeCurtoDoModelo(catalogo, papel, modeloId);
  return (
    <>
      {rotulo}
      {/* No celular o nome sai (o botão não pode passar da largura); o seletor fica no cabeçalho da etapa. */}
      {nome ? <span className="ml-1.5 hidden text-[11px] font-normal opacity-70 sm:inline">· {nome}</span> : null}
    </>
  );
}

/**
 * Seletor compacto do modelo da ação: o padrão do papel em primeiro, depois
 * todo modelo de texto ativo do catálogo (Anthropic, OpenAI e OpenRouter),
 * com o preço ao lado. O custo aparece no botão da ação.
 */
export function SeletorDoModelo({ papel, valor, onEscolher, className = "" }: { papel: "identidade" | "naming"; valor: string; onEscolher: (id: string) => void; className?: string }) {
  const { catalogo } = useMesa();
  const padrao = modeloDoPapel(catalogo, papel);
  const ativos = modelosAtivos(catalogo, "texto");
  const valido = valor && ativos.some((m) => m.id === valor) ? valor : "";
  return (
    <select
      className={juntar(campo, "m-1 h-8 w-auto max-w-[240px] text-[12px]", className)}
      value={valido}
      onChange={(e) => onEscolher(e.target.value)}
      aria-label="Modelo de IA desta ação"
      title="Modelo de IA desta ação"
      data-seletor-de-modelo={papel}
    >
      <option value="">{padrao ? `Padrão: ${nomeDoModelo(padrao)}` : "Padrão do papel"}</option>
      {ativos.map((m) => (
        <option key={m.id} value={m.id}>
          {nomeDoModelo(m)} · {precoDoModelo(m)}
        </option>
      ))}
    </select>
  );
}

export function partesDaImagem(catalogo: ModeloIa[]): ParteDaEstimativa[] {
  const ativos = catalogo.filter((m) => m.ativo && m.tipo === "imagem");
  const m = ativos.filter((x) => (x.padrao_para || []).indexOf("imagem") >= 0)[0] || ativos[0] || null;
  return [{ modeloId: m ? m.id : null, tipo: "imagem", imagens: 1, qualidade: "media" }];
}

/**
 * Leva ao que falta (UXS 30/09, IDV-03): na mesma etapa, rola até a seção
 * (`data-bloco-da-etapa`), abre se estiver recolhida e só então foca o campo
 * (`data-campo`, senão o primeiro campo, senão o primeiro botão). Em outra
 * etapa, abre a etapa e espera ela montar.
 */
export function irAoQueFalta(destino: DestinoDoQueFalta, etapaAberta: EtapaDaIdentidade, irPara: (e: EtapaDaIdentidade) => void) {
  const achar = (): HTMLElement | null => {
    if (!destino.bloco) return null;
    const principal = document.querySelector(`[data-bloco-da-etapa="${destino.bloco}"]`) as HTMLElement | null;
    if (principal) return principal;
    return destino.reserva ? (document.querySelector(`[data-bloco-da-etapa="${destino.reserva}"]`) as HTMLElement | null) : null;
  };
  const focar = (el: HTMLElement) => {
    try {
      el.scrollIntoView({ block: "start" });
    } catch {
      /* navegador antigo: sem a rolagem */
    }
    const depois = () => {
      // Procura no corpo da seção (o cabeçalho tem o botão de recolher e as ações).
      const corpos = (Array.prototype.slice.call(el.children) as HTMLElement[]).filter((c) => !c.hasAttribute("data-cabecalho-de-secao"));
      const buscar = (sel: string): HTMLElement | null => {
        const onde = corpos.length ? corpos : [el];
        for (const c of onde) {
          const achado = (c.matches && c.matches(sel) ? c : c.querySelector(sel)) as HTMLElement | null;
          if (achado) return achado;
        }
        return null;
      };
      const alvo =
        (destino.campo ? buscar(`[data-campo="${destino.campo}"]`) : null) ||
        buscar('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])') ||
        buscar("button:not([disabled])");
      if (alvo && typeof alvo.focus === "function") alvo.focus();
    };
    // A seção recolhida é o próprio bloco ou, quando o bloco embrulha uma seção (o vídeo da Entrega), a primeira de dentro.
    const primeira = el.firstElementChild as HTMLElement | null;
    const recolhida = el.getAttribute("data-recolhido") === "sim" ? el : primeira && primeira.getAttribute("data-recolhido") === "sim" ? primeira : null;
    if (recolhida) {
      const abrir = recolhida.querySelector("[data-titulo-recolhivel], [data-recolher-secao]") as HTMLElement | null;
      if (abrir) abrir.click();
      window.setTimeout(depois, 60);
    } else depois();
  };
  if (destino.etapa !== etapaAberta) {
    irPara(destino.etapa);
    if (!destino.bloco) return;
    let tentativas = 0;
    const esperar = () => {
      const el = achar();
      if (el) focar(el);
      else if ((tentativas += 1) < 40) window.setTimeout(esperar, 100);
    };
    window.setTimeout(esperar, 100);
    return;
  }
  const el = achar();
  if (el) focar(el);
}

/** "Falta 3" (ou o próprio texto, quando é um só): toca e abre a lista; cada item leva ao lugar. */
function FaltaDaEtapa({ etapa, itens, irPara }: { etapa: EtapaDaIdentidade; itens: Array<{ texto: string; destino: DestinoDoQueFalta | null }>; irPara: (e: EtapaDaIdentidade) => void }) {
  const [aberto, setAberto] = useState(false);
  /** Escolheu um item: o foco vai para o campo, não volta para o botão ao fechar. */
  const levando = useRef(false);
  const rotulo = itens.length === 1 ? `Falta: ${itens[0].texto}` : `Falta ${itens.length}`;
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={juntar(toqueCompacto, "inline-flex h-5 max-w-full items-center rounded px-1 align-middle text-[12px] font-medium text-warning underline decoration-dotted underline-offset-2 hover:bg-muted", foco)}
          aria-label={itens.length === 1 ? `${rotulo}. Ver onde completar` : `${rotulo} para concluir. Ver a lista`}
          data-falta-da-etapa={etapa}
        >
          <span className="truncate">{rotulo}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[320px] max-w-[calc(100vw-32px)] p-1"
        onCloseAutoFocus={(e) => {
          if (levando.current) {
            levando.current = false;
            e.preventDefault();
          }
        }}
      >
        <p className={juntar(texto.rotulo, "px-2 pb-1 pt-1.5")}>Para concluir a etapa</p>
        <ul aria-label="O que falta">
          {itens.map((i) => (
            <li key={i.texto}>
              {i.destino ? (
                <button
                  type="button"
                  className={juntar(toqueCompacto, "flex min-h-8 w-full items-center rounded px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-muted", foco)}
                  onClick={() => {
                    const d = i.destino as DestinoDoQueFalta;
                    levando.current = true;
                    setAberto(false);
                    window.setTimeout(() => irAoQueFalta(d, etapa, irPara), 0);
                  }}
                  data-item-que-falta=""
                >
                  <span className="min-w-0 flex-1">{i.texto}</span>
                  <ArrowRight className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </button>
              ) : (
                <span className="block px-2 py-1.5 text-[13px] text-foreground">{i.texto}</span>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Cabeçalho de cada etapa: título, o "?" com a explicação, as ações, o
 * Concluir etapa (ou Reabrir, quando já fechou) e, embaixo, a linha de estado
 * na largura toda: o que falta ("Falta 3", que abre a lista e leva a cada
 * lugar) e a gravação ("Salvando...", "Tudo salvo" ou "Não salvo: tentar de
 * novo"). UXS 30/09: o Concluir grava o pendente antes ("Salvar e concluir"
 * quando há mudança na tela) e não conclui se a gravação falhar.
 *
 * Props opcionais (as etapas que não passam nada ficam como estavam):
 * `falta` (o que falta calculado pela tela, ex.: os valores do Briefing ainda
 * não salvos), `pendente` e `antesDeConcluir` (a etapa grava do jeito dela).
 */
export function CabecalhoDaEtapa({
  etapa,
  titulo,
  ajuda,
  acoes,
  falta: faltaDaTela,
  pendente: pendenteDaTela,
  antesDeConcluir,
}: {
  etapa: EtapaDaIdentidade;
  titulo?: string;
  ajuda?: ReactNode;
  acoes?: ReactNode;
  falta?: string[];
  pendente?: boolean;
  antesDeConcluir?: () => Promise<void>;
}) {
  const { projeto, concluir, reabrir, irPara } = useProjetoDaMesa();
  const gravacoes = useGravacoesDaMesa();
  const gravacao = useResumoDasGravacoes();
  const [ocupado, setOcupado] = useState(false);
  const possiveis = etapasDoProjeto(projeto);
  const itens = faltaDaTela
    ? faltaDaTela.map((t) => {
        const d = destinoDoQueFalta(etapa, t);
        return { texto: t, destino: d && possiveis.indexOf(d.etapa) >= 0 ? d : null };
      })
    : faltaComDestino(etapa, projeto.dados, possiveis);
  const falta = itens.map((i) => i.texto);
  const feita = etapaFeita(projeto, etapa);
  const pendente = !!pendenteDaTela || gravacao.pendente;
  const rodar = async (fn: () => Promise<void>) => {
    setOcupado(true);
    try {
      await fn();
    } finally {
      setOcupado(false);
    }
  };
  const concluirComGravacao = async () => {
    try {
      if (antesDeConcluir) await antesDeConcluir();
      else if (gravacoes) await gravacoes.salvarTudo();
    } catch (e) {
      toast.error("A etapa não fechou: a mudança não foi salva", { description: textoDoErro(e), duration: 9000 });
      return;
    }
    await concluir(etapa);
  };
  const estadoDaGravacao =
    gravacao.estado === "erro" ? (
      <button
        type="button"
        className={juntar(toqueCompacto, "inline-flex h-5 items-center rounded px-1 align-middle text-[12px] font-medium text-destructive underline decoration-dotted underline-offset-2 hover:bg-muted", foco)}
        title={gravacao.erro || undefined}
        onClick={() => {
          if (gravacoes) void gravacoes.salvarTudo().catch(() => undefined);
        }}
        data-tentar-gravar=""
      >
        Não salvo: tentar de novo
      </button>
    ) : gravacao.estado === "salvando" ? (
      <span data-gravacao="salvando">Salvando...</span>
    ) : pendenteDaTela && !feita ? (
      // O que está na tela ainda não está no projeto (ex.: o briefing do cliente que ninguém salvou): o Concluir salva antes.
      <span data-gravacao="nao-salvo">Não salvo</span>
    ) : gravacao.estado === "salvo" ? (
      <span data-gravacao="salvo">Tudo salvo</span>
    ) : null;
  const estadoDaEtapa = feita ? <span>Etapa concluída</span> : falta.length ? <FaltaDaEtapa etapa={etapa} itens={itens} irPara={irPara} /> : <span>Pronta para concluir</span>;
  return (
    <div className="min-w-0" data-cabecalho-da-etapa={etapa}>
      <CabecalhoDeSecao
        titulo={titulo || rotuloDaEtapa(etapa)}
        ajuda={ajuda}
        rotuloDaAjuda={`Sobre a etapa ${rotuloDaEtapa(etapa)}`}
        acao={
          <>
            {acoes}
            {etapa !== "inicio" &&
              (feita ? (
                <button type="button" className={juntar(botao.discreto, "m-1 h-8")} disabled={ocupado} onClick={() => void rodar(() => reabrir(etapa))}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reabrir
                </button>
              ) : (
                <button
                  type="button"
                  className={juntar(botao.primario, "m-1 h-8")}
                  disabled={ocupado || falta.length > 0}
                  title={falta.length ? `Falta: ${falta.join("; ")}` : undefined}
                  onClick={() => void rodar(concluirComGravacao)}
                  data-concluir-etapa={etapa}
                >
                  {ocupado ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />} {pendente ? "Salvar e concluir" : "Concluir etapa"}
                </button>
              ))}
          </>
        }
      />
      <p className={juntar(texto.auxiliar, "mt-0.5 truncate")} data-estado-da-etapa="">
        {estadoDaEtapa}
        {estadoDaGravacao ? <span aria-hidden="true"> · </span> : null}
        {estadoDaGravacao ? <span aria-live="polite">{estadoDaGravacao}</span> : null}
      </p>
    </div>
  );
}

/** A etapa abre? (irPara cai em silêncio na etapa atual quando não abre.) */
export function podeIrPara(projeto: ProjetoDeIdentidade, e: EtapaDaIdentidade): boolean {
  return etapasDoProjeto(projeto).indexOf(e) >= 0 && podeAbrir(projeto, e).pode;
}

/** Imagem da marca do bucket mesa sem cortar (logo, grafismo), com espaço reservado. */
export function ImagemInteira({ caminho, alt, className = "", fundo }: { caminho?: string | null; alt: string; className?: string; fundo?: string }) {
  const { data: url, isError } = useUrlDaMesa(caminho || null);
  return (
    <div className={juntar("flex items-center justify-center overflow-hidden rounded-md", className)} style={fundo ? { background: fundo } : undefined}>
      {!caminho || isError ? (
        <span className={juntar(texto.etiqueta, "text-muted-foreground")}>{isError ? "Imagem indisponível" : "Sem imagem"}</span>
      ) : url ? (
        <img src={url} alt={alt} loading="lazy" className="max-h-full max-w-full object-contain" />
      ) : (
        <span className="h-full w-full animate-pulse bg-muted" />
      )}
    </div>
  );
}

/** Pastilha pequena de estado. */
export function Pastilha({ tom = "neutro", children }: { tom?: "neutro" | "bom" | "alerta" | "ruim"; children: ReactNode }) {
  const cor = tom === "bom" ? "bg-primary/10 text-primary" : tom === "alerta" ? "bg-warning/15 text-warning" : tom === "ruim" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground";
  return <span className={juntar(etiqueta, cor)}>{children}</span>;
}

/**
 * O que a tela sabe do projeto e o servidor do "Preencher com IA" não lê
 * (o briefing, a pesquisa e a estratégia moram em idv_projetos.dados): vai no
 * `contexto` da peça comum, curto (até 2.800 letras).
 */
export function contextoParaPreencher(projeto: ProjetoDeIdentidade, extra?: string): string {
  const d = projeto.dados || {};
  const modo = projeto.modo === "zero" ? "marca do zero" : projeto.modo === "completar" ? "marca existente: a logo e o nome já existem e não mudam" : "rebranding";
  const linhas: string[] = [`Projeto de identidade: ${projeto.titulo} (${modo}).`];
  const nome = d.naming && typeof d.naming.nome === "string" ? d.naming.nome : "";
  if (nome) linhas.push(projeto.modo === "completar" ? `Nome da marca: ${nome}.` : `Nome escolhido: ${nome}.`);
  // IDV3: a leitura da logo (o que a imagem mostra) ajuda o texto a não se descolar da marca real.
  const lida = d.leitura_da_logo && d.leitura_da_logo.visao ? d.leitura_da_logo.visao : null;
  if (lida && (lida.forma || lida.estilo)) linhas.push(`Logo: ${[lida.forma, lida.estilo].filter(Boolean).join(" ")}`);
  const b = (d.briefing || {}) as Record<string, unknown>;
  const partes = Object.keys(b)
    .filter((k) => k !== "briefing_id" && b[k] != null && String(b[k]).trim())
    .map((k) => `${k}: ${Array.isArray(b[k]) ? (b[k] as unknown[]).join(", ") : String(b[k])}`);
  if (partes.length) linhas.push(`Briefing do projeto. ${partes.join(" | ")}`);
  const p = (d.pesquisa || {}) as Record<string, any>;
  const resumo = p.resumo || (p.ia && p.ia.resumo) || "";
  if (resumo) linhas.push(`Pesquisa: ${String(resumo)}`);
  const mood = Array.isArray(p.moodboard) ? (p.moodboard as Array<Record<string, unknown>>).map((m) => String(m.nota || m.titulo || "")).filter(Boolean) : [];
  if (mood.length) linhas.push(`Moodboard: ${mood.slice(0, 10).join("; ")}`);
  const e = (d.estrategia || {}) as Record<string, any>;
  const pos = e.posicionamento && e.posicionamento.declaracao;
  if (e.proposito) linhas.push(`Propósito: ${e.proposito}`);
  if (pos) linhas.push(`Posicionamento: ${pos}`);
  if (e.arquetipo && e.arquetipo.principal) linhas.push(`Arquétipo: ${e.arquetipo.principal}`);
  if (e.tom && Array.isArray(e.tom.atributos) && e.tom.atributos.length) linhas.push(`Tom: ${e.tom.atributos.join(", ")}`);
  if (extra) linhas.push(extra);
  return linhas.join("\n").slice(0, 2800);
}
