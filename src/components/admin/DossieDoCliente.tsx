import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ChevronDown, ChevronUp, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mudancasEntreVersoes } from "@/lib/dossieGeral";
import {
  CONTEXTO_KINDS, dossieMaisRecente, idadeEmPalavras,
} from "@/lib/contextoDoCliente";
import { AO_VIVO_CALMO } from "@/lib/consultaAoVivo";
import EntregasNoDossie from "@/components/admin/EntregasNoDossie";
import { EstadoVazio, Secao, botao, etiqueta, foco, juntar, texto } from "@/components/sistema";

/**
 * O dossiê do cliente, com o texto inteiro.
 *
 * A fonte é a CHAVE CANÔNICA: client_dossiers com is_current=true — o mesmo
 * registro que o MCP grava e devolve. Antes, o card escolhia "o registro
 * mais novo dentro de uma lista de tipos" de project_memory: bastava a
 * rotina gravar com um tipo fora da lista, ou duas fontes escreverem em
 * sequência, para um dossiê VELHO aparecer como atual. A heurística antiga
 * fica só como transição, para clientes que a migração ainda não semeou.
 */

interface Props {
  clientId: string;
  clientName?: string;
}

interface DossieAtual {
  content: string | null;
  summary: string | null;
  version: number | null;
  change_reason: string | null;
  source: string | null;
  updated_at: string | null;
  effective_at: string | null;
}

interface VersaoDoHistorico {
  /** Linhas que entraram nesta versao em relacao a anterior. */
  entrou?: string[];
  id: string;
  version: number;
  summary: string | null;
  change_reason: string | null;
  source: string | null;
  created_at: string;
  is_current: boolean;
}

