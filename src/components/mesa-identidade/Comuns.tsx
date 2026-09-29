import { createContext, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import { useUrlDaMesa } from "@/components/mesa/MesaContexto";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { modeloDoPapel, type ModeloIa, type ParteDaEstimativa } from "@/lib/mesa/api";
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

export function partesDoCusto(catalogo: ModeloIa[], alvo: "naming" | "conceito" | "pesquisa" | "conversa"): ParteDaEstimativa[] {
  const m = modeloDoPapelNaTela(catalogo, alvo === "naming" ? "naming" : "identidade");
  const t = TAMANHOS_DA_IDENTIDADE[alvo];
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: t.entrada, tokensSaida: t.saida, ...(alvo === "pesquisa" ? { buscasWeb: TAMANHOS_DA_IDENTIDADE.pesquisa.buscas } : {}) }];
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
