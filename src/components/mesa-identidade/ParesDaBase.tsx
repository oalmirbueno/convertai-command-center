import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, ExternalLink, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useAvisarErro } from "@/components/mesa/Custo";
import { EstadoDeErro, Carregando } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { CREDITO_DA_BASE } from "@/lib/uiux/carregar";
import { linkDaFamilia } from "../../../supabase/functions/_shared/tipografia-da-marca";
import { lerBaseDaMarca } from "../../../supabase/functions/_shared/uiux/consultas";
import { chamarIdentidade, type ProjetoDeIdentidade } from "./identidadeApi";
import { Pastilha, useProjetoDaMesa } from "./Comuns";
import { ProdutoDaMarca } from "./PaletaDoSetor";
import { PrevisaoDoPar, type TipoDoSistema } from "./TipoEGrafismos";

type ParDaLista = { no: string; id: string; nome: string; titulo: string; texto: string; humor: string; melhor_para: string; encaixe: number; licencas: string[]; da_casa: boolean };

const POR_PAGINA = 6;

/**
 * Pares da base UI UX Pro Max (frente UXM), ao lado dos 24 da casa: 74 pares
 * (sem os de escrita não latina), ordenados pelo tipo de produto e pela
 * personalidade da estratégia, todos com famílias OFL ou Apache e o
 * subconjunto latino. Prévia real sob demanda. "Usar" troca as famílias do
 * sistema (com Desfazer); "Usar como proposta" guarda nas propostas de fonte
 * com a origem da base.
 */
export default function ParesDaBase({ tipos, onUsar }: { tipos: TipoDoSistema[]; onUsar: (novos: TipoDoSistema[], origem: string) => void }) {
  const { projeto, guardar } = useProjetoDaMesa();
  const avisarErro = useAvisarErro();
  const base = lerBaseDaMarca(((projeto.dados.sistema || {}) as Record<string, unknown>).base_de_design);
  const [aberto, setAberto] = useEstadoDaTela<boolean>(`mesa-identidade:${projeto.id}:pares-da-base`, false, { validar: (v): v is boolean => typeof v === "boolean" });
  const [pagina, setPagina] = useState(1);
  const [propondo, setPropondo] = useState<string | null>(null);
  const marca = (projeto.dados.naming && projeto.dados.naming.nome) || "";
  const q = useQuery({
    queryKey: ["mesa-identidade", "pares-da-base", projeto.id, base.produto ? base.produto.id : null, projeto.versao],
    queryFn: () => chamarIdentidade<{ pares: ParDaLista[]; total: number; produto: { rotulo: string } | null }>("pares_da_base", { projeto_id: projeto.id, produto: base.produto ? base.produto.id : undefined }),
    enabled: aberto,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const usar = (p: ParDaLista) => {
    const licenca = (l: string) => (l === "Apache" ? "Google Fonts (Apache 2.0)" : "Google Fonts (OFL)");
    const novos: TipoDoSistema[] = [{ familia: p.titulo, uso: "titulo", pesos: "", licenca: licenca(p.licencas[0]), alternativa: "" }];
    if (p.texto !== p.titulo) novos.push({ familia: p.texto, uso: "texto", pesos: "", licenca: licenca(p.licencas[1]), alternativa: "" });
    onUsar(novos.concat(tipos.filter((y) => y.uso === "apoio")), `base ${p.id}`);
  };

  const propor = async (p: ParDaLista) => {
    setPropondo(p.no);
    try {
      const d = await chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("base_proposta", { projeto_id: projeto.id, tipo: "fonte", par: p.no });
      guardar(d && d.projeto);
      toast.success("Par guardado nas propostas de fonte");
    } catch (e) {
      avisarErro(e, "A proposta não foi guardada");
    } finally {
      setPropondo(null);
    }
  };

  const pares = q.data ? q.data.pares : [];
  return (
    <div className="mt-6 min-w-0 border-t border-border pt-5" data-pares-da-base="">
      <div className="mb-2 flex min-w-0 items-center">
        <button type="button" className={juntar(botao.discreto, "relative -left-1 px-1")} aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
          {aberto ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
          <span className={texto.rotulo}>Pares da base</span>
        </button>
        <span className={juntar(texto.auxiliar, "ml-1 min-w-0 truncate")} title={CREDITO_DA_BASE}>
          {q.data ? `${q.data.total} pares${q.data.produto ? ` · ${q.data.produto.rotulo}` : ""}` : "OFL ou Apache"}
        </span>
      </div>
      {aberto && (
        <div className="min-w-0 space-y-3">
          <ProdutoDaMarca />
          {q.isLoading && <Carregando forma="lista" rotulo="Carregando os pares da base" />}
          {q.error && <EstadoDeErro titulo="Os pares da base não abriram" descricao={textoDoErro(q.error)} acao={<button type="button" className={botao.secundario} onClick={() => void q.refetch()}>Tentar de novo</button>} />}
          {pares.length > 0 && (
            <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Pares da base">
              {pares.slice(0, pagina * POR_PAGINA).map((p) => (
                <li key={p.no} className={juntar(lista.linha, "items-start")} data-par-da-base={p.no}>
                  <span className="min-w-0 flex-1">
                    <PrevisaoDoPar titulo={p.titulo} texto={p.texto} nome={p.nome} marca={marca} ativo />
                    <span className="mt-1 flex min-w-0 flex-wrap items-center">
                      <span className={juntar(texto.auxiliar, "mr-2")}>
                        {p.nome}: {p.titulo} + {p.texto}
                      </span>
                      {p.encaixe > 0 && <Pastilha tom="bom">combina</Pastilha>}
                      {p.da_casa && <Pastilha>também no catálogo da casa</Pastilha>}
                      <a className={juntar(texto.etiqueta, "ml-2 inline-flex items-center text-muted-foreground hover:text-foreground")} href={linkDaFamilia(p.titulo)} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="mr-0.5 h-3 w-3" /> Google Fonts
                      </a>
                    </span>
                  </span>
                  <button type="button" className={juntar(botao.discreto, "ml-2 h-8 shrink-0")} disabled={propondo === p.no} onClick={() => void propor(p)} title="Guardar nas propostas de fonte">
                    {propondo === p.no ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" />}
                    Proposta
                  </button>
                  <button type="button" className={juntar(botao.discreto, "ml-1 h-8 shrink-0")} onClick={() => usar(p)} title={p.melhor_para}>
                    <Check className="mr-1.5 h-3.5 w-3.5" /> Usar
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pagina * POR_PAGINA < pares.length && (
            <button type="button" className={botao.discreto} onClick={() => setPagina(pagina + 1)}>
              Mais pares
            </button>
          )}
        </div>
      )}
    </div>
  );
}
