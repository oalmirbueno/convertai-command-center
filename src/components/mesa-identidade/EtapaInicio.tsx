import { useState, type ReactNode } from "react";
import { Loader2, Plus, RefreshCcw, Sparkles } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { Carregando } from "@/components/sistema/Estados";
import { botao, campo, espaco, foco, juntar, lista, superficie, texto } from "@/components/sistema/estilos";
import { etapaAtual, progresso, rotuloDaEtapa, ROTULO_DO_MODO, type EtapaDaIdentidade, type ModoDoProjeto } from "../../../supabase/functions/_shared/identidade-etapas";
import { chamarIdentidade, faltaATabela, useProjetos, type ProjetoDeIdentidade } from "./identidadeApi";
import { Pastilha } from "./Comuns";

/**
 * Etapa 1, Início: marca do zero ou rebranding. Um projeto por marca (a
 * marca aberta no topo); os projetos em andamento ficam na lista para
 * continuar de onde pararam.
 */
export default function EtapaInicio({ projetoAberto, onAbrir }: { projetoAberto: ProjetoDeIdentidade | null; onAbrir: (p: ProjetoDeIdentidade, etapa?: EtapaDaIdentidade) => void }) {
  const { clientId, clientName } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const projetos = useProjetos(clientId, marca ? { id: marca.id, principal: !!marca.principal } : null);
  const [modo, setModo] = useState<ModoDoProjeto | null>(null);
  const [comNaming, setComNaming] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [criando, setCriando] = useState(false);
  const nomeDaMarca = marca && !marca.principal ? marca.nome : clientName;

  const criar = async () => {
    if (!modo) return;
    setCriando(true);
    try {
      const r = await chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("projeto_criar", { client_id: clientId, modo, com_naming: modo === "zero" || comNaming, titulo: titulo.trim() || undefined });
      void qc.invalidateQueries({ queryKey: ["mesa-identidade", "projetos", clientId] });
      onAbrir(r.projeto, "briefing");
    } catch (e) {
      avisarErro(e, "O projeto não foi criado");
    } finally {
      setCriando(false);
    }
  };

  const opcoes: Array<{ valor: ModoDoProjeto; icone: ReactNode; detalhe: string }> = [
    { valor: "zero", icone: <Sparkles className="h-5 w-5" />, detalhe: "Nome, conceito, logo e manual" },
    { valor: "rebranding", icone: <RefreshCcw className="h-5 w-5" />, detalhe: "Evoluir a marca que já existe" },
  ];

  const listaDeProjetos = projetos.data || [];

  return (
    <div className={espaco.pagina} data-etapa-inicio="">
      <Secao
        titulo={`Nova identidade para ${nomeDaMarca || "o cliente"}`}
        recolher={false}
        ajuda="Marca do zero passa por todas as etapas, inclusive o Naming. No rebranding, o Naming só entra quando o nome também muda. O projeto fica na marca aberta no topo (Acerbi e CME não se misturam)."
      >
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2" role="radiogroup" aria-label="Tipo de projeto">
          {opcoes.map((o) => (
            <button
              key={o.valor}
              type="button"
              role="radio"
              aria-checked={modo === o.valor}
              onClick={() => setModo(o.valor)}
              className={juntar(superficie.painel, "flex min-w-0 items-center p-4 text-left transition-colors hover:border-primary/50", modo === o.valor && "border-primary", foco)}
              data-modo={o.valor}
            >
              <span className="mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">{o.icone}</span>
              <span className="min-w-0">
                <span className={juntar(texto.tituloSecao, "block truncate")}>{ROTULO_DO_MODO[o.valor]}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>{o.detalhe}</span>
              </span>
            </button>
          ))}
        </div>
        {modo && (
          <div className="mt-4 grid min-w-0 grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <CampoDeFormulario rotulo="Nome do projeto" apoio="Opcional">
              <input className={campo} value={titulo} maxLength={120} onChange={(e) => setTitulo(e.target.value)} placeholder={`${ROTULO_DO_MODO[modo]}: ${nomeDaMarca}`} />
            </CampoDeFormulario>
            <div className="flex min-w-0 items-center">
              {modo === "rebranding" && (
                <label className={juntar(texto.corpo, "mr-4 flex items-center")}>
                  <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={comNaming} onChange={(e) => setComNaming(e.target.checked)} />
                  O nome também muda
                </label>
              )}
              <button type="button" className={botao.primario} onClick={() => void criar()} disabled={criando} data-criar-projeto="">
                {criando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />} Começar
              </button>
            </div>
          </div>
        )}
      </Secao>

      <Secao titulo="Projetos da marca" descricao={projetos.isSuccess ? `${listaDeProjetos.length} em andamento` : undefined} divisoria>
        {projetos.isLoading && <Carregando forma="lista" linhas={2} rotulo="Lendo os projetos" />}
        {projetos.isError && (
          <p className={juntar(texto.auxiliar, "text-warning")} role="alert">
            {faltaATabela(projetos.error) ? "O banco ainda não tem as tabelas da Mesa Identidade." : "Não foi possível ler os projetos."}
          </p>
        )}
        {projetos.isSuccess && !listaDeProjetos.length && <p className={texto.auxiliar}>Nenhum projeto ainda.</p>}
        {listaDeProjetos.length > 0 && (
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Projetos de identidade">
            {listaDeProjetos.map((p) => {
              const a = progresso(p);
              const atual = etapaAtual(p);
              return (
                <li key={p.id}>
                  <button type="button" className={juntar(lista.linha, "w-full text-left", projetoAberto && projetoAberto.id === p.id && lista.destaque, foco)} onClick={() => onAbrir(p)}>
                    <span className="min-w-0 flex-1">
                      <span className={juntar(texto.corpo, "block truncate font-medium")}>{p.titulo}</span>
                      <span className={juntar(texto.auxiliar, "block truncate")}>
                        {ROTULO_DO_MODO[p.modo]} · {p.estado === "entregue" ? "entregue" : `em ${rotuloDaEtapa(atual)}`} · {a.feitas} de {a.total} etapas
                      </span>
                    </span>
                    {p.estado === "entregue" ? <Pastilha tom="bom">Entregue</Pastilha> : <Pastilha>{rotuloDaEtapa(atual)}</Pastilha>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Secao>
    </div>
  );
}
