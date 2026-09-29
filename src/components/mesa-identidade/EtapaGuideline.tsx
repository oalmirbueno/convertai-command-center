import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, FileText, Globe2, Link2Off, Loader2, Package, RefreshCcw, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { copiarTexto } from "@/components/mesa/ContextoPaleta";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import MenuMais from "@/components/sistema/MenuMais";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { Carregando } from "@/components/sistema/Estados";
import { botao, campo, campoTexto, espaco, juntar, lista, texto } from "@/components/sistema/estilos";
import { estadoDoModelo, imagensDoBrandbook, lacunasDoBrandbook, MODELOS_DE_BRANDBOOK, type DadosDoBrandbook, type ModeloDoBrandbook } from "../../../supabase/functions/_shared/brandbook";
import { chamarIdentidade, CHAVES, textoDaAprovacao, useBrandbooks, useSituacaoDoArquivo, type ProjetoDeIdentidade, type VersaoDoBrandbook } from "./identidadeApi";
import { CabecalhoDaEtapa, Pastilha, useProjetoDaMesa } from "./Comuns";
import { pacoteDaMarca, pdfDoBrandbook, salvarArquivo } from "./exportarNoNavegador";
import VisaoDoBrandbook from "./VisaoDoBrandbook";

/** URLs assinadas (1 hora) de várias imagens do bucket mesa, de uma vez. */
function useUrlsAssinadas(caminhos: string[]) {
  const chave = caminhos.slice().sort().join("|");
  return useQuery({
    queryKey: ["mesa-identidade", "urls", chave],
    enabled: caminhos.length > 0,
    staleTime: 45 * 60_000,
    gcTime: 55 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage.from("mesa").createSignedUrls(caminhos, 3600);
      if (error) throw error;
      const mapa: Record<string, string> = {};
      (data || []).forEach((d: { path: string | null; signedUrl: string }) => {
        if (d.path && d.signedUrl) mapa[d.path] = d.signedUrl;
      });
      return mapa;
    },
  });
}

const linhas = (v: string) => v.split(/\n+/).map((x) => x.trim()).filter(Boolean);

/**
 * Etapa 8, Guideline: o brandbook no modelo que o dono escolher (prancha-resumo
 * vertical ou 24 páginas), como JSON versionado. Cada salvar é uma versão.
 * Exporta o PDF (o mesmo da aprovação), o pacote da marca (.zip com logos,
 * cores e fontes) e a página pública por link (revogável).
 */
