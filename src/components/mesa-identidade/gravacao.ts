import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type SetStateAction } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarIdentidade, CHAVES, guardarProjeto, type ProjetoDeIdentidade } from "./identidadeApi";

/**
 * Gravação automática da Mesa Identidade (UXS 30/09, IDV-01 e IDV-02).
 *
 * Um jeito só de salvar: a parte grava sozinha, parcial, ao sair do campo e
 * depois de 800 ms sem digitar. Pela mesma `salvarParte` (que já põe tudo numa
 * fila por projeto e lê a versão do cache na hora de gravar).
 *
 * - Cada parte grava uma coisa por vez: a gravação nova espera a que está
 *   em andamento e manda o valor mais novo, só se ainda houver mudança.
 * - A releitura ignora o próprio eco: a tela só é reescrita pelo servidor
 *   quando o valor de lá é diferente do último que esta parte reconheceu e
 *   não há edição pendente nela.
 * - Só o que vai ao servidor é normalizado; a tela nunca recebe o valor
 *   normalizado de volta (linha nova vazia e HEX incompleto ficam na tela).
 * - Silencioso: nenhum aviso de sucesso. Falha vira "Não salvo: tentar de
 *   novo" no cabeçalho da etapa; nunca repete sozinho.
 * - Ao desmontar (trocar de etapa, marca, cliente ou mesa) grava o pendente;
 *   se falhar, aí sim avisa (a tela já não está lá para mostrar).
 */

/** A fila de projeto_salvar da página (uma gravação por vez). */
export type FilaDeGravacao = { atual: Promise<unknown> };
export const novaFilaDeGravacao = (): FilaDeGravacao => ({ atual: Promise.resolve() });

/**
 * O salvarParte da mesa (IDV-01/02): entra na fila e, NA HORA de gravar, lê a
 * versão do cache (a da resposta da gravação anterior), nunca a do render.
 * Duas gravações seguidas (sair do campo e clicar em Concluir) não dão mais o
 * 409 falso "Outra pessoa salvou", e o Desfazer de um aviso antigo grava sobre
 * a versão de agora. No 409 de verdade, relê o projeto antes de liberar a fila.
 */
export function salvarNaFila(
  fila: FilaDeGravacao,
  qc: QueryClient,
  projetoId: string,
  versaoDoRender: number,
  parte: string,
  valor: Record<string, unknown>,
  opcoes: { substituir?: boolean } = {},
): Promise<ProjetoDeIdentidade> {
  const vez = fila.atual.then(async () => {
    const noCache = qc.getQueryData<ProjetoDeIdentidade | null>(CHAVES.projeto(projetoId));
    const versao = noCache && noCache.id === projetoId ? noCache.versao : versaoDoRender;
    try {
      const r = await chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("projeto_salvar", { projeto_id: projetoId, versao, parte, valor, substituir: opcoes.substituir === true });
      guardarProjeto(qc, r.projeto);
      return r.projeto;
    } catch (e) {
      // Outra pessoa salvou antes: relê (a próxima da fila já grava sobre a versão nova).
      await qc.invalidateQueries({ queryKey: CHAVES.projeto(projetoId) }).catch(() => undefined);
      throw e;
    }
  });
  fila.atual = vez.catch(() => undefined);
  return vez;
}

export type EstadoDaGravacao = "ocioso" | "salvando" | "salvo" | "erro";

export interface ResumoDaGravacao {
  /** Há mudança na tela que ainda não chegou ao banco (ou está indo). */
  pendente: boolean;
  estado: EstadoDaGravacao;
  erro: string | null;
}

type ParteRegistrada = { pendente: boolean; estado: EstadoDaGravacao; erro: string | null; salvar: () => Promise<void> };

const RESUMO_VAZIO: ResumoDaGravacao = { pendente: false, estado: "ocioso", erro: null };

/** As partes com gravação da etapa aberta (uma instância por página da mesa). */
export class GravacoesDaMesa {
  private partes = new Map<string, ParteRegistrada>();
  private ouvintes = new Set<() => void>();
  private foto: ResumoDaGravacao = RESUMO_VAZIO;

  registrar(id: string, parte: ParteRegistrada): () => void {
    this.partes.set(id, parte);
    this.avisar();
    return () => {
      if (this.partes.get(id) === parte) {
        this.partes.delete(id);
        this.avisar();
      }
    };
  }

  atualizar(id: string, mudanca: Partial<ParteRegistrada>) {
    const p = this.partes.get(id);
    if (!p) return;
    Object.assign(p, mudanca);
    this.avisar();
  }

  assinar = (fn: () => void) => {
    this.ouvintes.add(fn);
    return () => {
      this.ouvintes.delete(fn);
    };
  };

  resumo = (): ResumoDaGravacao => this.foto;

