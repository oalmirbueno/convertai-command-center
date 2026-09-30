import { useEffect, useState } from "react";
import { hashKey, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { chamarFuncao } from "@/lib/mesa/api";
import { normalizarTrabalho, type TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";

/**
 * Ponte da Mesa Site com as funções mesa-site (etapas e diretor de site) e
 * motor-codigo (fila do motor: pedir, parar, listar, eventos). Nenhuma chave
 * passa por aqui: a tela manda ordens e lê linhas da fila e o estado ao vivo.
 */

export type LinhaDoSite = {
  id: string;
  client_id: string;
  marca_id: string | null;
  nome: string;
  projeto: string;
  etapa: string;
  briefing: Record<string, any>;
  referencias: any[];
  dna: Record<string, any>;
  direcao: Record<string, any>;
  conteudo: Record<string, any>;
  imagens: any[];
  revisao: Record<string, any>;
  publicacao: Record<string, any>;
  modelo: string | null;
  custo_usd?: number;
  /** SIT2 (migration 20260930160000): tipo de site, mapa, estilo, integrações e SEO. */
  tipo?: string | null;
  mapa?: Record<string, any> | null;
  estilo?: Record<string, any> | null;
  integracoes?: Record<string, any> | null;
  seo?: Record<string, any> | null;
  pacote_mudou_em?: string | null;
  arquivado_em: string | null;
  atualizado_em: string;
};

export type EventoDoMotor = { id: number; tipo: string; resumo: string; dados: Record<string, any>; em: string };
export type ExecutorDoMotor = { nome: string; visto_em: string; versao: string | null; capacidades: Record<string, any> } | null;

export const CHAVES = {
  sites: (clientId: string, marcaId: string | null) => ["mesa-site", "sites", clientId, marcaId || "todas"],
  trabalhos: (siteId: string) => ["mesa-site", "trabalhos", siteId],
  eventos: (trabalhoId: string) => ["mesa-site", "eventos", trabalhoId],
  publicacao: (siteId: string) => ["mesa-site", "publicacao", siteId],
  versoes: (siteId: string) => ["mesa-site", "versoes", siteId],
};

export const chamarSite = <T = any>(acao: string, corpo: Record<string, unknown>) => chamarFuncao<T>("mesa-site", { acao, ...corpo });
export const chamarMotor = <T = any>(acao: string, corpo: Record<string, unknown>) => chamarFuncao<T>("motor-codigo", { acao, ...corpo });

export function useSites(clientId: string, marcaId: string | null) {
  return useQuery({
    queryKey: CHAVES.sites(clientId, marcaId),
    enabled: !!clientId,
    queryFn: async () => {
      const d = await chamarSite<{ sites: LinhaDoSite[]; indisponivel?: boolean; aviso?: string }>("sites_listar", { client_id: clientId, marca_id: marcaId || undefined });
      return { lista: d.sites || [], indisponivel: !!d.indisponivel, aviso: d.aviso || null };
    },
  });
}

/** O site aberto (da lista do cliente; a lista é a fonte: salvar devolve a linha e a tela troca nela). */
export function useSiteAberto(clientId: string, marcaId: string | null, siteId: string | null) {
  const q = useSites(clientId, marcaId);
  const site = q.data && siteId ? q.data.lista.find((s) => s.id === siteId) || null : null;
  return { ...q, site };
}

/** Troca a linha salva na lista do cache (sem esperar reler). */
export function useGuardarSite(clientId: string, marcaId: string | null) {
  const qc = useQueryClient();
  return (site: LinhaDoSite | null | undefined) => {
    if (!site) return;
    qc.setQueryData(CHAVES.sites(clientId, marcaId), (d: any) => (d ? { ...d, lista: [site].concat((d.lista || []).filter((s: LinhaDoSite) => s.id !== site.id)) } : d));
  };
}

/**
 * Salvar com a volta da tela (SIT2): chama a ação, troca a linha na lista e
 * mostra os avisos (versão não guardada, número inválido). O erro sobe para
 * quem chamou mostrar e manter o que a pessoa escreveu.
 */
export function useSalvarSite(clientId: string, marcaId: string | null) {
  const guardar = useGuardarSite(clientId, marcaId);
  const qc = useQueryClient();
  return async <T extends { site?: LinhaDoSite; avisos?: string[]; aviso_versao?: string | null } = { site?: LinhaDoSite; avisos?: string[]; aviso_versao?: string | null }>(acao: string, corpo: Record<string, unknown>): Promise<T> => {
    const d = await chamarSite<T>(acao, corpo);
    if (d && d.site) {
      guardar(d.site);
      void qc.invalidateQueries({ queryKey: CHAVES.versoes(d.site.id) });
    }
    const avisos = ((d && d.avisos) || []).concat(d && d.aviso_versao ? [d.aviso_versao] : []);
    if (avisos.length) toast.warning(avisos.join(" "));
    return d;
  };
}

const ABERTOS = ["na_fila", "executando", "parando"];

export function useTrabalhos(clientId: string, siteId: string | null) {
  const q = useQuery({
    queryKey: CHAVES.trabalhos(siteId || "nenhum"),
    enabled: !!siteId,
    queryFn: async () => {
      const d = await chamarMotor<{ trabalhos: unknown[]; executor: ExecutorDoMotor; executor_vivo: boolean }>("listar", { client_id: clientId, site_id: siteId });
      return {
        trabalhos: (d.trabalhos || []).map(normalizarTrabalho).filter((t): t is TrabalhoDoMotor => !!t),
        executor: d.executor || null,
        vivo: !!d.executor_vivo,
      };
    },
    // Enquanto há trabalho aberto e o motor está ligado, relê de 4 em 4 s (o canal ao vivo acelera).
    // Motor desligado: o pedido só espera na fila; relê de 30 em 30 s (QA 30/09: antes eram 4 s sem fim).
    refetchInterval: (query) => {
      const d = query.state.data as { trabalhos: TrabalhoDoMotor[]; vivo: boolean } | undefined;
      return d && d.vivo && d.trabalhos.some((t) => ABERTOS.indexOf(t.estado) >= 0) ? 4000 : 30_000;
    },
  });
  useAoVivo("motor_trabalhos", siteId ? `referencia_id=eq.${siteId}` : null, CHAVES.trabalhos(siteId || "nenhum"));
  return q;
}

export function useEventos(trabalho: TrabalhoDoMotor | null, vivo = true) {
  const aberto = !!trabalho && ABERTOS.indexOf(trabalho.estado) >= 0;
  const q = useQuery({
    queryKey: CHAVES.eventos(trabalho ? trabalho.id : "nenhum"),
    enabled: !!trabalho,
    queryFn: async () => {
      const d = await chamarMotor<{ eventos: EventoDoMotor[] }>("eventos", { trabalho_id: trabalho!.id });
      return d.eventos || [];
    },
    // Motor desligado: nada anda; sem leitura de 2,5 em 2,5 s (o canal ao vivo avisa se ele ligar).
    refetchInterval: aberto && vivo ? 2500 : false,
  });
  useAoVivo("motor_eventos", trabalho ? `trabalho_id=eq.${trabalho.id}` : null, CHAVES.eventos(trabalho ? trabalho.id : "nenhum"));
  return q;
}

/**
 * Escuta o banco (Realtime) e relê a chave em 300 ms. Sem a tabela na
 * publicação, o canal só não recebe nada e o intervalo segue valendo.
 *
 * Um canal por tabela e filtro, dividido por quem está aberto (EX-08, 30/09).
 * A lateral do agente e a etapa aberta pedem o mesmo filtro; com um canal
 * por montagem, o Realtime devolvia o canal que já existia com o mesmo nome,
 * e a etapa que saía fechava o canal das duas: depois da primeira troca de
 * etapa, a mesa ficava sem tempo real e só andava pelo intervalo. Agora o
 * canal só fecha quando a última tela que o usa fecha.
 */
type CanalAoVivo = {
  usos: number;
  canal: ReturnType<typeof supabase.channel> | null;
  chaves: Map<string, number>;
  clientes: Set<QueryClient>;
  espera: ReturnType<typeof setTimeout> | null;
};
const canaisAoVivo = new Map<string, CanalAoVivo>();
let canaisCriados = 0;

function relerAoVivo(topico: string) {
  const a = canaisAoVivo.get(topico);
  if (!a) return;
  if (a.espera) clearTimeout(a.espera);
  a.espera = setTimeout(() => {
    a.espera = null;
    a.clientes.forEach((qc) => a.chaves.forEach((_, chave) => void qc.invalidateQueries({ queryKey: JSON.parse(chave) })));
  }, 300);
}

function abrirAoVivo(tabela: string, filtro: string, chaveTexto: string, qc: QueryClient): string {
  const topico = `mesa-site:${tabela}:${filtro}`;
  let a = canaisAoVivo.get(topico);
  if (!a) {
    a = { usos: 0, canal: null, chaves: new Map(), clientes: new Set(), espera: null };
    canaisAoVivo.set(topico, a);
    // Nome novo a cada abertura: um canal que ainda está fechando (a tela
    // saiu e voltou logo) não é devolvido no lugar do novo.
    canaisCriados += 1;
    try {
      let primeira = true;
      a.canal = supabase
        .channel(`${topico}:${canaisCriados}`)
        .on("postgres_changes" as any, { event: "*", schema: "public", table: tabela, filter: filtro }, () => relerAoVivo(topico))
        .subscribe((status: string) => {
          // Reconectou depois de cair: o que mudou no meio tempo entra agora.
          if (status === "SUBSCRIBED") {
            if (!primeira) relerAoVivo(topico);
            primeira = false;
          }
        });
    } catch {
      a.canal = null;
    }
  }
  a.usos += 1;
  a.chaves.set(chaveTexto, (a.chaves.get(chaveTexto) || 0) + 1);
  a.clientes.add(qc);
  return topico;
}

function fecharAoVivo(topico: string, chaveTexto: string) {
  const a = canaisAoVivo.get(topico);
  if (!a) return;
  a.usos -= 1;
  const n = (a.chaves.get(chaveTexto) || 0) - 1;
  if (n > 0) a.chaves.set(chaveTexto, n);
  else a.chaves.delete(chaveTexto);
  if (a.usos > 0) return;
  if (a.espera) clearTimeout(a.espera);
  canaisAoVivo.delete(topico);
  if (a.canal) void supabase.removeChannel(a.canal);
}

function useAoVivo(tabela: string, filtro: string | null, chave: unknown[]) {
  const qc = useQueryClient();
  const chaveTexto = JSON.stringify(chave);
  useEffect(() => {
    if (!filtro) return;
    const topico = abrirAoVivo(tabela, filtro, chaveTexto, qc);
    return () => fecharAoVivo(topico, chaveTexto);
  }, [tabela, filtro, chaveTexto, qc]);
}

/** Só para teste: quantos canais ao vivo da Mesa Site estão abertos. */
export function canaisAoVivoDaMesaSite(): number {
  return canaisAoVivo.size;
}

/** O site foi montado depois da última mudança de SEO ou integrações? */
export function montadoDepoisDasMudancas(site: Pick<LinhaDoSite, "pacote_mudou_em">, trabalhos: Array<{ estado: string; tipo: string; terminado_em: string | null }>): boolean {
  if (!site.pacote_mudou_em) return true;
  const ultimo = trabalhos.find((t) => t.estado === "feito" && t.tipo !== "zip" && t.tipo !== "desfazer" && !!t.terminado_em);
  return !!ultimo && Date.parse(String(ultimo.terminado_em)) >= Date.parse(site.pacote_mudou_em);
}

/** O último trabalho com prévia (o iframe mostra esta). */
export const previaAtual = (lista: TrabalhoDoMotor[]) => lista.find((t) => !!t.preview_url) || null;

/** Seções já construídas (trabalhos de construir terminados). */
export function secoesConstruidas(lista: TrabalhoDoMotor[]): string[] {
  const s: string[] = [];
  lista
    .filter((t) => t.estado === "feito" && t.tipo === "construir")
    .forEach((t) => ((Array.isArray(t.resultado.secoes) ? t.resultado.secoes : []) as string[]).forEach((x) => s.indexOf(x) < 0 && s.push(x)));
  return s;
}

/**
 * O endereço da prévia só pelo cache dos trabalhos (UXS 30/09): quem busca a
 * lista é o diretor de site (sempre montado com o site aberto). Sem chamada,
 * sem canal e sem intervalo novos; atualiza quando o cache muda.
 */
export function usePreviaEmCache(siteId: string | null): string | null {
  const qc = useQueryClient();
  const ler = () => {
    const d = siteId ? qc.getQueryData<{ trabalhos: TrabalhoDoMotor[] }>(CHAVES.trabalhos(siteId)) : undefined;
    const p = d && Array.isArray(d.trabalhos) ? previaAtual(d.trabalhos) : null;
    return p ? p.preview_url : null;
  };
  const [url, setUrl] = useState<string | null>(ler);
  useEffect(() => {
    if (!siteId) {
      setUrl(null);
      return;
    }
    const alvo = hashKey(CHAVES.trabalhos(siteId));
    setUrl(ler());
    return qc.getQueryCache().subscribe((ev) => {
      if (ev && ev.query && ev.query.queryHash === alvo) setUrl(ler());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, siteId]);
  return url;
}
