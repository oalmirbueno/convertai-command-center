import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileDown, Loader2, Mic, Upload, Video } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto } from "@/components/mesa/Custo";
import { PreviaDaPauta } from "@/components/mesa/BancadaDaPauta";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, juntar, superficie } from "@/components/sistema/estilos";
import { padraoPara } from "@/lib/mesa/api";
import { supabase } from "@/integrations/supabase/client";
import { handoffWorkspaceFileToFiles, type WorkspaceFileForHandoff } from "@/lib/workspaceFileHandoff";
import { requestFileAgencyReview } from "@/lib/fileApprovalActions";
import { baixarBytes } from "@/components/mesa-roteiros/pdfNoNavegador";
import { chamarMesaVideos, chaveDosArquivos, subirVideos, useArquivosDeVideo } from "@/components/mesa-videos/videosApi";
import { chavesAds, lerOfertas, type Angulo, type CriativoAds, type PlanoAds } from "./adsApi";
import {
  conteudoAtual,
  corpoDaGravacao,
  gerarRoteiroDoAnuncio,
  linkDaMesaRoteiros,
  OPCOES_PADRAO,
  partesDaGravacao,
  useRoteiroDoCriativo,
  type OpcoesDaGravacao,
  type RespostaDoAnuncio,
} from "./roteiroDoAnuncio";
import { ehSoFala, gerarPdfDoAnuncio, nomeDoPdfDoAnuncio, tempoDeLeitura } from "./pdfDoRoteiroDoAnuncio";
import {
  DURACOES_DO_ANUNCIO,
  ESTRUTURAS_DE_ANUNCIO,
  FORMATOS_DO_ANUNCIO,
  type DuracaoDoAnuncio,
  type FormatoDoAnuncio,
  type IdDaEstrutura,
  type ModoDoAnuncio,
} from "../../../supabase/functions/mesa-roteiros/modulos/roteiro-de-anuncio";

/**
 * "Gravar nós mesmos" (Mesa Ads > Estúdio > Vídeo, 23/10/2026). O dono:
 * "roteiros, cenas e ambientação, ou só o texto de fala, para gravarmos os
 * criativos em vídeo da maneira que converte". O roteiro é gerado PELA Mesa
 * Roteiros (anuncio_gerar: 2 versões, o Jev escolhe), aparece aqui resumido,
 * baixa em PDF para a equipe gravar e abre na Mesa Roteiros para editar.
 * Gravado o vídeo, "Subir o vídeo gravado" usa o fluxo de vídeo que a Mesa Ads
 * já tem: Workspace, Arquivos e revisão da agência; subir na Meta continua
 * pausado e com aprovação. O gerador do Higgsfield não muda.
 */

const OPCOES_DO_MODO = [
  { valor: "completo", rotulo: "Roteiro completo", icone: <Video className="h-3.5 w-3.5" aria-hidden="true" /> },
  { valor: "fala", rotulo: "Só a fala", icone: <Mic className="h-3.5 w-3.5" aria-hidden="true" /> },
];

