import { useState } from "react";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen, Brain, ChevronsDownUp, ChevronsUpDown, History, Layers, PackageCheck, RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mudancasEntreVersoes } from "@/lib/dossieGeral";
import {
  CONTEXTO_KINDS, dossieMaisRecente, idadeEmPalavras,
} from "@/lib/contextoDoCliente";
import { AO_VIVO_CALMO } from "@/lib/consultaAoVivo";
import EntregasNoDossie from "@/components/admin/EntregasNoDossie";
import CerebroDoCliente from "@/components/mesa/CerebroDoCliente";
import CadernoDoDossie, { useCaderno } from "@/components/admin/CadernoDoDossie";
import { Etapas, EstadoVazio, Secao, botao, etiqueta, foco, juntar, texto, type ItemDeEtapa } from "@/components/sistema";

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

/**
 * As partes do dossiê, uma por vez (17/10, dono: "o scroll está muito longo,
 * o histórico está no mesmo caminho... tabs aqui em cima"). O caderno abre
 * primeiro; o resto, que antes ficava empilhado embaixo, vira aba em ícone.
 */
type AbaDoDossie = "caderno" | "versoes" | "memoria" | "entregas" | "outros";

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function DossieDoCliente({ clientId, clientName }: Props) {
  const queryClient = useQueryClient();
  // A aba vale para ESTE cliente: trocar de cliente volta ao caderno.
  const [abaDoCliente, setAbaDoCliente] = useState<{ clientId: string; aba: AbaDoDossie }>({ clientId, aba: "caderno" });
  const abaEscolhida: AbaDoDossie = abaDoCliente.clientId === clientId ? abaDoCliente.aba : "caderno";
  const setAba = (aba: AbaDoDossie) => setAbaDoCliente({ clientId, aba });
  const historicoAberto = abaEscolhida === "versoes";

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

  // A leitura em caderno: seções numeradas, sumário e as longas recolhidas.
  const caderno = useCaderno(corpo);

  const atualizar = async () => {
    await queryClient.invalidateQueries({ queryKey: chave });
    await queryClient.invalidateQueries({ queryKey: ["dossie-historico", clientId] });
    await refetch();
  };

  const entregasCarregando = useIsFetching({ queryKey: ["entregas-no-dossie", clientId] }) > 0;
  const listaDeIrmaos = irmaos as Array<Record<string, unknown>>;
  const nomeDoIrmao = (d: Record<string, unknown>) =>
    d.project_id
      ? `do projeto ${(d.project as { name?: string } | null)?.name ?? ""}`.trim()
      : `de tipo ${String(d.dossier_type)}`;

  const abas: ItemDeEtapa[] = [
    {
      valor: "caderno", rotulo: "Caderno", dica: "Caderno", icone: <BookOpen className="h-4 w-4" />,
      ajuda: "O texto inteiro do dossiê, em seções. O sumário pula direto para a parte que interessa.",
    },
    ...(atual ? [{
      valor: "versoes", rotulo: "Versões", dica: "Ver histórico de versões", icone: <History className="h-4 w-4" />,
      ajuda: "Cada versão gravada, da mais nova para a mais antiga, com o que entrou em relação à anterior.",
    }] : []),
    {
      valor: "memoria", rotulo: "Memória", dica: "Abrir memória e aprendizados", icone: <Brain className="h-4 w-4" />,
      ajuda: "O segundo cérebro do cliente: o que está em uso, o que falta revisar e os resultados.",
    },
    {
      valor: "entregas", rotulo: "Entregas", dica: "O que já foi entregue", icone: <PackageCheck className="h-4 w-4" />,
      ajuda: "As últimas entregas registradas na memória que o Ciclo e a Central leem.",
    },
    ...(listaDeIrmaos.length > 0 ? [{
      valor: "outros", rotulo: "Outros dossiês", dica: "Outros dossiês atuais", icone: <Layers className="h-4 w-4" />,
      contador: listaDeIrmaos.length,
      ajuda: "Os dossiês atuais por projeto ou de outro tipo. Cada um tem a própria versão atual.",
    }] : []),
  ];
  // Aba que sumiu (sem versões, sem outros dossiês) volta ao caderno.
  const aba: AbaDoDossie = abas.some((a) => a.valor === abaEscolhida) ? abaEscolhida : "caderno";

  // Seção aberta (28/09, dono: "não encaixotar"): mora entre as seções da
  // coluna do perfil na Central, com a mesma divisória fina e o mesmo recolher.
  // Na tela: título, uma linha de estado (idade e versão), as abas em ícone e
  // a parte escolhida; o que cada parte é mora no "?".
  return (
    <Secao
      divisoria
      recolher={`central:perfis:dossie:${clientId}`}
      titulo="Dossiê de contexto"
      descricao={corpo ? <>{idade}{atual?.version != null && <> · v{atual.version}</>}</> : undefined}
      resumo={corpo ? idade : "nenhum dossiê escrito"}
      ajuda="O retrato do cliente que a rotina de contexto e o MCP gravam. As abas em ícone trocam entre o caderno, as versões, a memória, as entregas e os outros dossiês. É a mesma leitura que o Ciclo e a Central usam."
    >
      {/* Abas em ícone e, na mesma linha, as ações em ícone sem borda. */}
      <div className="flex min-w-0 items-center">
        <Etapas
          soIcone
          rotulo="Partes do dossiê"
          className="min-w-0 flex-1"
          itens={abas}
          valor={aba}
          onEscolher={(v) => setAba(v as AbaDoDossie)}
        />
        <div className="ml-2 flex shrink-0 items-center">
          {aba === "caderno" && corpo && caderno.temOQueRecolher && (
            <button
              type="button"
              onClick={caderno.alternarTudo}
              className={botao.icone}
              aria-expanded={caderno.tudoAberto}
              aria-label={caderno.tudoAberto ? "Recolher seções" : "Ler o dossiê inteiro"}
              title={caderno.tudoAberto ? "Recolher seções" : "Ler o dossiê inteiro"}
            >
              {caderno.tudoAberto
                ? <ChevronsDownUp className="h-4 w-4" aria-hidden="true" />
                : <ChevronsUpDown className="h-4 w-4" aria-hidden="true" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => void atualizar()}
            disabled={isFetching}
            className={botao.icone}
            aria-label="Atualizar dossiê"
            title="Atualizar"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* O aviso que mata o "há 2 dias" enganoso: quando existe dossiê mais
          novo em outra chave, este bloco diz isso em vez de deixar o geral
          velho passar por retrato do cliente. Curto, e leva à aba certa. */}
      {irmaoMaisNovo && aba !== "outros" && (
        <p className="mt-2 rounded-md bg-warning/10 px-3 py-1.5 text-[12px] leading-relaxed text-warning">
          O {nomeDoIrmao(irmaoMaisNovo)} foi atualizado em {new Date(String(irmaoMaisNovo.updated_at)).toLocaleDateString("pt-BR")}, depois deste.{" "}
          <button type="button" onClick={() => setAba("outros")} className={juntar("rounded font-medium underline underline-offset-2 hover:no-underline", foco)}>
            Ver
          </button>
        </p>
      )}

      <div className="mt-3 min-w-0">
        {aba === "caderno" && (!corpo ? (
          <EstadoVazio compacto titulo={`Nenhum dossiê escrito para ${clientName || "este cliente"} ainda.`} />
        ) : (
          // O corpo lido como caderno: coluna de leitura confortável, uma
          // linha discreta com a data e a última mudança, e o sumário.
          <div className="mx-auto w-full min-w-0 max-w-[72ch]">
            {(quando || atual?.change_reason) && (
              <p className={juntar(texto.auxiliar, "flex min-w-0 items-baseline text-muted-foreground/80")}>
                {quando && (
                  <span className="shrink-0 tabular-nums" title={`Atualizado em ${new Date(quando).toLocaleString("pt-BR")}`}>
                    atualizado {dataCurta(quando)}
                  </span>
                )}
                {atual?.change_reason && (
                  <span className="ml-1.5 min-w-0 truncate italic" title={`Última mudança: ${atual.change_reason}`}>
                    · {atual.change_reason}
                  </span>
                )}
              </p>
            )}
            <div className="mt-4 min-w-0">
              <CadernoDoDossie caderno={caderno} />
            </div>
          </div>
        ))}

        {aba === "versoes" && (
          <ul className="mx-auto w-full min-w-0 max-w-[72ch] divide-y divide-border/40" aria-label="Histórico de versões">
            {(historico || []).map((v) => (
              <li key={v.id} className="py-2 text-[12px]">
                <div className="flex min-w-0 items-baseline">
                  <span className={juntar(etiqueta, "mr-2", v.is_current ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                    v{v.version}
                  </span>
                  <span className="mr-2 min-w-0 truncate text-foreground/75">
                    {v.change_reason || v.summary || v.source || "sem descrição"}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-muted-foreground/70">
                    {new Date(v.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                  </span>
                </div>
                {(v.entrou || []).length > 0 && (
                  <ul className="ml-9 mt-1 space-y-0.5">
                    {v.entrou!.map((linha, i) => (
                      <li key={i} className="flex min-w-0 text-[12px] leading-snug text-foreground/70">
                        <span className="mr-1.5 shrink-0 font-semibold text-success" aria-hidden="true">+</span>
                        <span className="min-w-0">{linha}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            {!historico && <li className={juntar(texto.auxiliar, "py-2")}>Carregando…</li>}
            {historico && historico.length === 0 && <li className={juntar(texto.auxiliar, "py-2")}>Nenhuma versão gravada.</li>}
          </ul>
        )}

        {aba === "memoria" && <CerebroDoCliente key={clientId} clientId={clientId} somenteMemoria />}

        {/* A outra metade do dossiê: quem é o cliente E o que já foi feito
            para ele. Vem da mesma memória que o Ciclo e a Central leem. O
            bloco traz a própria divisória, que aqui, sozinho na aba, sobra. */}
        {aba === "entregas" && (
          <div className="min-w-0 [&>div:first-child]:mt-0 [&>div:first-child]:border-t-0 [&>div:first-child]:pt-0 [&>p:first-child]:mt-0">
            <EntregasNoDossie clientId={clientId} />
            {!entregasCarregando && <p className={juntar(texto.auxiliar, "hidden only:block")}>Nenhuma entrega registrada.</p>}
          </div>
        )}

        {/* Os outros dossiês atuais: por projeto, ou de outro tipo. Cada um é
            um balde com o próprio "atual"; escondê-los era o que fazia o
            trabalho de todo dia parecer parado. */}
        {aba === "outros" && (
          <ul className="min-w-0 divide-y divide-border/40" aria-label="Outros dossiês atuais">
            {listaDeIrmaos.map((d) => (
              <li key={String(d.id)} className="flex min-w-0 items-baseline py-2 text-[12px]">
                <span className={juntar("mr-2 shrink-0 font-semibold", d === irmaoMaisNovo ? "text-warning" : "text-foreground/80")}>
                  {d.project_id
                    ? `Projeto: ${(d.project as { name?: string } | null)?.name ?? "(sem nome)"}`
                    : `Tipo: ${String(d.dossier_type)}`}
                </span>
                <span className={juntar(etiqueta, "mr-2 bg-primary/10 text-primary")}>
                  v{String(d.version)}
                </span>
                <span className="mr-2 min-w-0 truncate text-foreground/70">
                  {String(d.summary ?? "")}
                </span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground/70">
                  {new Date(String(d.updated_at)).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Secao>
  );
}
