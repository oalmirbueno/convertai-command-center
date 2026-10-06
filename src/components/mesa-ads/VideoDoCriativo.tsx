import { lazy, Suspense, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Clapperboard, ImagePlus, Settings2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { PreviaDaPauta } from "@/components/mesa/BancadaDaPauta";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo } from "@/components/sistema/estilos";
import { useFotos } from "@/components/mesa-foto/fotoApi";
import { BotaoDeGerar, EscolherImagem } from "@/components/mesa-videos/PecasDoGerador";
import GeracoesRecentes from "@/components/mesa-videos/GeracoesRecentes";
import { chamarMesaVideos, chaveDosPedidos, useArquivosDeVideo, usePedidos } from "@/components/mesa-videos/videosApi";
import { custoNaTela, novoUid, useMotoresDaMesa } from "@/lib/mesa-videos/api";
import { subirQuadro } from "@/lib/mesa-videos/quadros";
import { supabase } from "@/integrations/supabase/client";
import { handoffWorkspaceFileToFiles, type WorkspaceFileForHandoff } from "@/lib/workspaceFileHandoff";
import { requestFileAgencyReview } from "@/lib/fileApprovalActions";
import { MOVIMENTOS_DA_HIGGSFIELD } from "../../../supabase/functions/mesa-videos/modulos/video-provedor-higgsfield";
import { CONCEITOS_DE_VIDEO_ADS, conceitoDeVideo, direcaoDoVideoAds, resultadosDoVideoAds } from "./videoDoAnuncio";
import type { CriativoAds } from "./adsApi";
const SeletorDeFotos = lazy(() => import("@/components/mesa-foto/SeletorDeFotos"));

interface Rascunho { conceito: string; prompt: string; referencias: string[]; formato: string; duracao: number; resolucao: string; audio: boolean; narracao: string; camera: string }

