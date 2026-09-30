import { createContext, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import { useMesa, useUrlDaMesa } from "@/components/mesa/MesaContexto";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { modeloDoPapel, modelosAtivos, nomeDoModelo, precoDoModelo, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";
import { faltaNaEtapa, rotuloDaEtapa, TAMANHOS_DA_IDENTIDADE, type EtapaDaIdentidade } from "../../../supabase/functions/_shared/identidade-etapas";
import type { ProjetoDeIdentidade } from "./identidadeApi";

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

/**
 * O modelo escolhido na hora para as ações de IA da mesa (por papel, lembrado
 * no navegador). Vazio = o padrão do papel (modeloDoPapel).
 */
export function useModeloDaAcao(papel: "identidade" | "naming"): [string, (id: string) => void] {
  const [id, setId] = useEstadoDaTela<string>(`mesa-identidade:modelo:${papel}`, "", { validar: (v) => typeof v === "string" });
  return [id, (v: string) => setId(v)];
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
 * Cabeçalho de cada etapa: título, o "?" com a explicação, o estado (o que
 * falta) e o Concluir etapa (ou Reabrir, quando já fechou).
 */
export function CabecalhoDaEtapa({ etapa, titulo, ajuda, acoes }: { etapa: EtapaDaIdentidade; titulo?: string; ajuda?: ReactNode; acoes?: ReactNode }) {
  const { projeto, concluir, reabrir } = useProjetoDaMesa();
  const [ocupado, setOcupado] = useState(false);
  const falta = faltaNaEtapa(etapa, projeto.dados);
  const feita = projeto.concluidas.indexOf(etapa) >= 0;
  const rodar = async (fn: () => Promise<void>) => {
    setOcupado(true);
    try {
      await fn();
    } finally {
      setOcupado(false);
    }
  };
  const estado = feita ? "Etapa concluída" : falta.length ? `Falta: ${falta.join("; ")}` : "Pronta para concluir";
  return (
    <CabecalhoDeSecao
      data-cabecalho-da-etapa={etapa}
      titulo={titulo || rotuloDaEtapa(etapa)}
      ajuda={ajuda}
      rotuloDaAjuda={`Sobre a etapa ${rotuloDaEtapa(etapa)}`}
      descricao={estado}
      truncar
      acao={
        <>
          {acoes}
          {etapa !== "inicio" &&
            (feita ? (
              <button type="button" className={juntar(botao.discreto, "m-1 h-8")} disabled={ocupado} onClick={() => void rodar(() => reabrir(etapa))}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reabrir
              </button>
            ) : (
              <button type="button" className={juntar(botao.primario, "m-1 h-8")} disabled={ocupado || falta.length > 0} title={falta.length ? `Falta: ${falta.join("; ")}` : undefined} onClick={() => void rodar(() => concluir(etapa))} data-concluir-etapa={etapa}>
                {ocupado ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />} Concluir etapa
              </button>
            ))}
        </>
      }
    />
  );
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