  temPendente(): boolean {
    let tem = false;
    this.partes.forEach((p) => {
      if (p.pendente || p.estado === "salvando") tem = true;
    });
    return tem;
  }

  /** Grava tudo o que está pendente (Concluir, trocar de etapa). Rejeita se alguma falhar. */
  salvarTudo(): Promise<void> {
    const lista: Array<Promise<void>> = [];
    this.partes.forEach((p) => lista.push(p.salvar()));
    return Promise.all(lista).then(() => undefined);
  }

  private avisar() {
    let pendente = false;
    let salvando = false;
    let erro: string | null = null;
    let salvo = false;
    this.partes.forEach((p) => {
      if (p.pendente) pendente = true;
      if (p.estado === "salvando") salvando = true;
      if (p.estado === "erro" && !erro) erro = p.erro || "Não foi salvo";
      if (p.estado === "salvo") salvo = true;
    });
    const estado: EstadoDaGravacao = erro ? "erro" : salvando || pendente ? "salvando" : salvo ? "salvo" : "ocioso";
    const novo: ResumoDaGravacao = { pendente: pendente || salvando, estado, erro };
    if (novo.pendente !== this.foto.pendente || novo.estado !== this.foto.estado || novo.erro !== this.foto.erro) this.foto = novo;
    this.ouvintes.forEach((o) => o());
  }
}

export const ContextoDasGravacoes = createContext<GravacoesDaMesa | null>(null);

export function useGravacoesDaMesa(): GravacoesDaMesa | null {
  return useContext(ContextoDasGravacoes);
}

const semAssinatura = () => () => undefined;
const resumoVazio = () => RESUMO_VAZIO;

/** O estado somado das partes da etapa (para a linha de estado do cabeçalho). */
export function useResumoDasGravacoes(): ResumoDaGravacao {
  const g = useGravacoesDaMesa();
  return useSyncExternalStore(g ? g.assinar : semAssinatura, g ? g.resumo : resumoVazio, g ? g.resumo : resumoVazio);
}

let contador = 0;

/**
 * Agenda e grava uma parte. `fazer` lê o valor mais novo (ref ou closure do
 * último render) e grava; lança em erro. Devolve:
 * - agendar(): marca mudança e grava em `espera` ms sem nova mudança;
 * - agora(forcar?): grava já (espera a que está indo); rejeita se falhar;
 * - ocupado(): há mudança pendente, agendada ou indo (a releitura espera).
 */