export default function VideoDoCriativo({ criativo, referencia }: { criativo: CriativoAds; referencia?: string | null }) {
  const { clientId, clientName, userId, isAdmin, atualizarCusto } = useMesa();
  const cache = useQueryClient();
  const motores = useMotoresDaMesa();
  const entrada = motores.lista.find((m) => m.motor.id === "higgsfield-cinema-4");
  const arquivos = useArquivosDeVideo(clientId);
  const pedidos = usePedidos(clientId);
  const fotos = useFotos(clientId);
  const [r, setR] = useEstadoDaTela<Rascunho>(`ads:video:v1:${clientId}:${criativo.id}`, { conceito: "produto", prompt: direcaoDoVideoAds(criativo, clientName, "produto"), referencias: referencia?.startsWith(`${clientId}/`) ? [referencia] : [], formato: "9:16", duracao: 6, resolucao: "720p", audio: false, narracao: "", camera: "slow-zoom-in" });
  const mudar = (v: Partial<Rascunho>) => setR((p) => ({ ...p, ...v }));
  const [aba, setAba] = useState("direcao");
  const [buscando, setBuscando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [vista, setVista] = useState<string | null>(null);
  const tentativa = useRef<{ assinatura: string; uid: string } | null>(null);
  const resultados = resultadosDoVideoAds(clientId, criativo.id, arquivos.data?.arquivos || [], pedidos.data?.itens || []);
  const video = resultados.find((a) => a.id === vista) || resultados[0];
  const custo = custoNaTela(entrada?.motor || null, { duracao_s: r.duracao, resolucao: r.resolucao, audio: r.audio, referencias: r.referencias.length, variacoes: 1 });
  const prompt = [r.prompt, r.audio && r.narracao.trim() && `Narração em português brasileiro, natural e clara: ${r.narracao.trim()}`].filter(Boolean).join("\n");
  const motivo = ocupado ? "Aguarde o arquivo." : entrada?.estado !== "pronto" ? "Conecte a Higgsfield em Configurações → Chaves e custos." : !prompt.trim() ? "Descreva o vídeo." : prompt.length > 2400 ? "Reduza a direção e a narração para até 2.400 caracteres." : null;
  const gerar = async (usd: number) => {
    const corpo = { acao: "gerar_video", client_id: clientId, ads_criativo_id: criativo.id, motor: "higgsfield-cinema-4", tipo: "gerar_livre", modo: r.referencias.length ? "referencia" : "texto", prompt, titulo: `${criativo.nome || criativo.copy.titulo || "Anúncio"} · ${conceitoDeVideo(r.conceito).nome}`, formato: r.formato, duracao_s: r.duracao, resolucao: r.resolucao, audio: r.audio, referencias_paths: r.referencias, camera: r.camera, variacoes: 1, custo_confirmado_usd: usd };
    const assinatura = JSON.stringify(corpo);
    if (tentativa.current?.assinatura !== assinatura) tentativa.current = { assinatura, uid: novoUid() };
    const resp = await chamarMesaVideos<{ pedido_id?: string; estado?: string; erro?: string }>({ ...corpo, uid: tentativa.current.uid });
    if (!resp.pedido_id) throw new Error("O servidor não confirmou a geração.");
    await cache.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
    atualizarCusto();
    tentativa.current = null;
    toast.success("Pedido registrado", { description: "Acompanhe o andamento no histórico deste criativo." });
  };
  const usarFotos = async (ids: string[]) => {
    setOcupado(true);
    try {
      const foto = fotos.data?.find((f) => f.id === ids[0] && f.client_id === clientId);
      if (!foto) throw new Error("Foto indisponível neste cliente.");
      let caminho = foto.storage_path;
      if ((foto.storage_bucket || "mesa") !== "mesa" || !caminho.startsWith(`${clientId}/`)) {
        const { data, error } = await supabase.storage.from(foto.storage_bucket || "mesa").download(caminho);
        if (error || !data) throw new Error("Não foi possível carregar a foto do Workspace.");
        if (data.size > 20 * 1024 * 1024) throw new Error("Use uma imagem de até 20 MB.");
        caminho = await subirQuadro(clientId, data, foto.nome);
      }
      mudar({ referencias: Array.from(new Set([...r.referencias, caminho])).slice(0, 4) });
      setBuscando(false);
      toast.success("Referência adicionada ao vídeo.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível usar a foto."); }
    finally { setOcupado(false); }
  };
  const entregar = async () => {
    if (!video || !userId) return;
    setOcupado(true);
    try {
      const res = await chamarMesaVideos<{ client_id: string; workspace: { node_id: string | null } }>({ acao: "final_para_workspace", arquivo_id: video.id });
      if (res.client_id !== clientId || !res.workspace.node_id) throw new Error("Workspace não confirmou o vídeo.");
      const { data, error } = await supabase.from("workspace_nodes").select("id, client_id, kind, name, mime, size_bytes, storage_path, sent_for_approval_file_id").eq("id", res.workspace.node_id).eq("client_id", clientId).single();
      if (error || !data) throw new Error("Não foi possível conferir o arquivo salvo.");
      const arquivo = await handoffWorkspaceFileToFiles({ node: data as WorkspaceFileForHandoff, clientId, userId, fileName: video.nome, folder: "materiais", fileType: "creative", projectId: null });
      await requestFileAgencyReview(arquivo.fileId);
      toast.success("Vídeo enviado para revisão da agência", { description: "Disponível em Arquivos. A publicação do anúncio continua sob sua aprovação." });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Revisão não confirmada."); }
    finally { setOcupado(false); }
  };
  const abas = [{ id: "direcao", nome: "Direção", Icone: Clapperboard }, { id: "fotos", nome: "Referências", Icone: ImagePlus }, { id: "camera", nome: "Câmera e áudio", Icone: Settings2 }];
  return <div className="space-y-3" data-ads-video="">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium">Higgsfield · Cinema Studio 4.0</span><BotaoDeGerar custo={custo} motivo={motivo} rotulo="Gerar vídeo" onConfirmar={gerar} /></div>
    {entrada?.estado !== "pronto" && <div className="flex items-center justify-between rounded-lg border p-3 text-xs" role="status"><span>{motores.carregando ? "Conferindo conexão…" : entrada?.estado_rotulo || "Conexão indisponível"} · A direção pode ser preparada agora.</span><div className="flex shrink-0 items-center">{isAdmin && <a className={botao.discreto} href="/config?secao=chaves&chave=higgsfield" target="_blank" rel="noopener noreferrer">Conectar</a>}<button className={botao.discreto} onClick={motores.recarregar}>Conferir conexão</button></div></div>}
    <div className="ads-stage">
      <div className="ads-stage-preview rounded-xl border bg-card p-3">
        {buscando ? <div className="min-h-0 flex-1 overflow-y-auto"><Suspense fallback={<p>Carregando fotos…</p>}><SeletorDeFotos fotos={(fotos.data || []).filter((f) => !f.referencia_web)} titulo="Referências do cliente" multiplas={false} onFechar={() => setBuscando(false)} onUsar={(ids) => void usarFotos(ids)} /></Suspense></div> : video ? <PreviaDaPauta key={video.id} caminho={video.storage_path} bucket={video.storage_bucket} nome={video.nome} video /> : <div className="flex flex-1 flex-col items-center justify-center gap-4 p-5 text-center"><Clapperboard className="h-10 w-10 text-primary" /><p className="font-medium">{conceitoDeVideo(r.conceito).nome}</p><p className="max-w-lg text-sm text-muted-foreground">{conceitoDeVideo(r.conceito).texto}</p><span className="text-xs text-muted-foreground">{r.duracao}s · {r.formato} · {r.resolucao} · {r.referencias.length} referência(s)</span></div>}
        {!!resultados.length && <div className="flex items-center gap-2 border-t pt-2"><select aria-label="Versão do vídeo" className={campo} value={video?.id || ""} onChange={(e) => setVista(e.target.value)}>{resultados.map((a, i) => <option key={a.id} value={a.id}>Versão {resultados.length - i} · {a.nome}</option>)}</select><button title="Enviar esta versão para revisão da agência em Arquivos" className={botao.discreto} disabled={ocupado} onClick={() => void entregar()}><Send className="mr-1 h-4 w-4" />Revisão</button></div>}
      </div>
      <div className="ads-stage-tools rounded-xl border bg-card">
        <nav className="flex border-b p-1" aria-label="Ferramentas do vídeo">{abas.map(({ id, nome, Icone }) => <button key={id} title={nome} aria-label={nome} aria-pressed={aba === id} onClick={() => setAba(id)} className={`flex h-9 flex-1 items-center justify-center rounded-md ${aba === id ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}><Icone className="h-4 w-4" /></button>)}</nav>
        <div className="space-y-4 p-3">
          {aba === "direcao" && <><label className="block text-xs">Conceito<select className={campo} value={r.conceito} onChange={(e) => { const c = conceitoDeVideo(e.target.value); mudar({ conceito: c.id, prompt: direcaoDoVideoAds(criativo, clientName, c.id), camera: c.camera }); }}>{CONCEITOS_DE_VIDEO_ADS.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label><label className="block text-xs">Direção do vídeo<textarea className={`${campo} mt-1 min-h-[200px] resize-y`} value={r.prompt} onChange={(e) => mudar({ prompt: e.target.value })} /></label><div className="ads-video-options"><label className="text-xs">Formato<select className={campo} value={r.formato} onChange={(e) => mudar({ formato: e.target.value })}>{["9:16", "16:9", "1:1", "3:4"].map((f) => <option key={f}>{f}</option>)}</select></label><label className="text-xs">Duração<select className={campo} value={r.duracao} onChange={(e) => mudar({ duracao: Number(e.target.value) })}>{[4, 6, 8, 10, 15, 20, 30].map((s) => <option key={s} value={s}>{s}s</option>)}</select></label><label className="text-xs">Qualidade<select className={campo} value={r.resolucao} onChange={(e) => mudar({ resolucao: e.target.value })}><option>480p</option><option>720p</option></select></label></div></>}
          {aba === "fotos" && <><h3 className="text-sm font-medium">Referências · {r.referencias.length}/4</h3>{r.referencias.map((path, i) => <div key={path} className="flex items-center gap-2"><EscolherImagem rotulo={`Referência ${i + 1}`} valor={path} onEscolher={(p) => mudar({ referencias: r.referencias.map((x) => x === path && p ? p : x) })} /><button aria-label={`Remover referência ${i + 1}`} className={botao.icone} onClick={() => mudar({ referencias: r.referencias.filter((x) => x !== path) })}><X className="h-4 w-4" /></button></div>)}{r.referencias.length < 4 && <><EscolherImagem rotulo="Adicionar imagem" valor={null} onEscolher={(p) => p && mudar({ referencias: Array.from(new Set([...r.referencias, p])) })} /><button className={botao.discreto} disabled={ocupado} onClick={() => setBuscando(true)}>Fotos e Workspace do cliente</button></>}<p className="text-xs text-muted-foreground">As imagens orientam o produto, a pessoa e o cenário. Não fixam um quadro exato.</p></>}
          {aba === "camera" && <><label className="block text-xs">Movimento<select className={campo} value={r.camera} onChange={(e) => mudar({ camera: e.target.value })}>{MOVIMENTOS_DA_HIGGSFIELD.map((m) => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}</select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.audio} onChange={(e) => mudar({ audio: e.target.checked })} />Gerar áudio com o vídeo</label>{r.audio && <label className="block text-xs">Narração sugerida (opcional)<textarea className={`${campo} mt-1 min-h-[100px]`} value={r.narracao} onChange={(e) => mudar({ narracao: e.target.value })} /><span className="mt-2 block text-muted-foreground">O motor compõe voz e som. Confira fala e pronúncia na prévia antes de aprovar.</span></label>}</>}
        </div>
      </div>
    </div>
    <GeracoesRecentes arquivos={resultados} criativoId={criativo.id} />
    {(arquivos.isError || pedidos.isError) && <p role="alert" className="text-sm">Não foi possível ler o histórico. <button onClick={() => { void arquivos.refetch(); void pedidos.refetch(); }}>Tentar novamente</button></p>}
  </div>;
}