export default function GravarDoCriativo({ criativo, plano, angulo }: { criativo: CriativoAds; plano?: PlanoAds | null; angulo?: Angulo | null }) {
  const mesa = useMesa();
  const { clientId, clientName, userId } = mesa;
  const qc = useQueryClient();
  const [o, setO] = useEstadoDaTela<OpcoesDaGravacao>(`ads:gravar:v1:${clientId}:${criativo.id}`, OPCOES_PADRAO);
  const mudar = (v: Partial<OpcoesDaGravacao>) => setO((p) => ({ ...OPCOES_PADRAO, ...p, ...v }));
  const roteiro = useRoteiroDoCriativo(clientId, criativo.id, o.roteiroId);
  const atual = conteudoAtual(roteiro.data || null);
  const padrao = padraoPara(mesa.catalogo, "estrategista");
  const modeloId = padrao ? padrao.id : "";
  const ofertas = useQuery({ queryKey: chavesAds.ofertas(clientId), queryFn: () => lerOfertas(clientId), retry: false, enabled: !!clientId });
  const ofertaId = plano && plano.estrutura && typeof plano.estrutura.oferta_id === "string" ? plano.estrutura.oferta_id : null;
  const oferta = ofertaId ? (ofertas.data || []).filter((x) => x.id === ofertaId)[0] || null : null;
  const arquivos = useArquivosDeVideo(clientId);
  const linha = roteiro.data || null;
  const gravados = linha ? (arquivos.data?.arquivos || []).filter((a) => a.client_id === clientId && a.roteiro_id === linha.id && a.estado !== "arquivado" && (a.mime || "").indexOf("video/") === 0) : [];
  const [subindo, setSubindo] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const soFala = atual ? ehSoFala(atual.roteiro) : o.modo === "fala";
  const leitura = atual ? tempoDeLeitura(atual.roteiro) : null;
  const textoDaOferta = oferta ? [oferta.nome, oferta.promessa].filter(Boolean).join(": ") : criativo.copy.texto_principal || null;

  const aoGerar = (data: RespostaDoAnuncio) => {
    const id = data && data.roteiro ? data.roteiro.id : null;
    mudar({
      roteiroId: id || o.roteiroId,
      porque: data && data.escolha ? data.escolha.porque : null,
      estruturaNome: data && data.escolha ? (ESTRUTURAS_DE_ANUNCIO.filter((e) => e.id === data.escolha!.estrutura)[0] || { nome: null }).nome : null,
      referencias: (data && data.referencias) || [],
    });
    if (data && data.vinculo && data.vinculo.aviso) toast.warning("Roteiro guardado sem o vínculo", { description: data.vinculo.aviso });
    if (data && data.aviso_banco) toast.warning("Roteiro gerado sem guardar", { description: data.aviso_banco });
    if (data && data.web && data.web.pedida && !data.web.usada) toast.info("A busca na web ficou de fora", { description: "O modelo não conseguiu buscar agora; o roteiro saiu só com a base da casa." });
    void qc.invalidateQueries({ queryKey: ["mesa-ads", "roteiro-do-criativo", clientId, criativo.id] });
    void qc.invalidateQueries({ queryKey: ["mesa-roteiros", "roteiros", clientId] });
  };

  const baixarPdf = () => {
    if (!atual || !linha) return;
    try {
      const bytes = gerarPdfDoAnuncio({
        cliente: clientName,
        roteiro: atual.roteiro,
        modo: soFala ? "fala" : "completo",
        criativo: criativo.copy.titulo || criativo.nome || "Criativo",
        oferta: textoDaOferta,
        cta: criativo.copy.cta_meta || null,
        porque: o.porque,
        estrutura: o.estruturaNome,
        referencias: o.referencias,
        versao: atual.versao,
        rascunho: linha.status === "rascunho",
      });
      baixarBytes(bytes, nomeDoPdfDoAnuncio(clientName, atual.roteiro.titulo, atual.versao));
    } catch (e) {
      toast.error("O PDF não foi gerado", { description: e instanceof Error ? e.message : "Tente de novo." });
    }
  };

  /** Fluxo de vídeo da Mesa Ads: acervo de vídeo ligado ao roteiro, Workspace, Arquivos e revisão da agência. */
  const subir = async (arquivo: File | null) => {
    if (!arquivo || !linha || !userId) return;
    setSubindo("Enviando o vídeo…");
    try {
      const r = await subirVideos(clientId, [arquivo], () => undefined);
      const video = r.registrados[0];
      if (!video) throw new Error((r.recusados[0] && r.recusados[0].motivo) || r.aviso || "O vídeo não subiu.");
      setSubindo("Ligando ao roteiro…");
      await chamarMesaVideos({ acao: "arquivo_editar", arquivo_id: video.id, campos: { roteiro_id: linha.id } });
      setSubindo("Enviando para revisão…");
      const res = await chamarMesaVideos<{ client_id: string; workspace: { node_id: string | null } }>({ acao: "final_para_workspace", arquivo_id: video.id });
      if (res.client_id !== clientId || !res.workspace.node_id) throw new Error("Workspace não confirmou o vídeo.");
      const { data, error } = await supabase.from("workspace_nodes").select("id, client_id, kind, name, mime, size_bytes, storage_path, sent_for_approval_file_id").eq("id", res.workspace.node_id).eq("client_id", clientId).single();
      if (error || !data) throw new Error("Não foi possível conferir o arquivo salvo.");
      const nome = `${criativo.copy.titulo || criativo.nome || "Anúncio"} · gravado`;
      const doArquivo = await handoffWorkspaceFileToFiles({ node: data as WorkspaceFileForHandoff, clientId, userId, fileName: nome, folder: "materiais", fileType: "creative", projectId: null });
      await requestFileAgencyReview(doArquivo.fileId);
      toast.success("Vídeo gravado enviado para revisão", { description: "Está em Arquivos, ligado ao roteiro. Subir na Meta continua pausado e com a sua aprovação." });
    } catch (e) {
      toast.error("O vídeo não foi enviado", { description: e instanceof Error ? e.message : "Tente de novo." });
    } finally {
      setSubindo(null);
      if (entrada.current) entrada.current.value = "";
      void qc.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
    }
  };

  const opcoes = (
    <div className={juntar(superficie.painel, "min-w-0 space-y-4 p-3")} data-gravar-opcoes="">
      <div className="space-y-1.5">
        <span className="block text-[12px] leading-4 text-muted-foreground">O que gravar</span>
        <SeletorCompacto rotulo="O que gravar" opcoes={OPCOES_DO_MODO} valor={o.modo} onEscolher={(v) => mudar({ modo: v as ModoDoAnuncio })} larguraTotal />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
        <label className="min-w-0 text-[12px] leading-4">Formato
          <select className={juntar(campo, "mt-1")} value={o.formato} onChange={(e) => mudar({ formato: e.target.value as FormatoDoAnuncio })}>
            {FORMATOS_DO_ANUNCIO.map((f) => <option key={f.id} value={f.id}>{f.rotulo}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-[12px] leading-4">Duração
          <select className={juntar(campo, "mt-1")} value={o.duracao} onChange={(e) => mudar({ duracao: Number(e.target.value) as DuracaoDoAnuncio })}>
            {DURACOES_DO_ANUNCIO.map((s) => <option key={s} value={s}>{s} s</option>)}
          </select>
        </label>
      </div>
      <label className="block text-[12px] leading-4">Estrutura que converte
        <select className={juntar(campo, "mt-1")} value={o.estrutura} onChange={(e) => mudar({ estrutura: e.target.value as IdDaEstrutura | "auto" })}>
          <option value="auto">Automática: 2 estruturas, o Jev escolhe</option>
          {ESTRUTURAS_DE_ANUNCIO.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      </label>
      <label className="flex items-start gap-2 text-[13px] leading-5">
        <input type="checkbox" className="mt-1" checked={o.web} onChange={(e) => mudar({ web: e.target.checked })} />
        <span>Consultar anúncios rodando na web, com fonte</span>
      </label>
      <BotaoComCusto
        rotulo={atual ? "Gerar de novo" : "Gerar roteiro"}
        titulo="Roteiro do anúncio gerado"
        className="h-9 w-full"
        disabled={!modeloId}
        descricao="A Mesa Roteiros escreve 2 versões com o criativo, o ângulo e a oferta; o Jev escolhe a mais forte."
        partes={() => partesDaGravacao(modeloId, o)}
        executar={() => gerarRoteiroDoAnuncio(corpoDaGravacao(clientId, criativo.id, o, modeloId))}
        aoConcluir={(data) => aoGerar(data as RespostaDoAnuncio)}
      />
      <AjudaRecolhida rotulo="Saiba mais">
        Gerado pela Mesa Roteiros com o criativo, o ângulo{angulo ? ` (${angulo.nome})` : ""}, a oferta, o público e o nicho, a base dos agentes e os ganchos vencedores da casa. Estruturas: gancho nos 3 primeiros segundos, problema, demonstração, prova, oferta e CTA; UGC falado; antes e depois; objeção e resposta. Duas versões, uma escolha do Jev (gancho, clareza, venda e nicho), sem segunda rodada. Conversão se mede depois de veicular.
      </AjudaRecolhida>
    </div>
  );

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]" data-ads-gravar="">
      <div className="min-w-0 lg:order-2">{opcoes}</div>
      <div className="min-w-0 space-y-4 lg:order-1">
        {roteiro.isLoading ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted/70" role="status" aria-label="Carregando o roteiro" />
        ) : roteiro.isError ? (
          <p role="alert" className="text-[13px] leading-5">Não foi possível ler o roteiro. <button type="button" className="text-primary underline" onClick={() => void roteiro.refetch()}>Tentar novamente</button></p>
        ) : !atual || !linha ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-6 text-center">
            <Video className="h-9 w-9 text-primary" aria-hidden="true" />
            <p className="text-[14px] font-medium leading-5">Roteiro para a equipe gravar</p>
            <p className="max-w-md text-[13px] leading-5 text-muted-foreground">Escolha o que gravar, o formato e a duração.</p>
          </div>
        ) : (
          <section className="min-w-0 space-y-3" aria-label="Roteiro do anúncio" data-roteiro-do-anuncio="">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-[15px] font-medium leading-5">{atual.roteiro.titulo}</h3>
                <p className="mt-1 text-[12px] leading-4 text-muted-foreground">
                  {[o.estruturaNome || atual.roteiro.subtitulo, `${atual.roteiro.formato} · ${atual.roteiro.duracao_alvo_s} s`, leitura ? `fala lida em ~${leitura.total} s` : null, `versão ${atual.versao}`, linha.status === "rascunho" ? "rascunho" : linha.status].filter(Boolean).join(" · ")}
                </p>
                {o.porque && <p className="mt-1 text-[12px] leading-4">Jev: {o.porque}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                <button type="button" className={botao.secundario} onClick={baixarPdf}><FileDown className="mr-1.5 h-4 w-4" aria-hidden="true" />Baixar PDF</button>
                <a className={botao.discreto} href={linkDaMesaRoteiros(clientId, linha.id)} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />Abrir na Mesa Roteiros</a>
              </div>
            </div>
            <ol className="min-w-0 divide-y divide-border border-y border-border">
              {atual.roteiro.blocos.map((b, i) => (
                <li key={b.id || i} className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)] gap-x-2 py-2.5">
                  <span className="text-[13px] font-medium tabular-nums text-primary">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 space-y-1">
                    <p className="text-[12px] leading-4 text-muted-foreground">{[b.funcao, `${b.segundos} s`].filter(Boolean).join(" · ")}</p>
                    <p className="break-words text-[13px] leading-5">{b.fala || "(sem fala)"}</p>
                    {!soFala && b.visual && <p className="break-words text-[12px] leading-4 text-muted-foreground">Plano: {b.visual}</p>}
                    {!soFala && b.texto_na_tela && <p className="break-words text-[12px] leading-4 text-muted-foreground">Na tela: {b.texto_na_tela}</p>}
                  </div>
                </li>
              ))}
            </ol>
            {atual.roteiro.cta && <p className="text-[13px] leading-5"><span className="text-muted-foreground">CTA final: </span>{atual.roteiro.cta}</p>}
            {!soFala && (atual.roteiro.direcao.ambiente || atual.roteiro.direcao.figurino) && (
              <p className="break-words text-[12px] leading-4 text-muted-foreground">{[atual.roteiro.direcao.ambiente && `Ambientação: ${atual.roteiro.direcao.ambiente}`, atual.roteiro.direcao.figurino && `Figurino: ${atual.roteiro.direcao.figurino}`].filter(Boolean).join(" · ")}</p>
            )}
            {o.referencias.length > 0 && (
              <div className="space-y-1">
                <p className="text-[12px] leading-4 text-muted-foreground">Referências consultadas na web</p>
                <ul className="space-y-1">
                  {o.referencias.map((r) => <li key={r.url} className="min-w-0 truncate text-[12px] leading-4"><a className="text-primary underline" href={r.url} target="_blank" rel="noopener noreferrer">{r.titulo}</a></li>)}
                </ul>
              </div>
            )}
            <div className="space-y-2 border-t border-border pt-3" data-subir-gravado="">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium leading-5">Vídeo gravado{gravados.length ? ` · ${gravados.length}` : ""}</span>
                <button type="button" className={botao.primario} disabled={!!subindo} onClick={() => entrada.current && entrada.current.click()}>
                  {subindo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                  {subindo || "Subir o vídeo gravado"}
                </button>
                <input ref={entrada} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" className="hidden" aria-label="Vídeo gravado" onChange={(e) => void subir(e.target.files && e.target.files[0] ? e.target.files[0] : null)} />
              </div>
              {gravados[0] && <div className="max-w-sm"><PreviaDaPauta key={gravados[0].id} caminho={gravados[0].storage_path} bucket={gravados[0].storage_bucket} nome={gravados[0].nome} video compacta /></div>}
              <AjudaRecolhida rotulo="Saiba mais">O vídeo entra pelo fluxo de vídeo da Mesa Ads: fica ligado a este roteiro, vai para Arquivos e pede a revisão da agência. A subida na Meta continua pausada e com a sua aprovação.</AjudaRecolhida>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