export function useGravacaoAgendada(id: string, fazer: () => Promise<void>, espera = 800) {
  const gravacoes = useGravacoesDaMesa();
  const fazerRef = useRef(fazer);
  fazerRef.current = fazer;
  const idUnico = useRef<string>("");
  if (!idUnico.current) {
    contador += 1;
    idUnico.current = `${id}#${contador}`;
  }
  const sujo = useRef(false);
  const timer = useRef<number | null>(null);
  const emCurso = useRef<Promise<void> | null>(null);
  const vivo = useRef(true);
  const [estado, setEstado] = useState<EstadoDaGravacao>("ocioso");
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const gRef = useRef(gravacoes);
  gRef.current = gravacoes;

  const publicar = useCallback((m: { estado?: EstadoDaGravacao; pendente?: boolean; erro?: string | null }) => {
    if (vivo.current) {
      if (m.estado !== undefined) setEstado(m.estado);
      if (m.pendente !== undefined) setPendente(m.pendente);
      if (m.erro !== undefined) setErro(m.erro);
    }
    if (gRef.current) gRef.current.atualizar(idUnico.current, m);
  }, []);

  const rodada = useCallback(async () => {
    if (!sujo.current) return;
    sujo.current = false;
    publicar({ estado: "salvando", pendente: true, erro: null });
    try {
      await fazerRef.current();
      publicar({ estado: sujo.current ? "salvando" : "salvo", pendente: sujo.current || timer.current !== null });
    } catch (e) {
      sujo.current = true;
      publicar({ estado: "erro", pendente: true, erro: textoDoErro(e, "Não foi salvo") });
      throw e;
    }
  }, [publicar]);

  const agora = useCallback(
    (forcar = false): Promise<void> => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      if (forcar) sujo.current = true;
      const antes = emCurso.current || Promise.resolve();
      const p = antes.then(rodada, rodada);
      emCurso.current = p;
      const limpar = () => {
        if (emCurso.current === p) emCurso.current = null;
      };
      p.then(limpar, limpar);
      return p;
    },
    [rodada],
  );

  const agendar = useCallback(() => {
    sujo.current = true;
    publicar({ pendente: true });
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      agora().catch(() => undefined);
    }, espera);
  }, [agora, espera, publicar]);

  const ocupado = useCallback(() => sujo.current || timer.current !== null || emCurso.current !== null, []);

  // Entra na lista da etapa (o Concluir e a troca de etapa gravam o pendente antes).
  useEffect(() => {
    const g = gravacoes;
    const tirar = g ? g.registrar(idUnico.current, { pendente: false, estado: "ocioso", erro: null, salvar: () => agora() }) : null;
    return () => {
      if (tirar) tirar();
    };
  }, [gravacoes, agora]);

  // Saiu da tela com mudança: grava na hora; se falhar, avisa (a tela já não mostra o estado).
  useEffect(() => {
    // Montou (de novo, no StrictMode): volta a mostrar o estado na própria parte.
    vivo.current = true;
    return () => {
      vivo.current = false;
      const tinha = sujo.current || timer.current !== null;
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      if (tinha) {
        sujo.current = true;
        agora().catch((e) => toast.error("Uma mudança não foi salva", { description: textoDoErro(e), duration: 12_000 }));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { agendar, agora, ocupado, estado, pendente, erro };
}

/**
 * Valor de uma parte com gravação automática e releitura sem eco.
 * - `servidor`: o valor salvo, já na forma da tela;
 * - `paraSalvar`: o que vai ao servidor (normalizado; nunca volta à tela);
 * - `gravar(novo, anterior)`: grava (anterior = o último que esta parte
 *   reconheceu; serve para mandar só as chaves que mudaram).
 */
export function useValorSalvo<T, S = unknown>(o: {
  id: string;
  servidor: T;
  paraSalvar: (v: T) => S;
  gravar: (novo: S, anterior: S) => Promise<unknown>;
  espera?: number;
}) {
  const [valor, setValor] = useState<T>(o.servidor);
  const valorRef = useRef<T>(valor);
  const paraSalvarRef = useRef(o.paraSalvar);
  paraSalvarRef.current = o.paraSalvar;
  const gravarRef = useRef(o.gravar);
  gravarRef.current = o.gravar;
  const jsonDoServidor = JSON.stringify(o.paraSalvar(o.servidor));
  const servidorRef = useRef<{ json: string; valor: T }>({ json: jsonDoServidor, valor: o.servidor });
  servidorRef.current = { json: jsonDoServidor, valor: o.servidor };
  /** O último valor normalizado que esta parte reconhece como seu (enviado ou lido). */
  const base = useRef<string>(jsonDoServidor);

  const g = useGravacaoAgendada(
    o.id,
    async () => {
      const novo = paraSalvarRef.current(valorRef.current);
      const json = JSON.stringify(novo);
      if (json === base.current) {
        // Nada a gravar (a pessoa voltou ao valor de antes): se o servidor mudou enquanto ela mexia, a tela
        // acompanha agora (depois que esta rodada sair da fila).
        window.setTimeout(() => sincronizarRef.current(), 0);
        return;
      }
      const anterior = JSON.parse(base.current) as S;
      await gravarRef.current(novo, anterior);
      base.current = json;
    },
    o.espera,
  );
  const { agendar, agora } = g;
  const ocupadoRef = useRef(g.ocupado);
  ocupadoRef.current = g.ocupado;

  /**
   * Reescreve a tela com o servidor só sem edição pendente e sem eco. Nunca
   * logo depois da própria gravação: o render com a resposta ainda não chegou
   * (a tela voltaria ao valor velho por um instante); quem cuida é o efeito,
   * quando o valor do servidor muda de verdade.
   */
  const sincronizar = useCallback(() => {
    const s = servidorRef.current;
    if (s.json === base.current || ocupadoRef.current()) return;
    base.current = s.json;
    valorRef.current = s.valor;
    setValor(s.valor);
  }, []);
  const sincronizarRef = useRef(sincronizar);
  sincronizarRef.current = sincronizar;

  // O servidor mudou (outra parte, o diretor, outra pessoa): reescreve só sem edição pendente e sem eco.
  useEffect(() => {
    sincronizar();
  }, [jsonDoServidor, sincronizar]);

  const mudar = useCallback(
    (v: SetStateAction<T>) => {
      const novo = typeof v === "function" ? (v as (a: T) => T)(valorRef.current) : v;
      valorRef.current = novo;
      setValor(novo);
      agendar();
    },
    [agendar],
  );

  /** Troca e grava já (ação explícita: Usar, Do caminho, Desfazer, tirar item). Rejeita se falhar. */
  const trocarESalvar = useCallback(
    (v: T): Promise<void> => {
      valorRef.current = v;
      setValor(v);
      return agora(true);
    },
    [agora],
  );

  const salvarAgora = useCallback(() => agora(), [agora]);

  return { valor, mudar, trocarESalvar, salvarAgora, pendente: g.pendente, estado: g.estado, erro: g.erro };
}