export default function DossieDoCliente({ clientId, clientName }: Props) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [historicoAberto, setHistoricoAberto] = useState(false);

  const chave = ["dossie-cliente", clientId];
  const { data, isFetching, refetch } = useQuery({
    queryKey: chave,
    queryFn: async () => {
      // 1) A chave canônica. maybeSingle: o índice único garante no máximo um.
      const atual = await (supabase as any)
        .from("client_dossiers")
        .select("content, summary, version, change_reason, source, updated_at, effective_at")
        .eq("client_id", clientId)
        .eq("dossier_type", "contexto")
        .eq("is_current", true)
        .is("project_id", null)
        .maybeSingle();
      if (!atual.error && atual.data) {
        return { atual: atual.data as DossieAtual, legado: null };
      }
      // 2) Transição: cliente ainda não migrado (ou tabela ainda não criada).
      const { data: legado, error } = await (supabase as any)
        .from("project_memory")
        .select("kind, title, content, source, created_at")
        .eq("client_id", clientId)
        .in("kind", [...CONTEXTO_KINDS])
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return { atual: null, legado: [] };
      return { atual: null, legado: legado || [] };
    },
    enabled: Boolean(clientId),
    staleTime: 15_000,
    ...AO_VIVO_CALMO,
  });

  const { data: historico } = useQuery({
    queryKey: ["dossie-historico", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("client_dossiers")
        .select("id, version, summary, change_reason, source, created_at, is_current, content")
        .eq("client_id", clientId)
        .eq("dossier_type", "contexto")
        .is("project_id", null)
        .order("version", { ascending: false })
        .limit(20);
      if (error) return [];
      // "O que entrou" em cada versao: a diferenca para a imediatamente
      // anterior da lista. E a progressao, versao a versao.
      const lista = (data || []) as Array<VersaoDoHistorico & { content?: string | null }>;
      return lista.map((v, i) => ({ ...v, entrou: mudancasEntreVersoes(lista[i + 1]?.content ?? null, v.content ?? null, 4) })) as VersaoDoHistorico[];
    },
    enabled: Boolean(clientId) && historicoAberto,
  });

  /**
   * Os OUTROS dossiês atuais do cliente (por projeto, ou de outro tipo).
   *
   * O caso do Mirante Luz: o dossiê geral parou dois dias atrás enquanto o
   * do projeto era atualizado todo dia — e esta tela, olhando só o geral,
   * jurava que o cliente estava desatualizado. O balde certo estava cheio;
   * a tela é que não olhava para ele.
   */
  const { data: irmaos = [] } = useQuery({
    queryKey: ["dossie-irmaos", clientId],
    queryFn: async () => {
      const { data: linhas, error } = await (supabase as any)
        .from("client_dossiers")
        .select("id, dossier_type, project_id, version, summary, updated_at, project:projects(name)")
        .eq("client_id", clientId)
        .eq("is_current", true)
        .order("updated_at", { ascending: false });
      if (error) return [];
      return ((linhas || []) as Array<Record<string, unknown>>).filter(
        (d) => !(d.dossier_type === "contexto" && d.project_id == null),
      );
    },
    enabled: Boolean(clientId),
    staleTime: 15_000,
    ...AO_VIVO_CALMO,
  });

  const atual = data?.atual ?? null;
  const legado = atual ? null : dossieMaisRecente(data?.legado || []);
  const corpo = String(atual?.content ?? legado?.content ?? "").trim();
  const quando = atual?.updated_at ?? atual?.effective_at ?? legado?.created_at ?? null;
  const idade = idadeEmPalavras(quando ?? undefined);
  const irmaoMaisNovo = (irmaos as Array<Record<string, unknown>>).find(
    (d) => typeof d.updated_at === "string" && (!quando || String(d.updated_at) > String(quando)),
  );

  const atualizar = async () => {
    await queryClient.invalidateQueries({ queryKey: chave });
    await queryClient.invalidateQueries({ queryKey: ["dossie-historico", clientId] });
    await refetch();
  };

  // Seção aberta (28/09, dono: "não encaixotar"): mora entre as seções da
  // coluna do perfil na Central, com a mesma divisória fina e o mesmo recolher.
  // Na tela: título, uma linha de estado (idade e versão) e o texto; o que o
  // bloco é mora no "?".
  const linkDaSecao = juntar("inline-flex cursor-pointer items-center rounded border-none bg-transparent p-0 text-[12px] font-medium text-primary hover:opacity-80", foco);
  return (
    <Secao
      divisoria
      recolher={`central:perfis:dossie:${clientId}`}
      titulo="Dossiê de contexto"
      descricao={corpo ? <>{idade}{atual?.version != null && <> · v{atual.version}</>}</> : undefined}
      resumo={corpo ? idade : "nenhum dossiê escrito"}
      ajuda="O retrato do cliente que a rotina de contexto e o MCP gravam, com o texto inteiro, o histórico de versões e o que já foi entregue. É a mesma leitura que o Ciclo e a Central usam."
      acao={
        <button
          type="button"
          onClick={() => void atualizar()}
          disabled={isFetching}
          className={botao.icone}
          aria-label="Atualizar dossiê"
          title="Buscar a versão mais recente"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      }
    >
      {/* O aviso que mata o "há 2 dias" enganoso: quando existe dossiê mais
          novo em outra chave, este bloco diz isso com todas as letras em vez
          de deixar o geral velho passar por retrato do cliente. */}
      {irmaoMaisNovo && (
        <p className="mb-2 rounded-md bg-warning/10 px-3 py-2 text-[12px] leading-relaxed text-warning">
          O dossiê geral está de {quando ? new Date(quando).toLocaleDateString("pt-BR") : "antes"},
          mas o {String(irmaoMaisNovo.project_id ? `do projeto ${(irmaoMaisNovo.project as { name?: string } | null)?.name ?? ""}` : `de tipo ${irmaoMaisNovo.dossier_type}`)} foi
          atualizado em {new Date(String(irmaoMaisNovo.updated_at)).toLocaleDateString("pt-BR")}: veja abaixo.
        </p>
      )}

      {!corpo ? (
        <EstadoVazio compacto titulo={`Nenhum dossiê escrito para ${clientName || "este cliente"} ainda.`} />
      ) : (
        <>
          {/* O corpo é o que muda entre versões. */}
          <p className={juntar(texto.corpo, "whitespace-pre-line leading-relaxed text-foreground/90", aberto ? "" : "line-clamp-6")}>
            {corpo}
          </p>
          {atual?.change_reason && (
            <p className={juntar(texto.auxiliar, "mt-1.5 truncate italic")} title={atual.change_reason}>
              Última mudança: {atual.change_reason}
            </p>
          )}
          <div className="mt-2 flex min-w-0 flex-wrap items-center [&>*]:mr-3">
            <button type="button" onClick={() => setAberto((v) => !v)} className={linkDaSecao}>
              {aberto ? "Mostrar menos" : "Ler o dossiê inteiro"}
              {aberto ? <ChevronUp className="ml-1 h-3 w-3" aria-hidden="true" /> : <ChevronDown className="ml-1 h-3 w-3" aria-hidden="true" />}
            </button>
            {atual && (
              <button type="button" onClick={() => setHistoricoAberto((v) => !v)} className={linkDaSecao}>
                <History className="mr-1 h-3 w-3" aria-hidden="true" />
                {historicoAberto ? "Fechar histórico" : "Ver histórico"}
              </button>
            )}
            {quando && (
              <span className={juntar(texto.auxiliar, "ml-auto !mr-0 tabular-nums")}>
                {new Date(quando).toLocaleString("pt-BR", {
                  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                })}
              </span>
            )}
          </div>

          {historicoAberto && (
            <ul className="mt-2 space-y-1 border-t border-border pt-2">
              {(historico || []).map((v) => (
                <li key={v.id} className="text-[12px]">
                  <div className="flex min-w-0 items-baseline">
                    <span className={`mr-2 shrink-0 font-semibold tabular-nums ${v.is_current ? "text-primary" : "text-muted-foreground"}`}>
                      v{v.version}
                    </span>
                    <span className="mr-2 min-w-0 truncate text-muted-foreground">
                      {v.change_reason || v.summary || v.source || "sem descrição"}
                    </span>
                    <span className="ml-auto shrink-0 tabular-nums text-muted-foreground/70">
                      {new Date(v.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                    </span>
                  </div>
                  {(v.entrou || []).length > 0 && (
                    <ul className="ml-6 mt-0.5 space-y-0.5">
                      {v.entrou!.map((linha, i) => <li key={i} className="text-[12px] leading-snug text-foreground/85">+ {linha}</li>)}
                    </ul>
                  )}
                </li>
              ))}
              {(historico || []).length === 0 && (
                <li className={texto.auxiliar}>Carregando histórico…</li>
              )}
            </ul>
          )}
        </>
      )}

      {/* Os outros dossiês atuais: por projeto, ou de outro tipo. Cada um é
          um balde com o próprio "atual"; escondê-los era o que fazia o
          trabalho de todo dia parecer parado. */}
      {(irmaos as Array<Record<string, unknown>>).length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <p className={texto.rotulo}>Outros dossiês atuais</p>
          <ul className="mt-1.5 space-y-1">
            {(irmaos as Array<Record<string, unknown>>).map((d) => (
              <li key={String(d.id)} className="flex min-w-0 items-baseline text-[12px]">
                <span className="mr-2 shrink-0 font-semibold text-foreground/80">
                  {d.project_id
                    ? `Projeto: ${(d.project as { name?: string } | null)?.name ?? "(sem nome)"}`
                    : `Tipo: ${String(d.dossier_type)}`}
                </span>
                <span className={juntar(etiqueta, "mr-2 bg-primary/10 text-primary")}>
                  v{String(d.version)}
                </span>
                <span className="mr-2 min-w-0 truncate text-muted-foreground">
                  {String(d.summary ?? "")}
                </span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                  {new Date(String(d.updated_at)).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* A outra metade do dossiê: quem é o cliente E o que já foi feito
          para ele. Vem da mesma memória que o Ciclo e a Central leem. */}
      <EntregasNoDossie clientId={clientId} />
    </Secao>
  );
}
