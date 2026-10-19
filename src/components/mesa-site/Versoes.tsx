import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Cloud, CloudUpload, Download, Eye, History, Loader2, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { botao, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { dataEHora } from "@/lib/mesa/api";
import { podeVoltarPara, ROTULO_DO_TIPO, type TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";
import { dadosDaVersao, diferencasEntreVersoes } from "../../../supabase/functions/mesa-site/modulos/site-versoes";
import { estadoDoRascunho, ROTULO_DA_ORIGEM, versoesSalvas } from "../../../supabase/functions/mesa-site/modulos/obra-do-site";
import { CHAVES, chamarMotor, chamarSite, type LinhaDoSite, useSalvarSite } from "./siteApi";
import { type DadosDaPrevia, pedirPreviaNaNuvem, usePreviaDados } from "./previaApi";
import { previaDoCommit, previaNaNuvemPedida } from "../../../supabase/functions/mesa-site/modulos/publicacao-nuvem";
import { montarPreviaRapida } from "./previaEstatica";

type VersaoDoPlano = { id: string; motivo: string; criado_em: string };
type Arquivo = { arquivo: string; mais: number; menos: number };
type Pedido = { tipo: "codigo"; trabalho: TrabalhoDoMotor } | { tipo: "plano"; versao: VersaoDoPlano };

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const COR = /^#[0-9a-f]{6}$/i;

/**
 * Os dados da prévia rápida como estavam numa versão do plano (19/10/2026):
 * as imagens escolhidas e a seção de cada uma daquela versão (a URL é a de
 * agora; imagem apagada depois não aparece) e as cores do ajuste daquela
 * versão sobre as da marca.
 */
export function dadosDaPreviaNaVersao(dados: DadosDaPrevia, versao: Record<string, unknown>): DadosDaPrevia {
  const lista = Array.isArray(versao.imagens) ? (versao.imagens as unknown[]).map(obj) : null;
  const imagens = lista
    ? dados.imagens.map((i) => {
        const v = lista.find((x) => x.id === i.id);
        return v ? { ...i, escolhida: v.escolhida !== false, secao: typeof v.secao === "string" ? v.secao : null, slot: typeof v.slot === "string" ? v.slot : i.slot } : { ...i, escolhida: false };
      })
    : dados.imagens;
  const ajustes = obj(obj(versao.estilo).ajustes);
  const marca = dados.cores_da_marca || dados.cores;
  const cor = (v: unknown, padrao: string) => (COR.test(String(v || "")) ? String(v) : padrao);
  const cores = versao.estilo !== undefined && marca ? { ...marca, destaque: cor(ajustes.destaque, marca.destaque), fundo: cor(ajustes.fundo, marca.fundo), texto: cor(ajustes.texto, marca.texto) } : dados.cores;
  return { ...dados, imagens, cores };
}

/**
 * Versões (SIT2): comparar e voltar, nas duas camadas do site.
 * - Código: cada trabalho do motor terminado é uma versão (commit). Ver o que
 *   mudou (arquivos, linhas), baixar o zip daquela versão e voltar para ela
 *   (trabalho "desfazer" que reverte o que veio depois; sem custo de modelo).
 * - Plano: o que o site decidiu (mapa, estilo, copy, imagens, integrações,
 *   SEO) antes de cada mudança. Comparar com o atual e voltar (o atual vira
 *   versão antes).
 * Voltar sempre pede Confirmar.
 */
export default function Versoes({ site, trabalhos }: { site: LinhaDoSite; trabalhos: TrabalhoDoMotor[] }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const salvarSite = useSalvarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const [aberta, setAberta] = useState<string | null>(null);
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const plano = useQuery({ queryKey: CHAVES.versoes(site.id), queryFn: () => chamarSite<{ versoes: VersaoDoPlano[]; aviso: string | null }>("versoes_listar", { site_id: site.id }) });
  const comparada = useQuery({
    queryKey: ["mesa-site", "versao", site.id, aberta],
    enabled: !!aberta && aberta.indexOf("plano:") === 0,
    queryFn: () => chamarSite<{ versao: { dados: Record<string, unknown> } }>("versao_ler", { site_id: site.id, versao_id: String(aberta).slice(6) }),
  });
  const doCodigo = trabalhos.filter((t) => podeVoltarPara(t));
  // Gravyx: a versão salva diz a origem (edição, importação, restauração), os modelos e de qual veio;
  // o que ainda está no rascunho fica marcado (só vira versão no Salvar).
  const salvas = versoesSalvas(trabalhos);
  const noRascunho = estadoDoRascunho(trabalhos).trabalhos.map((t) => t.id);
  // 20/10/2026: a prévia na nuvem (Vercel da agência) de cada versão; a do estado atual sai quando pedida.
  const previaFazendo = previaNaNuvemPedida(trabalhos);
  // 19/10/2026: a prévia de uma versão do plano (janela no centro), montada como a prévia rápida.
  const [vendo, setVendo] = useState<VersaoDoPlano | null>(null);
  const lida = useQuery({
    queryKey: ["mesa-site", "versao", site.id, vendo ? `plano:${vendo.id}` : null],
    enabled: !!vendo,
    queryFn: () => chamarSite<{ versao: { dados: Record<string, unknown> } }>("versao_ler", { site_id: site.id, versao_id: vendo!.id }),
  });
  const dadosQ = usePreviaDados(site, !!vendo);
  const documentoDaVersao = useMemo(() => {
    if (!vendo || !lida.data || !dadosQ.data) return null;
    const dados = (lida.data.versao && lida.data.versao.dados) || {};
    return montarPreviaRapida({ ...site, ...dados, nome: site.nome } as LinhaDoSite, dadosDaPreviaNaVersao(dadosQ.data, dados), { marcarEstados: false }).documento;
  }, [vendo, lida.data, dadosQ.data, site]);

  const rodar = async (rotulo: string, fn: () => Promise<void>) => {
    setOcupado(rotulo);
    try {
      await fn();
    } catch (e) {
      avisarErro(e, rotulo);
    } finally {
      setOcupado(null);
    }
  };

  const baixar = (t: TrabalhoDoMotor) =>
    rodar("O zip não saiu", async () => {
      if (!t.zip_path) throw new Error("Esta versão não guardou o zip.");
      const { data, error } = await supabase.storage.from("mesa").createSignedUrl(t.zip_path, 600, { download: `${site.projeto}-${String(t.commit || "").slice(0, 8)}.zip` });
      if (error || !data) throw error || new Error("Link do zip indisponível");
      window.location.assign(data.signedUrl);
    });

  const subirPrevia = () =>
    rodar("A prévia na nuvem não entrou na fila", async () => {
      await pedirPreviaNaNuvem(site.id);
      void qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
      void qc.invalidateQueries({ queryKey: CHAVES.publicacao(site.id) });
    });

  const confirmar = () => {
    const p = pedido;
    setPedido(null);
    if (!p) return;
    if (p.tipo === "codigo")
      void rodar("A volta não entrou na fila", async () => {
        await chamarMotor("pedir", { client_id: clientId, site_id: site.id, tipo: "desfazer", voltar_para: true, alvo_trabalho_id: p.trabalho.id, instrucao: `Voltar para a versão de ${dataEHora(p.trabalho.terminado_em || p.trabalho.criado_em)}` });
        void qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
      });
    else
      void rodar("A versão não voltou", async () => {
        await salvarSite("versao_restaurar", { site_id: site.id, versao_id: p.versao.id });
        setAberta(null);
      });
  };

  const atual = dadosDaVersao(site as unknown as Record<string, unknown>);

  return (
    <Secao
      titulo="Versões"
      descricao={`${doCodigo.length} do código · ${plano.data ? plano.data.versoes.length : 0} do plano`}
      ajuda="Código: o motor escreve num rascunho; Salvar versão o transforma em versão salva e sobe a prévia dela na nuvem (Vercel da agência: a nuvem ao lado da versão abre um link que não depende desta máquina nem do túnel; o botão de cima sobe a prévia do estado atual, rascunho incluído, sem custo de modelo), com a origem (edição, importação ou restauração), os modelos usados e de qual versão veio. Cada trabalho terminado continua com o seu commit, com o que mudou e o zip daquela versão; voltar cria um trabalho que desfaz o que veio depois, sem custo de modelo. Plano: o que o site decidiu antes de cada mudança (mapa, estilo, copy, imagens, integrações e SEO), guardado no banco (site_versoes); o olho mostra a prévia daquela versão, comparar mostra o que muda e voltar guarda o atual como versão antes."
      recolher="mesa-site:construcao:versoes"
      acao={
        <button type="button" className={botao.icone} aria-label={previaFazendo ? "Subindo a prévia na nuvem" : "Subir a prévia na nuvem do estado atual"} title={previaFazendo ? "Subindo a prévia na nuvem" : "Prévia na nuvem do estado atual (rascunho ou versão salva)"} disabled={!!ocupado || !!previaFazendo} onClick={() => void subirPrevia()} data-pedir-previa-nuvem="">
          {previaFazendo || ocupado === "A prévia na nuvem não entrou na fila" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
        </button>
      }
    >
      <span className={juntar(texto.rotulo, "block")}>Código</span>
      {!doCodigo.length && <EstadoVazio compacto titulo="Nenhuma versão de código ainda." />}
      <ul className={juntar(lista.aberta, lista.divisoria)} data-versoes-do-codigo="">
        {doCodigo.slice(0, 15).map((t, n) => {
          const arquivos = (Array.isArray(t.resultado.arquivos) ? t.resultado.arquivos : []) as Arquivo[];
          const chave = `codigo:${t.id}`;
          const salva = salvas.find((v) => v.trabalho_id === t.id) || null;
          const doRascunho = noRascunho.indexOf(t.id) >= 0;
          const aqui = aberta === chave;
          const naNuvem = previaDoCommit(trabalhos, t.commit);
          return (
            <li key={t.id} className="min-w-0">
              <div className={lista.linha}>
                <button type="button" className="mr-2 flex min-w-0 flex-1 items-center text-left" onClick={() => setAberta(aqui ? null : chave)} aria-expanded={aqui} title={t.commit ? `Commit ${String(t.commit).slice(0, 12)}` : undefined}>
                  {aqui ? <ChevronDown className="mr-1.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mr-1.5 h-4 w-4 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate")}>{salva ? `Versão salva · ${ROTULO_DA_ORIGEM[salva.origem]}` : t.instrucao || ROTULO_DO_TIPO[t.tipo]}</span>
                    <span className={juntar(texto.auxiliar, "block truncate")} data-versao-salva={salva ? salva.origem : undefined}>
                      {dataEHora(t.terminado_em || t.criado_em)}
                      {salva && salva.modelos.length ? ` · ${salva.modelos.join(", ")}` : ""}
                      {salva && salva.de ? ` · de ${salva.de.slice(0, 8)}` : ""}
                      {arquivos.length ? ` · ${arquivos.length} arquivo(s)` : ""}
                    </span>
                  </span>
                </button>
                {doRascunho ? (
                  <span className={juntar(etiqueta, "mr-1 bg-amber-500/15 text-amber-700 dark:text-amber-400")}>rascunho</span>
                ) : n === 0 || (salva && salvas[0] && salvas[0].trabalho_id === t.id) ? (
                  <span className={juntar(etiqueta, "mr-1 bg-primary/10 text-primary")}>{salva ? "salva" : "atual"}</span>
                ) : null}
                {naNuvem && (
                  <a className={botao.icone} href={naNuvem.url} target="_blank" rel="noopener noreferrer" aria-label="Abrir a prévia na nuvem desta versão" title={`Abrir prévia (${naNuvem.ramo === "rascunho" ? "rascunho, " : ""}${dataEHora(naNuvem.em)})`} data-abrir-previa-nuvem={naNuvem.commit.slice(0, 8)}>
                    <Cloud className="h-4 w-4" />
                  </a>
                )}
                {t.zip_path && (
                  <button type="button" className={botao.icone} aria-label="Baixar o zip desta versão" title="Baixar o zip" onClick={() => void baixar(t)}>
                    <Download className="h-4 w-4" />
                  </button>
                )}
                {n > 0 && (
                  <button type="button" className={botao.icone} aria-label="Voltar para esta versão" title="Voltar para esta versão" disabled={!!ocupado} onClick={() => setPedido({ tipo: "codigo", trabalho: t })}>
                    <Undo2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              {aqui && (
                <ul className="min-w-0 px-8 pb-2">
                  {!arquivos.length && <li className={texto.auxiliar}>Sem a lista de arquivos (versão antiga do motor).</li>}
                  {arquivos.map((a) => (
                    <li key={a.arquivo} className={juntar(texto.auxiliar, "flex min-w-0")}>
                      <span className="min-w-0 flex-1 truncate">{a.arquivo}</span>
                      <span className="ml-2 shrink-0 tabular-nums text-primary">+{a.mais}</span>
                      <span className="ml-1 shrink-0 tabular-nums text-destructive">-{a.menos}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex min-w-0 items-center border-t border-border pt-3">
        <History className="mr-1.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className={texto.rotulo}>Plano do site</span>
      </div>
      {plano.data && plano.data.aviso && <p className={texto.auxiliar}>{plano.data.aviso}</p>}
      {plano.isLoading && <p className={texto.auxiliar}>Lendo as versões</p>}
      {plano.data && !plano.data.versoes.length && !plano.data.aviso && <EstadoVazio compacto titulo="Nenhuma versão do plano ainda." />}
      <ul className={juntar(lista.aberta, lista.divisoria)} data-versoes-do-plano="">
        {(plano.data ? plano.data.versoes : []).map((v) => {
          const chave = `plano:${v.id}`;
          const aqui = aberta === chave;
          const dif = aqui && comparada.data ? diferencasEntreVersoes(comparada.data.versao.dados || {}, atual) : [];
          return (
            <li key={v.id} className="min-w-0">
              <div className={lista.linha}>
                <button type="button" className="mr-2 flex min-w-0 flex-1 items-center text-left" onClick={() => setAberta(aqui ? null : chave)} aria-expanded={aqui}>
                  {aqui ? <ChevronDown className="mr-1.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mr-1.5 h-4 w-4 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate")}>Antes de: {v.motivo}</span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>{dataEHora(v.criado_em)}</span>
                  </span>
                </button>
                <button type="button" className={botao.icone} aria-label="Ver a prévia desta versão" title="Ver a prévia desta versão" onClick={() => setVendo(v)} data-ver-previa-da-versao={v.id}>
                  <Eye className="h-4 w-4" />
                </button>
                <button type="button" className={botao.icone} aria-label="Voltar para esta versão do plano" title="Voltar para esta versão" disabled={!!ocupado} onClick={() => setPedido({ tipo: "plano", versao: v })}>
                  <Undo2 className="h-4 w-4" />
                </button>
              </div>
              {aqui && (
                <div className="min-w-0 px-8 pb-2">
                  {comparada.isLoading && <p className={texto.auxiliar}>Comparando</p>}
                  {comparada.data && !dif.length && <p className={texto.auxiliar}>Igual ao atual.</p>}
                  {dif.map((d) => (
                    <div key={d.campo} className="min-w-0 py-1">
                      <span className={juntar(texto.rotulo, "block")}>{d.rotulo}</span>
                      <span className={juntar(texto.auxiliar, "block whitespace-normal")}>Nesta versão: {d.antes}</span>
                      <span className={juntar(texto.corpo, "block whitespace-normal")}>Agora: {d.depois}</span>
                    </div>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {ocupado && (
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          {ocupado.replace(/ não .*$/, "")}
        </p>
      )}

      <JanelaCentral
        aberta={!!vendo}
        onMudar={(a) => !a && setVendo(null)}
        titulo={vendo ? `Antes de: ${vendo.motivo}` : "Versão"}
        icone={<Eye className="h-4 w-4" />}
        descricao={vendo ? dataEHora(vendo.criado_em) : undefined}
        ajuda="A prévia rápida do plano desta versão: mapa, copy, imagens escolhidas e cores daquele momento (as fotos usam o endereço de agora; imagem apagada depois não aparece). Voltar para esta guarda o atual como versão antes."
        largura="xl"
        rodape={
          vendo ? (
            <button
              type="button"
              className={botao.primario}
              disabled={!!ocupado}
              onClick={() => {
                const v = vendo;
                setVendo(null);
                setPedido({ tipo: "plano", versao: v });
              }}
              data-voltar-pela-previa=""
            >
              <Undo2 className="mr-1 h-3.5 w-3.5" />
              Voltar para esta
            </button>
          ) : null
        }
        data-previa-da-versao=""
      >
        {vendo && (lida.isError || dadosQ.isError) && <p className={juntar(texto.auxiliar, "text-destructive")}>A prévia desta versão não abriu agora.</p>}
        {vendo && !documentoDaVersao && !lida.isError && !dadosQ.isError && <Carregando forma="aba" rotulo="Montando a prévia da versão" />}
        {documentoDaVersao && <iframe title="Prévia desta versão do site" srcDoc={documentoDaVersao} sandbox="" className="block w-full rounded-md border border-border bg-white" style={{ height: 600, maxHeight: "70vh" }} data-iframe-da-versao="" />}
      </JanelaCentral>

      <AlertDialog open={!!pedido} onOpenChange={(v) => !v && setPedido(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Voltar para esta versão?</AlertDialogTitle>
            <AlertDialogDescription>
              {pedido && pedido.tipo === "codigo"
                ? "O motor desfaz o código que veio depois desta versão, num commit novo no rascunho (nada se perde: dá para voltar de novo). Confira na prévia e salve a versão (fica com a origem restauração). Sem custo de modelo."
                : "O plano do site volta a esta versão (mapa, estilo, copy, imagens, integrações e SEO). O atual fica guardado como versão."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmar}>Confirmar e voltar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Secao>
  );
}
