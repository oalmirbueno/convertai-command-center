import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  Check,
  ExternalLink,
  Hash,
  ImagePlus,
  Loader2,
  PenLine,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import EstudioRefinarTexto from "@/components/mesa/EstudioRefinarTexto";
import { JanelaDaPublicacao, TOM_DO_ESTADO } from "@/components/mesa/PublicacaoDaPeca";
import { copiarTexto, legendaParaCopiar, normalizarHashtags } from "@/components/mesa/estudioUtil";
import { chamarFuncao, padraoPara, TAMANHOS, textoDoErro, type ParteDaEstimativa } from "@/lib/mesa/api";
import { repetirEntregaEmPartes } from "@/lib/mesa/entregaEmPartes";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { campo, foco, juntar } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { Cartao, Moldura, useMesaFoto, Vazio } from "./Comuns";
import SeletorDoPerfil from "./SeletorDoPerfil";
import SeletorDeFotos from "./SeletorDeFotos";
import { lerDaSessao, gravarNaSessao } from "./sessao";
import { acrescentarFotos, decidirFoto, ehReferenciaWeb, invalidarFotos, useFotos, type FotoDoAcervo } from "./fotoApi";
import {
  CHAVE_DAS_FOTOS_DO_POST,
  DATA_DE_HOJE,
  entregarEEnviar,
  escreverLegenda,
  invalidarPostsDeFotos,
  prepararPostDeFotos,
  salvarFormatoDoPerfil,
  salvarLegendaDoPost,
  useFormatoDoPerfil,
  useItensParaFotos,
  usePostsDeFotos,
  chaveDoFormatoDoPerfil,
  type PostDeFotos,
} from "./agendaApi";
import {
  DICA_DO_PERFIL,
  estadoDoPostDeFotos,
  FORMATOS_DO_PERFIL,
  FORMATOS_DO_POST_DE_FOTOS,
  MAX_FOTOS_NO_POST,
  podeTrocarAsFotos,
  precisaDaEquipe,
  PROPORCAO_DO_FORMATO_DE_FOTOS,
  ROTULO_DO_FORMATO_DE_FOTOS,
  ROTULO_DO_PERFIL,
  type FormatoDoPerfil,
  type FormatoDoPostDeFotos,
} from "../../../supabase/functions/_shared/post-de-fotos";

/**
 * Post na Agenda (pedido do dono, 27/09: "preparar carrossel na agenda e
 * selecionar as fotos, aí ele já tem a ferramenta de legenda", "enviar para
 * aprovação ... após a aprovação ele já tem a legenda também e vai pro ar").
 *
 * Um caminho só, em 4 passos: 1. Fotos (foto única ou carrossel, na ordem),
 * 2. Legenda (a mesma ferramenta do Estúdio), 3. Data ("Publicar em", o
 * mesmo da Entrega e da Agenda), 4. Enviar para o cliente aprovar. Depois da
 * aprovação o ciclo da Agenda publica sozinho na data confirmada.
 *
 * Por baixo é um trabalho do Estúdio "só fotos" (regras em
 * supabase/functions/_shared/post-de-fotos.ts): entrega, Agenda, aprovação,
 * pedido de ajuste do cliente e avisos são os mesmos das artes. Nada é gerado
 * aqui e nada escurece a foto.
 *
 * Em cima, o formato do perfil do cliente (só fotos, só artes ou alternar):
 * o agente do Mês marca cada item do plano com a mesa certa.
 */

