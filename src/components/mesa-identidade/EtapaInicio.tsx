import { lazy, Suspense, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ImagePlus, Loader2, Plus, RefreshCcw, Sparkles, Stamp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useKitDaMarca } from "@/components/mesa/kitDaMesa";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { Carregando } from "@/components/sistema/Estados";
import { botao, campo, espaco, foco, juntar, lista, superficie, texto } from "@/components/sistema/estilos";
import { etapaAtual, progresso, rotuloDaEtapa, ROTULO_DO_MODO, type EtapaDaIdentidade, type ModoDoProjeto } from "../../../supabase/functions/_shared/identidade-etapas";
import { chamarIdentidade, faltaATabela, useProjetos, type ProjetoDeIdentidade } from "./identidadeApi";
import { Pastilha, ProjetoProvider, type ProjetoDaMesa } from "./Comuns";
import { enviarLogo, extensaoDe, motivoParaRecusarLogo, TIPOS_DE_LOGO } from "./arquivosDaMarca";

// O checklist e o "Completar tudo" (IDV3) só baixam com um projeto aberto.
const CompletarMarca = lazy(() => import("./CompletarMarca"));

/** A logo do kit da marca aberta como arquivo (entra no projeto pela mesma porta do envio). */
async function arquivoDaLogoDoKit(caminho: string | null | undefined, fileId: string | null | undefined): Promise<File | null> {
  let bucket = "mesa";
  let path = caminho || "";
  if (!path && fileId) {
    const { data } = await (supabase as any).from("files").select("storage_bucket, storage_path").eq("id", fileId).maybeSingle();
    if (!data || !data.storage_path) return null;
    bucket = data.storage_bucket || "files";
    path = data.storage_path;
  }
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) return null;
  const ext = extensaoDe(path) || "png";
  if (!TIPOS_DE_LOGO[ext]) return null;
  return new File([data], `logo.${ext}`, { type: TIPOS_DE_LOGO[ext] });
}

/**
 * Etapa 1, Início: marca do zero, rebranding ou completar marca existente
 * (IDV3: só tem logo e nome). Um projeto por marca (a marca aberta no topo);
 * os projetos em andamento ficam na lista para continuar de onde pararam.
 * Com um projeto aberto, o checklist de completude e o "Completar tudo".
 */
export default function EtapaInicio({ projetoAberto, contexto, onAbrir }: { projetoAberto: ProjetoDeIdentidade | null; contexto?: ProjetoDaMesa | null; onAbrir: (p: ProjetoDeIdentidade, etapa?: EtapaDaIdentidade, extra?: Record<string, string | null>) => void }) {
  const { clientId, clientName } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const [params, setParams] = useSearchParams();
  const projetos = useProjetos(clientId, marca ? { id: marca.id, principal: !!marca.principal } : null);
  const kit = useKitDaMarca(clientId, marca ? marca.id : null);
  const [modo, setModo] = useState<ModoDoProjeto | null>(null);
  const [comNaming, setComNaming] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [criando, setCriando] = useState(false);
  const nomeDaMarca = marca && !marca.principal ? marca.nome : clientName;
  const [nomeExistente, setNomeExistente] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const entrada = useRef<HTMLInputElement | null>(null);
  const logoDoKit = kit.kit && (kit.kit.logo_path || kit.kit.logo_file_id) ? { caminho: kit.kit.logo_path || null, fileId: kit.kit.logo_file_id || null } : null;

  const criar = async () => {
    if (!modo) return;
    setCriando(true);
    try {
      if (modo === "completar") {
        // Entrada mínima: a logo (arquivo real, do kit ou enviada) e o nome.
        const logo = arquivo || (logoDoKit ? await arquivoDaLogoDoKit(logoDoKit.caminho, logoDoKit.fileId) : null);
        if (!logo) throw new Error("Envie a logo (SVG, PNG, JPG ou WEBP) ou ponha a logo no kit da marca.");
        const motivo = motivoParaRecusarLogo(logo);
        if (motivo) throw new Error(motivo);
        const criado = await chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("projeto_criar", { client_id: clientId, modo, nome: (nomeExistente.trim() || nomeDaMarca || "").slice(0, 80), titulo: titulo.trim() || undefined });
        const principal = await enviarLogo(clientId, criado.projeto.id, logo, "principal", "");
        const salvo = await chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("projeto_salvar", { projeto_id: criado.projeto.id, versao: criado.projeto.versao, parte: "sistema", valor: { logos: { principal, secundario: null, alternativas: [], icone: [] } } });
        void qc.invalidateQueries({ queryKey: ["mesa-identidade", "projetos", clientId] });
        onAbrir(salvo.projeto, "inicio", { completar: "1" });
        return;
      }
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
    { valor: "completar", icone: <Stamp className="h-5 w-5" />, detalhe: "Só tem logo e nome: o resto sai daqui" },
  ];

  const listaDeProjetos = projetos.data || [];

  return (
    <div className={espaco.pagina} data-etapa-inicio="">
      <Secao
        titulo={`Nova identidade para ${nomeDaMarca || "o cliente"}`}
        recolher={false}
        ajuda="Marca do zero passa por todas as etapas, inclusive o Naming. No rebranding, o Naming só entra quando o nome também muda. Completar marca existente parte da logo e do nome que a marca já usa: a logo não muda, o painel completa estratégia, paleta, tipografia, grafismos, peças, mockups, brandbook, apresentação e vídeo. O projeto fica na marca aberta no topo (Acerbi e CME não se misturam)."
      >
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3" role="radiogroup" aria-label="Tipo de projeto">
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
        {modo === "completar" && (
          <div className="mt-4 grid min-w-0 grid-cols-1 items-end gap-4 sm:grid-cols-2" data-entrada-da-marca-existente="">
            <CampoDeFormulario rotulo="Nome da marca" apoio="Como a marca já se chama">
              <input className={campo} value={nomeExistente} maxLength={80} onChange={(e) => setNomeExistente(e.target.value)} placeholder={nomeDaMarca || "Nome"} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Logo" apoio={arquivo ? arquivo.name : logoDoKit ? "A do kit da marca" : "Arquivo real, SVG de preferência"}>
              <input
                ref={entrada}
                type="file"
                accept=".svg,.png,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  if (f) setArquivo(f);
                  e.target.value = "";
                }}
              />
              <button type="button" className={juntar(botao.secundario, "w-full")} onClick={() => entrada.current && entrada.current.click()} data-enviar-logo-existente="">
                <ImagePlus className="mr-1.5 h-4 w-4" /> {arquivo ? "Trocar o arquivo" : logoDoKit ? "Usar outro arquivo" : "Enviar a logo"}
              </button>
            </CampoDeFormulario>
          </div>
        )}
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

      {projetoAberto && contexto && (
        <ProjetoProvider valor={contexto}>
          <Suspense fallback={<Carregando forma="lista" linhas={3} rotulo="Lendo a completude da marca" />}>
            <CompletarMarca
              abrirJa={params.get("completar") === "1"}
              onAberto={() => {
                const next = new URLSearchParams(params);
                next.delete("completar");
                setParams(next, { replace: true });
              }}
            />
          </Suspense>
        </ProjetoProvider>
      )}

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