export default function EtapaGuideline() {
  const mesa = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, guardar } = useProjetoDaMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const versoesQ = useBrandbooks(projeto.id);
  const guideline = (projeto.dados.guideline || {}) as { brandbook_id?: string; modelo?: ModeloDoBrandbook };
  const [modelo, setModelo] = useState<ModeloDoBrandbook>(guideline.modelo === "prancha" ? "prancha" : "paginado");
  const [aberta, setAberta] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const versoes = versoesQ.data || [];
  const atual: VersaoDoBrandbook | null = versoes.filter((v) => v.id === (aberta || guideline.brandbook_id))[0] || versoes[0] || null;
  const [rascunho, setRascunho] = useState<DadosDoBrandbook | null>(null);
  const situacao = useSituacaoDoArquivo(atual ? atual.arquivo_pdf_id : null);

  useEffect(() => {
    setRascunho(atual ? atual.dados : null);
    if (atual) setModelo(atual.modelo);
  }, [atual ? atual.id : null]);

  const dados = rascunho || (atual ? atual.dados : null);
  const imagens = useMemo(() => (dados ? imagensDoBrandbook(dados).filter((c) => !/^data:/.test(c)) : []), [dados]);
  const urls = useUrlsAssinadas(imagens);
  const urlDe = (c: string | null | undefined) => (c && urls.data ? urls.data[c] || null : null);
  const mudou = !!(rascunho && atual && JSON.stringify(rascunho) !== JSON.stringify(atual.dados)) || !!(atual && modelo !== atual.modelo);

  const rodar = async (qual: string, fn: () => Promise<void>, titulo = "Não foi possível concluir") => {
    setOcupado(qual);
    try {
      await fn();
    } catch (e) {
      avisarErro(e, titulo);
    } finally {
      setOcupado(null);
    }
  };

  const depoisDeGravar = (r: { brandbook?: VersaoDoBrandbook; projeto?: ProjetoDeIdentidade; lacunas?: string[] }) => {
    if (r.projeto) guardar(r.projeto);
    void qc.invalidateQueries({ queryKey: CHAVES.brandbooks(projeto.id) });
    if (r.brandbook) setAberta(r.brandbook.id);
    if (r.lacunas && r.lacunas.length) toast.info(`Ainda falta: ${r.lacunas.slice(0, 4).join(", ")}${r.lacunas.length > 4 ? "..." : ""}`);
  };

  const montar = () => rodar("montar", async () => depoisDeGravar(await chamarIdentidade("brandbook_montar", { projeto_id: projeto.id, modelo })), "O brandbook não foi montado");
  const salvarVersao = () => rodar("salvar", async () => {
    if (!atual || !rascunho) return;
    depoisDeGravar(await chamarIdentidade("brandbook_salvar", { brandbook_id: atual.id, dados: rascunho, modelo }));
    toast.success("Versão nova salva");
  }, "A versão não foi salva");

  const mexer = (fn: (d: DadosDoBrandbook) => DadosDoBrandbook) => setRascunho((d) => (d ? fn(d) : d));

  const estado = dados ? estadoDoModelo(modelo, dados) : [];
  const prontas = estado.filter((p) => p.pronta).length;
  const lacunas = dados ? lacunasDoBrandbook(modelo, dados) : [];
  const publicado = atual && atual.token_publico && !atual.revogado_em ? `${window.location.origin}/marca/${atual.token_publico}` : null;

  return (
    <div className={espaco.pagina} data-etapa-guideline="">
      <CabecalhoDaEtapa
        etapa="guideline"
        ajuda="Escolha o modelo: a prancha-resumo (uma página longa, boa para o grupo) ou o brandbook de 24 páginas. O conteúdo sai do projeto e fica como JSON versionado: cada Salvar é uma versão nova. O PDF, o pacote e a página pública usam a versão aberta."
        acoes={
          <SeletorCompacto
            rotulo="Modelo do brandbook"
            valor={modelo}
            onEscolher={(v) => setModelo(v === "prancha" ? "prancha" : "paginado")}
            opcoes={MODELOS_DE_BRANDBOOK.map((m) => ({ valor: m.valor, rotulo: m.valor === "prancha" ? "Prancha" : "24 páginas", descricao: m.descricao }))}
            className="m-1"
          />
        }
      />

      {versoesQ.isLoading && <Carregando forma="lista" linhas={3} rotulo="Lendo o brandbook" />}

      {!versoesQ.isLoading && !atual && (
        <Secao titulo="Montar o brandbook" recolher={false}>
          <p className={juntar(texto.corpo, "mb-3")}>O primeiro rascunho sai do briefing, do conceito escolhido e do sistema.</p>
          <button type="button" className={botao.primario} onClick={() => void montar()} disabled={ocupado === "montar"} data-montar-brandbook="">
            {ocupado === "montar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />} Montar brandbook
          </button>
        </Secao>
      )}

      {atual && dados && (
        <>
          <Secao
            titulo={`Versão ${atual.versao}`}
            descricao={`${prontas} de ${estado.length} ${modelo === "prancha" ? "seções" : "páginas"} prontas · ${atual.arquivo_pdf_id ? textoDaAprovacao(situacao.data) : "não enviado"}`}
            recolher={`mesa-identidade:${projeto.id}:guideline:versao`}
            acao={
              <>
                {versoes.length > 1 && (
                  <select className={juntar(campo, "m-1 h-8 w-auto")} value={atual.id} onChange={(e) => setAberta(e.target.value)} aria-label="Versão do brandbook">
                    {versoes.map((v) => (
                      <option key={v.id} value={v.id}>
                        Versão {v.versao} · {v.modelo === "prancha" ? "prancha" : "24 páginas"}
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" className={juntar(mudou ? botao.primario : botao.secundario, "m-1 h-8")} disabled={!mudou || ocupado === "salvar"} onClick={() => void salvarVersao()}>
                  {ocupado === "salvar" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />} Salvar versão
                </button>
                <MenuMais
                  className="m-1"
                  rotulo="Mais ações do brandbook"
                  itens={[
                    { rotulo: "Montar de novo do projeto", icone: <RefreshCcw className="h-4 w-4" />, aoEscolher: () => void montar(), dica: "Versão nova com o que o projeto tem agora" },
                    publicado && { rotulo: "Tirar a página do ar", icone: <Link2Off className="h-4 w-4" />, perigo: true, aoEscolher: () => void rodar("revogar", async () => {
                      await chamarIdentidade("brandbook_revogar", { brandbook_id: atual.id });
                      void qc.invalidateQueries({ queryKey: CHAVES.brandbooks(projeto.id) });
                      toast.success("Página fora do ar");
                    }) },
                  ]}
                />
              </>
            }
          >
            {lacunas.length > 0 && <p className={juntar(texto.auxiliar, "mb-3 text-warning")}>Falta: {lacunas.join(", ")}.</p>}
            <div className="-m-1 flex min-w-0 flex-wrap items-center">
              <button type="button" className={juntar(botao.secundario, "m-1")} disabled={!!ocupado} onClick={() => void rodar("pdf", async () => {
                const r = await pdfDoBrandbook(dados, modelo, atual.versao);
                salvarArquivo(r.bytes, r.nome, "application/pdf");
                if (r.semImagem) toast.warning(`${r.semImagem} imagem(ns) ficaram fora do PDF.`);
              }, "O PDF não saiu")}>
                {ocupado === "pdf" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />} Baixar PDF
              </button>
              <button type="button" className={juntar(botao.secundario, "m-1")} disabled={!!ocupado} onClick={() => void rodar("pacote", async () => {
                const pdf = await pdfDoBrandbook(dados, modelo, atual.versao).catch(() => null);
                const r = await pacoteDaMarca({ clientId: mesa.clientId, marcaId: projeto.marca_id || (marca && !marca.principal ? marca.id : null), dados, modelo, versao: atual.versao, pdf: pdf ? { bytes: pdf.bytes, nome: pdf.nome } : null });
                salvarArquivo(r.blob, r.nome, "application/zip");
                if (r.fora.length) toast.warning(`Ficaram fora do pacote: ${r.fora.slice(0, 3).join(", ")}`);
              }, "O pacote não saiu")}>
                {ocupado === "pacote" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Package className="mr-1.5 h-4 w-4" />} Baixar pacote
              </button>
              <button type="button" className={juntar(botao.secundario, "m-1")} disabled={!!ocupado || mudou || !dados.logos.principal} title={!dados.logos.principal ? "Falta a logo principal" : mudou ? "Salve a versão antes" : undefined} onClick={() => void rodar("aprovar", async () => {
                const r = await chamarIdentidade<{ file_id: string; revisao_solicitada: boolean; aviso: string | null; projeto?: ProjetoDeIdentidade }>("brandbook_compartilhar", { brandbook_id: atual.id });
                if (r.projeto) guardar(r.projeto);
                void qc.invalidateQueries({ queryKey: CHAVES.brandbooks(projeto.id) });
                toast.success("Brandbook em Arquivos", { description: r.revisao_solicitada ? "Revisão da agência pedida." : r.aviso || undefined });
              }, "O brandbook não foi enviado")}>
                {ocupado === "aprovar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />} Enviar para aprovação
              </button>
              <button type="button" className={juntar(botao.secundario, "m-1")} disabled={!!ocupado || mudou} onClick={() => void rodar("publicar", async () => {
                const r = await chamarIdentidade<{ caminho: string; imagens_fora: string[] }>("brandbook_publicar", { brandbook_id: atual.id });
                void qc.invalidateQueries({ queryKey: CHAVES.brandbooks(projeto.id) });
                const link = `${window.location.origin}${r.caminho}`;
                await copiarTexto(link);
                toast.success("Página publicada e link copiado", { description: r.imagens_fora && r.imagens_fora.length ? `Imagens fora (grandes demais): ${r.imagens_fora.length}` : link });
              }, "A página não foi publicada")}>
                {ocupado === "publicar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Globe2 className="mr-1.5 h-4 w-4" />} {publicado ? "Atualizar página" : "Publicar página"}
              </button>
              {publicado && (
                <button type="button" className={juntar(botao.discreto, "m-1")} onClick={() => void copiarTexto(publicado).then((ok) => (ok ? toast.success("Link copiado") : toast.error("Não deu para copiar")))}>
                  <Copy className="mr-1.5 h-4 w-4" /> Copiar link
                </button>
              )}
            </div>
          </Secao>

          <Secao titulo="Conteúdo" divisoria recolher={`mesa-identidade:${projeto.id}:guideline:conteudo`} recolhidaDeInicio>
            <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
              <CampoDeFormulario rotulo="Nome da marca">
                <input className={campo} value={dados.marca.nome} maxLength={80} onChange={(e) => mexer((d) => ({ ...d, marca: { ...d.marca, nome: e.target.value } }))} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Slogan">
                <input className={campo} value={dados.marca.slogan} maxLength={160} onChange={(e) => mexer((d) => ({ ...d, marca: { ...d.marca, slogan: e.target.value } }))} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Propósito" largo>
                <textarea className={juntar(campoTexto, "min-h-[60px]")} value={dados.plataforma.proposito} maxLength={600} onChange={(e) => mexer((d) => ({ ...d, plataforma: { ...d.plataforma, proposito: e.target.value } }))} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Missão">
                <textarea className={juntar(campoTexto, "min-h-[60px]")} value={dados.plataforma.missao} maxLength={600} onChange={(e) => mexer((d) => ({ ...d, plataforma: { ...d.plataforma, missao: e.target.value } }))} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Visão">
                <textarea className={juntar(campoTexto, "min-h-[60px]")} value={dados.plataforma.visao} maxLength={600} onChange={(e) => mexer((d) => ({ ...d, plataforma: { ...d.plataforma, visao: e.target.value } }))} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Valores" apoio="Um por linha">
                <textarea className={juntar(campoTexto, "min-h-[72px]")} value={dados.plataforma.valores.join("\n")} onChange={(e) => mexer((d) => ({ ...d, plataforma: { ...d.plataforma, valores: linhas(e.target.value) } }))} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Personalidade" apoio="Um por linha">
                <textarea className={juntar(campoTexto, "min-h-[72px]")} value={dados.plataforma.personalidade.join("\n")} onChange={(e) => mexer((d) => ({ ...d, plataforma: { ...d.plataforma, personalidade: linhas(e.target.value) } }))} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Como a marca fala" apoio="Um por linha">
                <textarea className={juntar(campoTexto, "min-h-[72px]")} value={dados.tom.como_fala.join("\n")} onChange={(e) => mexer((d) => ({ ...d, tom: { ...d.tom, como_fala: linhas(e.target.value) } }))} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Como a marca não fala" apoio="Um por linha">
                <textarea className={juntar(campoTexto, "min-h-[72px]")} value={dados.tom.como_nao_fala.join("\n")} onChange={(e) => mexer((d) => ({ ...d, tom: { ...d.tom, como_nao_fala: linhas(e.target.value) } }))} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="A ideia da marca" largo>
                <textarea className={juntar(campoTexto, "min-h-[72px]")} value={dados.conceito.resumo} maxLength={1500} onChange={(e) => mexer((d) => ({ ...d, conceito: { ...d.conceito, resumo: e.target.value } }))} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Significado do logo" largo>
                <textarea className={juntar(campoTexto, "min-h-[72px]")} value={dados.conceito.significado_do_logo} maxLength={1500} onChange={(e) => mexer((d) => ({ ...d, conceito: { ...d.conceito, significado_do_logo: e.target.value } }))} />
              </CampoDeFormulario>
            </div>
          </Secao>

          <Secao titulo={modelo === "prancha" ? "Seções" : "Páginas"} descricao={`${prontas} de ${estado.length} prontas`} divisoria recolher={`mesa-identidade:${projeto.id}:guideline:paginas`} recolhidaDeInicio>
            <ul className={juntar(lista.aberta, "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3")} aria-label="Estado das páginas">
              {estado.map((p) => (
                <li key={p.id} className={lista.linha}>
                  <span className={juntar(texto.etiqueta, "mr-2 w-6 shrink-0 tabular-nums text-muted-foreground")}>{p.n < 10 ? `0${p.n}` : p.n}</span>
                  <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{p.titulo}</span>
                  {p.pronta ? <Pastilha tom="bom">Pronta</Pastilha> : <Pastilha tom="alerta">{p.falta[0]}</Pastilha>}
                </li>
              ))}
            </ul>
          </Secao>

          <Secao titulo="Prévia" divisoria recolher={`mesa-identidade:${projeto.id}:guideline:previa`}>
            <VisaoDoBrandbook dados={dados} modelo={modelo} urlDe={urlDe} />
          </Secao>
        </>
      )}
    </div>
  );
}
