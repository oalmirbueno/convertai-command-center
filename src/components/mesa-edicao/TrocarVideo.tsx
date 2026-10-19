import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Film, Loader2, Replace, Upload } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { EstadoVazio } from "@/components/sistema/Estados";
import { lerEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";
import {
  chamarMesaVideos,
  chaveDasVersoes,
  chaveDosArquivos,
  duracaoCurta,
  subirVideos,
  useArquivosDeVideo,
  useVersoes,
  type ArquivoDeVideo,
} from "@/components/mesa-videos/videosApi";
import { chaveDaVersaoAberta, edicoesRecentes, nomeDaEdicao, podeEditar, trocarVideo, versaoAberta, videosParaTrocar, type FonteDaTroca, type ModoDaTroca } from "./trocaDeVideo";

/**
 * "Trocar vídeo" da Mesa Edição (19/10/2026, dono: "na edição escolher outro
 * vídeo para editar, no momento não permite, corrija e melhore"). Só o ícone
 * na barra da mesa, em toda etapa; abre a janela central com:
 * - Edições recentes: a última versão editável de cada vídeo, para alternar.
 * - Outro vídeo: do acervo do cliente, da Mesa Vídeos ou subir um novo.
 * Com uma edição aberta, trocar pergunta antes: manter (a edição de agora
 * fica nas versões e nas recentes) ou descartar (a montagem do vídeo novo
 * entra no lugar, com Desfazer). Regras e chamadas em ./trocaDeVideo.ts.
 */

type Aba = FonteDaTroca | "subir";

const quando = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

export default function TrocarVideo({ irPara }: { irPara: IrPara }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [aberta, setAberta] = useState(false);
  const [aba, setAba] = useState<Aba>("acervo");
  const [escolhido, setEscolhido] = useState<ArquivoDeVideo | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const arquivosQ = useArquivosDeVideo(aberta ? clientId : "");
  const versoesQ = useVersoes(aberta ? clientId : "");

  const arquivos = (arquivosQ.data && arquivosQ.data.arquivos) || [];
  const versoes = (versoesQ.data && versoesQ.data.itens) || [];
  const atual = versaoAberta(versoes, lerEstadoDaTela<string>(chaveDaVersaoAberta(clientId), ""));
  const recentes = edicoesRecentes(versoes);
  const doAcervo = videosParaTrocar(arquivos, "acervo");
  const daMesaVideos = videosParaTrocar(arquivos, "mesa_videos");
  const videos = aba === "mesa_videos" ? daMesaVideos : doAcervo;

  const fechar = () => {
    if (ocupado) return;
    setAberta(false);
    setEscolhido(null);
  };

  // O editor abre a versão pelo ?versao= (AreaDoEditor), que também recarrega o editor aberto.
  const abrirNoEditor = (versaoId: string) => irPara("editar", { versao: versaoId });

  const trocar = async (arquivo: ArquivoDeVideo, modo: ModoDaTroca) => {
    setOcupado(modo);
    try {
      const r = await trocarVideo({ clientId, arquivo, atual, modo, agora: new Date().toISOString(), chamar: chamarMesaVideos });
      await queryClient.invalidateQueries({ queryKey: chaveDasVersoes(clientId) });
      setAberta(false);
      setEscolhido(null);
      abrirNoEditor(r.versaoId);
      const desfazer = r.desfazer;
      if (desfazer) {
        toast.success(`Editando ${arquivo.nome}`, {
          description: "A edição anterior foi descartada.",
          action: {
            label: "Desfazer",
            onClick: () => {
              void desfazer()
                .then(() => queryClient.invalidateQueries({ queryKey: chaveDasVersoes(clientId) }))
                .then(() => {
                  abrirNoEditor(r.versaoId);
                  toast.success("A edição anterior voltou.");
                })
                .catch((e) => toast.error("Não foi possível desfazer", { description: textoDoErro(e) }));
            },
          },
        });
      } else toast.success(`Editando ${arquivo.nome}`, atual ? { description: "A edição anterior ficou nas versões e nas edições recentes." } : undefined);
    } catch (e) {
      toast.error("Não foi possível trocar o vídeo", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setOcupado(null);
    }
  };

  // Com edição aberta, pergunta antes; sem, abre direto (nada a perder).
  const escolher = (a: ArquivoDeVideo) => {
    if (!podeEditar(a)) return;
    if (atual) setEscolhido(a);
    else void trocar(a, "manter");
  };

  const subir = async (selecionados: FileList | null) => {
    const arquivo = selecionados && selecionados[0];
    if (!arquivo || ocupado) return;
    setOcupado("subir");
    try {
      const r = await subirVideos(clientId, [arquivo], () => undefined);
      await queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
      if (r.recusados.length) throw new Error(`${r.recusados[0].nome}: ${r.recusados[0].motivo}`);
      if (r.aviso && !r.registrados.length) throw new Error(r.aviso);
      const novo = r.registrados[0] || null;
      if (!novo) {
        // Mesmo conteúdo já estava no acervo: escolhe o de lá na lista.
        toast.info("Esse vídeo já estava no acervo", { description: "Escolha na lista do acervo." });
        setAba("acervo");
        return;
      }
      setOcupado(null);
      if (!podeEditar(novo)) {
        toast.warning("Subiu, mas a duração não foi lida", { description: "Abra o vídeo uma vez na Entrada e tente de novo." });
        setAba("acervo");
        return;
      }
      escolher(novo);
    } catch (e) {
      toast.error("O envio parou", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setOcupado((o) => (o === "subir" ? null : o));
      if (entrada.current) entrada.current.value = "";
    }
  };

  const lendo = arquivosQ.isLoading || versoesQ.isLoading;

  return (
    <>
      {/* Só ícone (padrão do painel): o nome vai no aria-label e no title. */}
      <button type="button" className={juntar(botao.icone, "mr-0.5")} onClick={() => setAberta(true)} aria-label="Trocar vídeo" title="Trocar vídeo" data-trocar-video="">
        <Replace className="h-4 w-4" />
      </button>
      <JanelaCentral
        aberta={aberta}
        onFechar={fechar}
        largura="md"
        icone={<Replace className="h-4 w-4" />}
        titulo={escolhido ? "Trocar o vídeo em edição" : "Trocar vídeo"}
        descricao={atual ? `Em edição: ${nomeDaEdicao(atual)}` : "Nenhum vídeo em edição"}
        ajuda="Escolha outro vídeo para editar: do acervo do cliente, da Mesa Vídeos ou um novo. Com uma edição aberta, você decide se ela fica nas versões (para voltar depois pelas edições recentes) ou se é descartada. Nada aqui gasta."
        rodape={
          escolhido ? (
            <div className="flex w-full min-w-0 flex-wrap items-center justify-end">
              <button type="button" className={juntar(botao.discreto, "mb-1 mr-auto")} onClick={() => setEscolhido(null)} disabled={!!ocupado}>
                Voltar
              </button>
              <button type="button" className={juntar(botao.perigo, "mb-1 ml-1")} onClick={() => void trocar(escolhido, "descartar")} disabled={!!ocupado} data-trocar-descartar="">
                {ocupado === "descartar" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Descartar a atual
              </button>
              <button type="button" className={juntar(botao.primario, "mb-1 ml-1")} onClick={() => void trocar(escolhido, "manter")} disabled={!!ocupado} data-trocar-manter="">
                {ocupado === "manter" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Manter nas versões
              </button>
            </div>
          ) : undefined
        }
      >
        {escolhido && atual ? (
          <div className="min-w-0 space-y-2" data-pergunta-da-troca="">
            <p className="text-[13px]">
              Trocar <strong className="font-medium">{nomeDaEdicao(atual)}</strong> por <strong className="font-medium">{escolhido.nome}</strong>?
            </p>
            <p className={texto.auxiliar}>Manter: a edição de agora fica nas versões e volta pelas edições recentes. Descartar: o vídeo novo entra no lugar e a edição de agora sai (o aviso traz Desfazer).</p>
          </div>
        ) : (
          <div className="min-w-0 space-y-5">
            {recentes.length > 0 && (
              <section className="min-w-0" aria-label="Edições recentes">
                <p className={juntar(texto.rotulo, "mb-1")}>Edições recentes</p>
                <ul className={lista.aberta} data-edicoes-recentes="">
                  {recentes.map((v) => {
                    const aqui = !!atual && v.id === atual.id;
                    return (
                      <li key={v.id} className="min-w-0">
                        <button
                          type="button"
                          className={juntar(lista.linha, "w-full text-left", aqui && lista.destaque)}
                          onClick={() => {
                            setAberta(false);
                            abrirNoEditor(v.id);
                          }}
                          aria-current={aqui ? "true" : undefined}
                          title={aqui ? "Aberta no editor" : "Abrir esta edição"}
                          data-edicao-recente={v.id}
                        >
                          <Film className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate text-[13px]">{nomeDaEdicao(v)}</span>
                          <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>
                            v{v.numero}
                            {quando(v.criado_em) ? ` · ${quando(v.criado_em)}` : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <section className="min-w-0" aria-label="Outro vídeo">
              <div className="mb-1 flex min-w-0 flex-wrap items-center">
                <p className={juntar(texto.rotulo, "mr-3")}>Outro vídeo</p>
                <SeletorCompacto
                  rotulo="De onde vem o vídeo"
                  valor={aba}
                  onEscolher={(v) => setAba(v === "mesa_videos" ? "mesa_videos" : v === "subir" ? "subir" : "acervo")}
                  listaQuandoNaoCabe
                  opcoes={[
                    { valor: "acervo", rotulo: "Acervo", contador: arquivosQ.data ? doAcervo.length : null },
                    { valor: "mesa_videos", rotulo: "Mesa Vídeos", contador: arquivosQ.data ? daMesaVideos.length : null },
                    { valor: "subir", rotulo: "Subir" },
                  ]}
                />
              </div>
              {aba === "subir" ? (
                <div className="py-3">
                  <input ref={entrada} type="file" accept="video/*,.mov,.mp4,.mkv,.mts,.m4v" className="hidden" aria-label="Escolher vídeo para subir" onChange={(e) => void subir(e.target.files)} />
                  <button type="button" className={botao.secundario} onClick={() => entrada.current && entrada.current.click()} disabled={!!ocupado} data-subir-para-trocar="">
                    {ocupado === "subir" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
                    {ocupado === "subir" ? "Subindo" : "Escolher vídeo"}
                  </button>
                  <p className={juntar(texto.auxiliar, "mt-2")}>O vídeo entra no acervo (Entrada) e abre no editor.</p>
                </div>
              ) : lendo ? (
                <p className={juntar(texto.auxiliar, "flex items-center py-3")}>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Lendo os vídeos
                </p>
              ) : arquivosQ.isError ? (
                <p className="py-3 text-[12px] text-destructive">Não foi possível ler os vídeos. Feche e abra de novo.</p>
              ) : !videos.length ? (
                <EstadoVazio compacto titulo={aba === "mesa_videos" ? "Nenhum vídeo gerado na Mesa Vídeos." : "Nenhum vídeo no acervo."} descricao="Use Subir para trazer um vídeo novo." />
              ) : (
                <ul className={juntar(lista.aberta, lista.divisoria)} data-videos-para-trocar={aba}>
                  {videos.map((a) => {
                    const ok = podeEditar(a);
                    const detalhes = [duracaoCurta(a.duracao_s), a.largura && a.altura ? `${a.largura}x${a.altura}` : ""].filter(Boolean).join(" · ");
                    return (
                      <li key={a.id} className="min-w-0">
                        <button
                          type="button"
                          className={juntar(lista.linha, "w-full text-left disabled:cursor-not-allowed disabled:opacity-50")}
                          onClick={() => escolher(a)}
                          disabled={!ok || !!ocupado}
                          title={ok ? `Editar ${a.nome}` : "Sem duração lida: abra o vídeo uma vez na Entrada."}
                          data-video-para-trocar={a.id}
                        >
                          <Film className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate text-[13px]">{a.nome}</span>
                          {detalhes && <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>{detalhes}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </JanelaCentral>
    </>
  );
}
