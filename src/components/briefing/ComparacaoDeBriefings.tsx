import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CabecalhoDePagina, Carregando, EstadoDeErro, EstadoVazio, SeletorCompacto, botao, etiqueta, juntar, lista, texto } from "@/components/sistema";
import { CAMPOS_DA_LEITURA, type LinhaDoBriefingNoPainel, nomeDoBriefing } from "./LeituraDoBriefing";
import { type AnexoDoBriefing, modeloDoLink } from "../../../supabase/functions/_shared/briefing-modelos";
import { compararBriefings } from "../../../supabase/functions/briefing-agente/modulos/briefing-editor";

/**
 * Comparar dois briefings (frente BRF2, 30/09/2026): o mesmo cliente em dois
 * momentos (o diagnóstico e o de site, o de antes e o reaberto) ou dois
 * clientes do mesmo serviço. Pergunta por pergunta, lado a lado, com o que
 * mudou em destaque. Só leitura.
 */

type Lado = { b: LinhaDoBriefingNoPainel; anexos: AnexoDoBriefing[] };

async function lerLado(id: string): Promise<Lado | null> {
  const { data, error } = await supabase.from("briefings").select(CAMPOS_DA_LEITURA).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: anexos, error: e2 } = await supabase.from("briefing_anexos" as any).select("id, campo, categoria, nome, tamanho, mime").eq("briefing_id", id).eq("status", "pronto").is("arquivado_em", null);
  if (e2) throw e2;
  return { b: data as unknown as LinhaDoBriefingNoPainel, anexos: (anexos as unknown as AnexoDoBriefing[]) || [] };
}

const quando = (b: LinhaDoBriefingNoPainel) => {
  const iso = b.enviado_em || b.created_at;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

export default function ComparacaoDeBriefings({ ids, onVoltar }: { ids: [string, string]; onVoltar: () => void }) {
  const [filtro, setFiltro] = useState<"diferencas" | "todas">("diferencas");
  const consulta = useQuery({
    queryKey: ["briefing-comparar", ids[0], ids[1]],
    queryFn: async () => Promise.all([lerLado(ids[0]), lerLado(ids[1])]),
  });
  const [a, b] = consulta.data || [null, null];
  const linhas = useMemo(() => {
    if (!a || !b) return [];
    return compararBriefings(
      { modelo: modeloDoLink(a.b.modelo, a.b.modelo_conteudo), respostas: (a.b.responses || {}) as Record<string, unknown>, anexos: a.anexos },
      { modelo: modeloDoLink(b.b.modelo, b.b.modelo_conteudo), respostas: (b.b.responses || {}) as Record<string, unknown>, anexos: b.anexos },
    );
  }, [a, b]);
  const diferentes = linhas.filter((l) => !l.igual);
  const mostradas = filtro === "diferencas" ? diferentes : linhas;

  if (consulta.isLoading) return <Carregando forma="aba" rotulo="Abrindo os dois briefings" />;
  if (consulta.isError || !a || !b) {
    return <EstadoDeErro titulo="Não foi possível abrir os dois briefings." acao={<button type="button" onClick={onVoltar} className={botao.secundario}>Voltar</button>} />;
  }
  const rotuloA = `${nomeDoBriefing(a.b)} · ${modeloDoLink(a.b.modelo, a.b.modelo_conteudo).nome} · ${quando(a.b)}`;
  const rotuloB = `${nomeDoBriefing(b.b)} · ${modeloDoLink(b.b.modelo, b.b.modelo_conteudo).nome} · ${quando(b.b)}`;

  return (
    <div className="min-w-0 space-y-4" data-comparacao-de-briefings="">
      <CabecalhoDePagina
        nivel={2}
        titulo="Comparar briefings"
        descricao={`${diferentes.length} ${diferentes.length === 1 ? "diferença" : "diferenças"} em ${linhas.length} perguntas`}
        ajuda="Pergunta por pergunta, lado a lado. As que mudaram ficam marcadas. Perguntas que nenhum dos dois respondeu não aparecem."
        acoes={
          <SeletorCompacto
            rotulo="Mostrar"
            valor={filtro}
            onEscolher={(v) => setFiltro(v as "diferencas" | "todas")}
            opcoes={[
              { valor: "diferencas", rotulo: "Só diferenças" },
              { valor: "todas", rotulo: "Todas" },
            ]}
          />
        }
      />
      <div className="hidden min-w-0 grid-cols-2 gap-x-6 sm:grid">
        <p className={juntar(texto.rotulo, "truncate")}>A: {rotuloA}</p>
        <p className={juntar(texto.rotulo, "truncate")}>B: {rotuloB}</p>
      </div>
      {!mostradas.length ? (
        <EstadoVazio titulo={filtro === "diferencas" ? "Nenhuma diferença." : "Nenhuma resposta para comparar."} />
      ) : (
        <ul className={juntar(lista.aberta, lista.divisoria)}>
          {mostradas.map((l) => (
            <li key={l.key} className="min-w-0 px-2 py-3" data-igual={l.igual ? "sim" : "nao"}>
              <div className="flex min-w-0 items-center">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{l.pergunta}</span>
                {!l.igual && <span className={juntar(etiqueta, "ml-2 bg-amber-500/15 text-amber-700 dark:text-amber-300")}>mudou</span>}
              </div>
              {l.bloco && <span className={juntar(texto.auxiliar, "block truncate")}>{l.bloco}</span>}
              <div className="mt-1.5 grid min-w-0 grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                <p className={juntar(texto.corpo, "min-w-0 whitespace-pre-line [overflow-wrap:anywhere]", !l.a && "text-muted-foreground")}>
                  <span className={juntar(texto.rotulo, "mr-1.5 sm:hidden")}>A</span>
                  {l.a || "sem resposta"}
                </p>
                <p className={juntar(texto.corpo, "min-w-0 whitespace-pre-line [overflow-wrap:anywhere]", !l.b && "text-muted-foreground")}>
                  <span className={juntar(texto.rotulo, "mr-1.5 sm:hidden")}>B</span>
                  {l.b || "sem resposta"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