const dataCurta = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "sem data");
const novoPedido = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Um post da lista: capa, título, dia e em que pé está. */
function LinhaDoPost({ post, aberto, onAbrir }: { post: PostDeFotos; aberto: boolean; onAbrir: () => void }) {
  const estado = estadoDoPostDeFotos(post, post.publicacao);
  const capa = post.cards[0];
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onAbrir}
        aria-pressed={aberto}
        className={juntar("flex w-full min-w-0 items-center rounded-lg border px-2.5 py-2 text-left transition-colors", foco, aberto ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40")}
        data-post-de-fotos={post.id}
      >
        <span className="mr-2.5 w-10 shrink-0">
          <Moldura proporcao={PROPORCAO_DO_FORMATO_DE_FOTOS[post.formato]}>
            {capa ? <ImagemDaMesa caminho={capa.storage_path} alt="" className="h-full w-full" /> : <span className="block h-full w-full bg-muted" />}
          </Moldura>
        </span>
        <span className="mr-2 min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium">{post.item ? post.item.title : "Post de fotos"}</span>
          <span className="block truncate text-[11.5px] text-muted-foreground">
            {dataCurta(post.item ? post.item.due_date : null)} · {post.cards.length ? `${post.cards.length} ${post.cards.length === 1 ? "foto" : "fotos"}` : "sem fotos"}
          </span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] ${TOM_DO_ESTADO[estado.tom]}`}>{estado.rotulo}</span>
      </button>
    </li>
  );
}

/** Montar o post: as fotos na ordem, o formato e onde entra (item da Agenda ou post novo). */
function MontarOPost({
  fotosIniciais,
  post,
  taskInicial,
  onPronto,
  onCancelar,
}: {
  fotosIniciais: string[];
  post: PostDeFotos | null;
  taskInicial: string | null;
  onPronto: (trabalhoId: string, taskId: string | null) => void;
  onCancelar: () => void;
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const fotosQ = useFotos(clientId);
  const todas = useMemo(() => fotosQ.data || [], [fotosQ.data]);
  const itens = useItensParaFotos(clientId, !post);
  const [ids, setIds] = useState<string[]>(fotosIniciais.slice(0, MAX_FOTOS_NO_POST));
  const [formato, setFormato] = useState<FormatoDoPostDeFotos>(post ? post.formato : "feed_4x5");
  const [destino, setDestino] = useState<string>(post && post.task_id ? post.task_id : taskInicial || "novo");
  const [titulo, setTitulo] = useState("");
  const [data, setData] = useState(DATA_DE_HOJE());
  const [escolhendo, setEscolhendo] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [pedido] = useState(novoPedido);
  const porId = new Map(todas.map((f) => [f.id, f]));
  const fotos = ids.map((id) => porId.get(id)).filter((f): f is FotoDoAcervo => !!f);
  const geradasSemAprovar = fotos.filter((f) => precisaDaEquipe(f)).length;
  const listaDeItens = itens.data || [];

  useEffect(() => {
    setIds(fotosIniciais.slice(0, MAX_FOTOS_NO_POST));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fotosIniciais.join(",")]);

  const mover = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    const n = ids.slice();
    const t = n[i];
    n[i] = n[j];
    n[j] = t;
    setIds(n);
  };

  const opcoesDeDestino = [{ valor: "novo", rotulo: "Post novo nesta data", descricao: "Cria o item na Agenda" }].concat(
    listaDeItens.map((i) => ({
      valor: i.id,
      rotulo: `${dataCurta(i.due_date)} · ${i.title}`,
      descricao: i.situacao === "post_de_fotos" ? "Post de fotos deste item" : i.situacao === "arte" ? "Já tem arte no Estúdio" : "Item livre",
      desativada: i.situacao === "arte",
    })),
  );

  const preparar = async () => {
    if (!ids.length) return;
    if (destino === "novo" && !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      toast.error("Escolha a data do post");
      return;
    }
    setPreparando(true);
    try {
      const r = await prepararPostDeFotos({
        clientId,
        imagemIds: ids,
        formato,
        taskId: post ? post.task_id : destino !== "novo" ? destino : null,
        trabalhoId: post ? post.id : null,
        novoItem: !post && destino === "novo" ? { titulo: titulo.trim() || "Post de fotos", data } : null,
        pedidoId: pedido,
      });
      gravarNaSessao(clientId, CHAVE_DAS_FOTOS_DO_POST, null);
      invalidarPostsDeFotos(queryClient, clientId);
      toast.success(post ? "Fotos do post trocadas" : r.item_criado ? "Post novo na Agenda" : "Post pronto na Agenda", {
        description: [
          `${r.trabalho && Array.isArray(r.trabalho.cards) ? r.trabalho.cards.length : ids.length} ${ids.length === 1 ? "foto" : "fotos"}. Agora a legenda, a data e o envio ao cliente.`,
          r.recusadas.length ? `${r.recusadas.length} ficou de fora: ${r.recusadas[0].motivo}` : "",
          r.avisos.join(" "),
        ].filter(Boolean).join(" "),
        duration: 9000,
      });
      onPronto(String(r.trabalho && r.trabalho.id), r.task ? r.task.id : null);
    } catch (e) {
      avisarErro(e, "O post não foi montado");
    } finally {
      setPreparando(false);
    }
  };

  return (
    <Cartao
      titulo={post ? "Trocar as fotos do post" : "Montar o post"}
      dica="Foto única ou carrossel (até 10), na ordem do post. As fotos vão como estão: nada é gerado nem redesenhado. Foto gerada sai marcada e passa pela aprovação da equipe antes do cliente."
      acao={
        <Button type="button" size="sm" variant="ghost" className="h-8 text-[12px]" onClick={onCancelar}>
          Cancelar
        </Button>
      }
    >
      {escolhendo && (
        <SeletorDeFotos
          fotos={todas.filter((f) => !ehReferenciaWeb(f))}
          titulo="Fotos do post"
          multiplas
          jaEscolhidas={ids}
          filtroInicial="todas"
          onUsar={(novas) => {
            const junto = ids.concat(novas.filter((x) => ids.indexOf(x) < 0)).slice(0, MAX_FOTOS_NO_POST);
            setIds(junto);
            setEscolhendo(false);
          }}
          onFechar={() => setEscolhendo(false)}
        />
      )}
      <div className="min-w-0 space-y-3" data-montar-post="">
        <div className="min-w-0">
          <p className="mb-1.5 text-[12px] text-muted-foreground">
            {ids.length === 0 ? "Escolha as fotos." : ids.length === 1 ? "Foto única." : `Carrossel com ${ids.length} fotos (a primeira é a capa).`} {ids.length}/{MAX_FOTOS_NO_POST}
          </p>
          <ol className="flex min-w-0 flex-wrap" aria-label="Fotos do post, na ordem">
            {fotos.map((f, i) => (
              <li key={f.id} className="mb-2 mr-2 w-24 min-w-0" data-foto-do-post={f.id}>
                <Moldura proporcao={PROPORCAO_DO_FORMATO_DE_FOTOS[formato]} className="border border-border">
                  <ImagemDaMesa caminho={f.storage_path} bucket={f.storage_bucket || "mesa"} alt={f.nome} className="h-full w-full" />
                  <span className="pointer-events-none absolute left-1 top-1 rounded-full border border-border bg-card px-1.5 py-px text-[10px] font-semibold">{i + 1}</span>
                </Moldura>
                <div className="mt-1 flex items-center justify-between">
                  <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40" disabled={i === 0} onClick={() => mover(i, -1)} aria-label={`Mover ${f.nome} para antes`}>
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-destructive" onClick={() => setIds(ids.filter((x) => x !== f.id))} aria-label={`Tirar ${f.nome} do post`}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40" disabled={i === fotos.length - 1} onClick={() => mover(i, 1)} aria-label={`Mover ${f.nome} para depois`}>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
                {precisaDaEquipe(f) && <p className="text-center text-[10px] text-primary">gerada, a aprovar</p>}
              </li>
            ))}
            {ids.length < MAX_FOTOS_NO_POST && (
              <li className="mb-2 mr-2 w-24">
                <button type="button" onClick={() => setEscolhendo(true)} className={juntar("flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-border py-6 text-[11.5px] text-muted-foreground hover:border-primary/50 hover:text-foreground", foco)}>
                  <ImagePlus className="mb-1 h-4 w-4" /> Escolher
                </button>
              </li>
            )}
          </ol>
          {geradasSemAprovar > 0 && (
            <p className="text-[11.5px] text-muted-foreground">
              {geradasSemAprovar} {geradasSemAprovar === 1 ? "foto gerada" : "fotos geradas"} ainda sem a aprovação da equipe: entram no rascunho e são aprovadas no envio.
            </p>
          )}
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[11.5px] font-medium text-muted-foreground">Formato</p>
          <div role="radiogroup" aria-label="Formato do post" className="inline-grid grid-cols-3 gap-0.5 rounded-md bg-muted p-0.5">
            {FORMATOS_DO_POST_DE_FOTOS.map((f) => (
              <button key={f} type="button" role="radio" aria-checked={formato === f} onClick={() => setFormato(f)} className={juntar("rounded px-2 py-1 text-[11.5px]", foco, formato === f ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>
                {ROTULO_DO_FORMATO_DE_FOTOS[f]}
              </button>
            ))}
          </div>
        </div>
        {!post && (
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
            <CampoDeFormulario rotulo="Onde entra na Agenda">
              <SeletorCompacto modo="lista" rotulo="Item da Agenda" opcoes={opcoesDeDestino} valor={destino} onEscolher={setDestino} className="w-full" />
            </CampoDeFormulario>
            {destino === "novo" && (
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_150px] gap-2">
                <CampoDeFormulario rotulo="Título">
                  <input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Bastidores da coleção" className={campo} aria-label="Título do post" />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Dia">
                  <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={campo} aria-label="Dia do post" />
                </CampoDeFormulario>
              </div>
            )}
          </div>
        )}
        <div className="flex min-w-0 flex-wrap items-center">
          <Button type="button" size="sm" className="mb-1 mr-2 h-9 text-[12.5px]" disabled={!ids.length || preparando} onClick={() => void preparar()} data-preparar-na-agenda="">
            {preparando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="mr-1.5 h-3.5 w-3.5" />}
            {post ? "Trocar as fotos" : "Preparar na Agenda"}
          </Button>
          <span className="mb-1 text-[11.5px] text-muted-foreground">Sem custo: nada é gerado. Nada vai ao cliente até você enviar.</span>
        </div>
      </div>
    </Cartao>
  );
}

/** O post aberto: fotos, legenda, data e envio, em 4 passos. */
function PostAberto({ post, onTrocarFotos }: { post: PostDeFotos; onTrocarFotos: () => void }) {
  const { clientId, catalogo, podeRecarregar, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const { abrirNoEstudio } = useMesaFoto();
  const fotosQ = useFotos(clientId);
  const porId = new Map((fotosQ.data || []).map((f) => [f.id, f]));
  const estado = estadoDoPostDeFotos(post, post.publicacao);
  const [legenda, setLegenda] = useState(post.legenda || "");
  const [hashtagsTexto, setHashtagsTexto] = useState((post.hashtags || []).join(" "));
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [entregando, setEntregando] = useState(false);
  const [janela, setJanela] = useState(false);
  const hashtagsDoPost = (post.hashtags || []).join(" ");
  // O post mudou no banco (legenda escrita, outra aba): o campo mostra o que está gravado.
  useEffect(() => {
    setLegenda(post.legenda || "");
    setHashtagsTexto(hashtagsDoPost);
  }, [post.id, post.legenda, hashtagsDoPost]);
  const trocaFotos = podeTrocarAsFotos(post);
  const entregue = post.status === "entregue" && post.file_ids.length > 0;
  const travado = !trocaFotos || (entregue && post.entrega_status !== "reprovado");
  const hashtags = normalizarHashtags(hashtagsTexto.replace(/[,\n]/g, " ").split(" "));
  const mudou = legenda !== (post.legenda || "") || hashtags.join(" ") !== normalizarHashtags(post.hashtags || []).join(" ");
  const diretor = padraoPara(catalogo, "diretor_arte");
  const partesDaLegenda = (): ParteDaEstimativa[] => [{ modeloId: diretor ? diretor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.legenda.entrada, tokensSaida: TAMANHOS.legenda.saida }];
  const fotosDoPost = post.imagem_ids.map((id) => porId.get(id)).filter((f): f is FotoDoAcervo => !!f);
  const geradasSemAprovar = fotosDoPost.filter((f) => precisaDaEquipe(f));
  const semFotos = !post.cards.length;

  const salvar = async (silencioso = false) => {
    setSalvando(true);
    try {
      await salvarLegendaDoPost(post.id, legenda, hashtags);
      invalidarPostsDeFotos(queryClient, clientId);
      if (!silencioso) toast.success("Legenda salva");
    } catch (e) {
      avisarErro(e, "Legenda não salva");
    } finally {
      setSalvando(false);
    }
  };

  /** A data pede a peça na Agenda: entrega antes (Arquivos e Agenda, sem enviar), depois abre o Publicar em. */
  const abrirData = async () => {
    if (semFotos) return;
    if (!post.post_id) {
      if (mudou) await salvar(true);
      setEntregando(true);
      try {
        await repetirEntregaEmPartes(() => chamarFuncao("estudio-arte", { acao: "entregar", trabalho_id: post.id }));
        invalidarPostsDeFotos(queryClient, clientId);
      } catch (e) {
        avisarErro(e, "O post não entrou na Agenda");
        return;
      } finally {
        setEntregando(false);
      }
    }
    setJanela(true);
  };

  /** Enviar para o cliente aprovar: aprova as geradas (equipe), entrega e envia. */
  const enviar = async () => {
    if (semFotos || enviando) return;
    setEnviando(true);
    try {
      if (mudou) await salvar(true);
      for (const f of geradasSemAprovar) {
        const nova = await decidirFoto(clientId, f.id, "aprovar");
        if (nova) acrescentarFotos(queryClient, clientId, [nova]);
      }
      if (geradasSemAprovar.length) invalidarFotos(queryClient, clientId);
      const r = await entregarEEnviar(post);
      invalidarPostsDeFotos(queryClient, clientId);
      const res = (r.resultado || {}) as { situacao?: string; mensagem?: string };
      toast.success("Enviado para aprovação", {
        description: res.mensagem || "A agência revisa e o cliente aprova. Com a data confirmada, publica sozinho depois da aprovação.",
        duration: 9000,
      });
    } catch (e) {
      avisarErro(e, "Não foi enviado");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Cartao
      titulo={<span className="block truncate">{post.item ? post.item.title : "Post de fotos"}</span>}
      acao={<span className={`rounded-full px-2 py-0.5 text-[11px] ${TOM_DO_ESTADO[estado.tom]}`}>{estado.rotulo}</span>}
    >
      <div className="min-w-0 space-y-4" data-post-aberto={post.id}>
        <p className="text-[12px] text-muted-foreground">
          {dataCurta(post.item ? post.item.due_date : null)} · {ROTULO_DO_FORMATO_DE_FOTOS[post.formato]} · <span className="font-medium text-foreground">Próximo: {estado.proximo}</span>
        </p>
        {post.entrega_status === "reprovado" && post.entrega_aviso && (
          <p className="rounded-md border border-destructive/30 bg-card px-3 py-2 text-[12px]">
            Ajuste pedido pelo cliente: “{post.entrega_aviso}”. Troque as fotos ou a legenda e envie de novo.
          </p>
        )}

        {/* 1. Fotos */}
        <section className="min-w-0" aria-label="1. Fotos">
          <div className="mb-1.5 flex min-w-0 items-center">
            <p className="flex-1 text-[12px] font-semibold">1. Fotos</p>
            {trocaFotos && (
              <Button type="button" size="sm" variant="ghost" className="h-7 text-[11.5px]" onClick={onTrocarFotos}>
                <PenLine className="mr-1 h-3.5 w-3.5" /> {semFotos ? "Escolher fotos" : "Trocar fotos"}
              </Button>
            )}
          </div>
          {semFotos ? (
            <p className="text-[12px] text-muted-foreground">Este post veio do plano do mês e ainda não tem fotos.</p>
          ) : (
            <ol className="flex min-w-0 flex-wrap">
              {post.cards.map((c) => {
                const f = c.imagem_id ? porId.get(c.imagem_id) : null;
                return (
                  <li key={`${c.ordem}-${c.storage_path}`} className="mb-2 mr-2 w-20">
                    <button type="button" className="block w-full" onClick={() => f && abrirNoEstudio && abrirNoEstudio(f.id)} disabled={!f || !abrirNoEstudio || !trocaFotos} title={f ? "Abrir no Estúdio de fotos" : undefined}>
                      <Moldura proporcao={PROPORCAO_DO_FORMATO_DE_FOTOS[post.formato]} className="border border-border">
                        <ImagemDaMesa caminho={c.storage_path} alt={f ? f.nome : `Foto ${c.ordem}`} className="h-full w-full" />
                        <span className="pointer-events-none absolute left-1 top-1 rounded-full border border-border bg-card px-1.5 py-px text-[10px] font-semibold">{c.ordem}</span>
                      </Moldura>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* 2. Legenda */}
        <section className="min-w-0 border-t border-border pt-3" aria-label="2. Legenda">
          <div className="mb-1.5 flex min-w-0 items-center">
            <p className="flex-1 text-[12px] font-semibold">2. Legenda</p>
            <BotaoComCusto
              rotulo={
                <>
                  <Sparkles className="mr-1 h-3.5 w-3.5" /> {legenda ? "Reescrever" : "Escrever a legenda"}
                </>
              }
              titulo="Legenda do post"
              descricao="A mesma ferramenta de legenda do Estúdio: sai do item da Agenda e das fotos, com 4 ou 5 hashtags."
              variant="outline"
              className="h-8 px-2.5 text-[12px]"
              disabled={travado || semFotos}
              partes={partesDaLegenda}
              executar={() => escreverLegenda(post.id)}
              aoConcluir={(data) => {
                if (data && typeof data.legenda === "string") setLegenda(data.legenda);
                if (data && Array.isArray(data.hashtags)) setHashtagsTexto(normalizarHashtags(data.hashtags).join(" "));
                invalidarPostsDeFotos(queryClient, clientId);
                atualizarCusto();
              }}
            />
          </div>
          <Textarea
            value={legenda}
            onChange={(e) => setLegenda(e.target.value)}
            onBlur={() => mudou && !travado && void salvar(true)}
            rows={6}
            placeholder="A legenda do post aparece aqui. Dá para editar à mão; grava sozinha ao sair do campo."
            className="text-[13px] leading-relaxed"
            disabled={travado}
            aria-label="Legenda do post"
          />
          <div className="mt-2">
            <EstudioRefinarTexto
              trabalhoId={post.id}
              alvo="legenda"
              texto={legenda}
              partes={partesDaLegenda}
              bloqueado={travado}
              onAplicar={(novo) => {
                setLegenda(novo);
                toast.success("Legenda aplicada", { description: "Confira; grava sozinha ao sair do campo." });
              }}
              onConcluido={() => atualizarCusto()}
            />
          </div>
          <CampoDeFormulario rotulo="Hashtags" className="mt-2">
            <input value={hashtagsTexto} onChange={(e) => setHashtagsTexto(e.target.value)} onBlur={() => mudou && !travado && void salvar(true)} placeholder="#exemplo #outra" className={campo} disabled={travado} aria-label="Hashtags" />
          </CampoDeFormulario>
          <div className="mt-2 flex min-w-0 flex-wrap items-center">
            {mudou && !travado ? (
              <Button type="button" size="sm" className="mb-1 mr-2 h-8 text-[12px]" onClick={() => void salvar()} disabled={salvando}>
                {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />} Salvar legenda
              </Button>
            ) : (
              <span className="mb-1 mr-2 inline-flex items-center text-[11.5px] text-muted-foreground">
                <Check className="mr-1 h-3.5 w-3.5 text-success" /> {legenda ? "salva" : "sem legenda ainda"}
              </span>
            )}
            {legenda && (
              <button type="button" className="mb-1 inline-flex items-center text-[11.5px] text-primary hover:underline" onClick={() => void copiarTexto(legendaParaCopiar(legenda, hashtags)).then((ok) => (ok ? toast.success("Legenda copiada") : toast.error("Não foi possível copiar")))}>
                <Hash className="mr-1 h-3.5 w-3.5" /> Copiar com as hashtags
              </button>
            )}
          </div>
          {travado && <p className="mt-1 text-[11.5px] text-muted-foreground">Legenda travada: o post já foi entregue ou está com o cliente.</p>}
        </section>

        {/* 3. Data */}
        <section className="min-w-0 border-t border-border pt-3" aria-label="3. Data">
          <div className="flex min-w-0 flex-wrap items-center">
            <p className="mb-1 flex-1 text-[12px] font-semibold">3. Data de publicação</p>
            <Button type="button" size="sm" variant="outline" className="mb-1 h-8 text-[12px]" onClick={() => void abrirData()} disabled={semFotos || entregando}>
              {entregando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="mr-1.5 h-3.5 w-3.5" />}
              {post.publicacao && post.publicacao.scheduled_at ? "Reagendar" : "Publicar em"}
            </Button>
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            {post.publicacao && post.publicacao.scheduled_at
              ? `Confirmada para ${dataCurta(post.publicacao.scheduled_at)}. Publica sozinho depois da aprovação do cliente.`
              : post.post_id
                ? "Na Agenda, sem data confirmada. Sem data, nada é publicado."
                : "Ao escolher a data, o post entra na Agenda (sem ir ao cliente). A legenda trava na entrega."}
          </p>
        </section>

        {/* 4. Enviar */}
        <section className="min-w-0 border-t border-border pt-3" aria-label="4. Enviar para o cliente aprovar">
          <div className="flex min-w-0 flex-wrap items-center">
            <p className="mb-1 flex-1 text-[12px] font-semibold">4. Aprovação do cliente</p>
            {(!post.entrega_status || post.entrega_status === "reprovado") && (
              <Button type="button" size="sm" className="mb-1 h-8 text-[12px]" disabled={semFotos || enviando} onClick={() => void enviar()} data-enviar-post="">
                {enviando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                {geradasSemAprovar.length ? `Aprovar ${geradasSemAprovar.length === 1 ? "a gerada" : `as ${geradasSemAprovar.length} geradas`} e enviar` : "Enviar para o cliente aprovar"}
              </Button>
            )}
          </div>
          <p className="text-[11.5px] text-muted-foreground">
            {post.entrega_status
              ? estado.proximo
              : "A agência revisa, o cliente aprova no portal e o post publica sozinho na data confirmada. Pedido de ajuste do cliente volta para cá."}
          </p>
          <div className="mt-2 flex min-w-0 flex-wrap items-center text-[12px]">
            <Link to={`/mesa?client=${clientId}&aba=entrega`} className="mb-1 mr-3 inline-flex items-center font-medium text-primary hover:underline">
              <CalendarCheck className="mr-1 h-3.5 w-3.5" /> Ver na Entrega da Mesa
            </Link>
            <Link to="/calendario" className="mb-1 mr-3 inline-flex items-center font-medium text-primary hover:underline">
              <ExternalLink className="mr-1 h-3.5 w-3.5" /> Ver na Agenda
            </Link>
          </div>
        </section>
      </div>
      <JanelaDaPublicacao
        aberta={janela}
        onFechar={() => setJanela(false)}
        titulo={post.item ? post.item.title : "Post de fotos"}
        clientId={clientId}
        diaDaPeca={post.item ? post.item.due_date : null}
        peca={{
          id: post.id,
          status: post.status,
          file_ids: post.file_ids,
          entrega_status: post.entrega_status,
          entrega_aviso: post.entrega_aviso,
          post_id: post.post_id,
          aprovado_em: post.aprovado_em,
          publicar_em: post.publicar_em,
          publicar_em_confirmado_em: post.publicar_em_confirmado_em,
          publicar_ao_aprovar: post.publicar_ao_aprovar,
          agenda_aviso: post.agenda_aviso,
          ajustes_do_cliente: post.ajustes_do_cliente,
        }}
        publicacao={post.publicacao ? { id: post.publicacao.id, status: post.publicacao.status, scheduled_at: post.publicacao.scheduled_at, published_at: post.publicacao.published_at, permalink: post.publicacao.permalink } : null}
        podePublicar={podeRecarregar}
        onMudou={() => invalidarPostsDeFotos(queryClient, clientId)}
      />
    </Cartao>
  );
}

export default function EtapaAgenda() {
  const { clientId } = useMesa();
  const { irPara } = useMesaFoto();
  const [params, setParams] = useSearchParams();
  const posts = usePostsDeFotos(clientId);
  const lista = posts.data || [];
  const taskUrl = params.get("task");
  const trabalhoUrl = params.get("trabalho");
  const [aberto, setAberto] = useEstadoDaTela<string | null>(`mesa-foto:agenda:aberto:${clientId}`, null, { validar: (v) => v === null || typeof v === "string" });
  const [montando, setMontando] = useState<{ fotos: string[]; postId: string | null; task: string | null } | null>(null);

  // Fotos que vieram de outra etapa ("Preparar na Agenda"): o post abre montando com elas.
  useEffect(() => {
    const ids = lerDaSessao<string[]>(clientId, CHAVE_DAS_FOTOS_DO_POST);
    if (Array.isArray(ids) && ids.length) setMontando({ fotos: ids.filter((x) => typeof x === "string"), postId: null, task: taskUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Endereço com o item ou o trabalho (caminho do diretor, Agenda, plano do mês): abre o post dele.
  useEffect(() => {
    if (!posts.isSuccess) return;
    const porTrabalho = trabalhoUrl ? lista.find((p) => p.id === trabalhoUrl) : null;
    const porItem = !porTrabalho && taskUrl ? lista.find((p) => p.task_id === taskUrl) : null;
    const achado = porTrabalho || porItem;
    if (achado) setAberto(achado.id);
    else if (taskUrl && !montando) setMontando({ fotos: [], postId: null, task: taskUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts.isSuccess, trabalhoUrl, taskUrl]);

  const postAberto = aberto ? lista.find((p) => p.id === aberto) || null : null;
  const pendentes = lista.filter((p) => estadoDoPostDeFotos(p, p.publicacao).codigo !== "publicado");
  const publicados = lista.filter((p) => estadoDoPostDeFotos(p, p.publicacao).codigo === "publicado");

  const limparEndereco = () => {
    if (!params.get("task") && !params.get("trabalho")) return;
    const n = new URLSearchParams(params);
    n.delete("task");
    n.delete("trabalho");
    setParams(n, { replace: true });
  };

  return (
    <div className="min-w-0 space-y-5" data-etapa-agenda="">
      <div className="flex min-w-0 flex-wrap items-center justify-between">
        <div className="mb-1 mr-3 min-w-0">
          <h2 className="text-[14px] font-semibold">Post na Agenda</h2>
          <p className="text-[12px] text-muted-foreground">Fotos → legenda → data → cliente aprova → publica sozinho.</p>
        </div>
        <SeletorDoPerfil />
      </div>

      {montando ? (
        <MontarOPost
          fotosIniciais={montando.fotos}
          post={montando.postId ? lista.find((p) => p.id === montando.postId) || null : null}
          taskInicial={montando.task}
          onPronto={(trabalhoId) => {
            setMontando(null);
            setAberto(trabalhoId);
            limparEndereco();
          }}
          onCancelar={() => {
            setMontando(null);
            gravarNaSessao(clientId, CHAVE_DAS_FOTOS_DO_POST, null);
            limparEndereco();
          }}
        />
      ) : (
        <div className="flex min-w-0 flex-wrap items-center">
          <Button type="button" size="sm" className="mb-1 mr-2 h-8 text-[12px]" onClick={() => setMontando({ fotos: [], postId: null, task: null })}>
            <CalendarPlus className="mr-1.5 h-3.5 w-3.5" /> Post novo com fotos
          </Button>
          <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-[12px]" onClick={() => irPara("acervo")}>
            Marcar as fotos em Fotos
          </Button>
        </div>
      )}

      {postAberto && !montando && (
        <PostAberto post={postAberto} onTrocarFotos={() => setMontando({ fotos: postAberto.imagem_ids, postId: postAberto.id, task: postAberto.task_id })} />
      )}

      <Cartao titulo={`Posts de fotos${pendentes.length ? ` · ${pendentes.length}` : ""}`} dica="Os posts de fotos do cliente, do mais próximo ao mais distante. Os do plano do mês (perfil só fotos ou alternar) aparecem aqui esperando as fotos.">
        {posts.isLoading && <p className="text-[12px] text-muted-foreground">Lendo os posts...</p>}
        {posts.isError && <p className="text-[12px] text-destructive">Não foi possível ler os posts: {textoDoErro(posts.error)}</p>}
        {posts.isSuccess && !lista.length && (
          <Vazio titulo="Nenhum post de fotos ainda">Marque fotos em Fotos (ou no Estúdio) e use Preparar na Agenda.</Vazio>
        )}
        {pendentes.length > 0 && (
          <ul className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
            {pendentes.map((p) => (
              <LinhaDoPost key={p.id} post={p} aberto={p.id === aberto} onAbrir={() => setAberto(p.id)} />
            ))}
          </ul>
        )}
        {publicados.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[12px] text-muted-foreground">No ar ({publicados.length})</summary>
            <ul className="mt-2 grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
              {publicados.map((p) => (
                <LinhaDoPost key={p.id} post={p} aberto={p.id === aberto} onAbrir={() => setAberto(p.id)} />
              ))}
            </ul>
          </details>
        )}
      </Cartao>
    </div>
  );
}

