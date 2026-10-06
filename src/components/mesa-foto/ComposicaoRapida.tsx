import ColunasDaFoto from "./ColunasDaFoto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { superficie, juntar } from "@/components/sistema/estilos";
import { lazy, Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto } from "@/components/mesa/Custo";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { padraoPara } from "@/lib/mesa/api";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { campo, campoTexto } from "@/components/sistema/estilos";
import { useMesaFoto } from "./Comuns";
import EscolhaDoProduto, { capaDoKit } from "./EscolhaDoProduto";
import EscolhaDoModeloDaFoto from "./EscolhaDoModeloDaFoto";
import { type ModeloEscolhido } from "./escolhasDaLinha";
import { acrescentarFotos, useFotos, useKits, decidirFoto, chaveDosKits, type FotoDoAcervo } from "./fotoApi";
import { useClones } from "./clonesApi";
import { usePersonas, useImagensDaPersona } from "./modelosApi";
import { useCanvases, chaveDosCanvases, canvasVazio, novoNo, porCartao, salvarCanvas, gerarNoCanvas, partesDoGerar, type Canvas } from "./canvasApi";
import SeletorDeFotos from "./SeletorDeFotos";
import { Ampliar, type ImagemAmpliavel } from "@/components/mesa/Ampliar";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import GaleriaDeFotos from "./GaleriaDeFotos";
import { fotoNaGaleria, historicoDaComposicao } from "./organizacaoDasFotos";
import AcoesProDaFoto from "./AcoesProDaFoto";

const FerramentasDaPersona = lazy(() => import("./EtapaModelos").then((m) => ({ default: m.PersonaAberta })));

type Foco = "pessoa" | "composicao" | "produto";
interface Rascunho { luz?: string; enquadramento?: string; pose?: string; pessoa: ModeloEscolhido | null; ambiente: string | null; pedido: string; formato: string; motor: string; resultados: string[]; grupos?: Record<string, string[]>; produtoTratado: string | null; origemKit?: string | null; kitTratado?: string | null; fotoDoKitTratado?: string | null }
const INICIAL: Rascunho = { pessoa: null, ambiente: null, pedido: "", formato: "4:5", motor: "", resultados: [], produtoTratado: null };

/** Três áreas com foco fluido; cada geração grava um Canvas próprio e preserva as fontes. */
export default function ComposicaoRapida({ escopo }: { escopo?: string } = {}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const { kitId, prepararNaAgenda, abrirNoEstudio, irPara } = useMesaFoto();
  const cache = useQueryClient();
  const fotosQ = useFotos(clientId);
  const kits = useKits(clientId);
  const canvases = useCanvases(clientId);
  const [zoom, setZoom] = useState<ImagemAmpliavel | null>(null);
  const clones = useClones(clientId);
  const personas = usePersonas(clientId);
  const [r, setR] = useEstadoDaTela<Rascunho>(escopo || `mesa-foto:composicao:${clientId}`, INICIAL);
  const mudar = (p: Partial<Rascunho>) => setR((a) => ({ ...a, ...p }));
  const [foco, setFoco] = useState<Foco>("composicao");
  const [editarPessoa, setEditarPessoa] = useState(false);
  const [escolhendo, setEscolhendo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [atualPorGrupo, setAtualPorGrupo] = useState<Record<string, string>>({});
  const grupo = `${kitId || "sem-produto"}:${r.pessoa?.tipo || "sem-pessoa"}:${r.pessoa?.id || ""}`;
  const resultadosLocais = r.grupos?.[grupo] || [];
  const registrar = (id: string, noGrupo = grupo) => {
    setR((a) => ({ ...a, grupos: { ...a.grupos, [noGrupo]: Array.from(new Set([id, ...(a.grupos?.[noGrupo] || [])])).slice(0, 50) } }));
    setAtualPorGrupo((a) => ({ ...a, [noGrupo]: id }));
  };
  const fotos = fotosQ.data || [];
  const kit = kits.data?.find((k) => k.id === kitId);
  const capa = kit ? capaDoKit(kit, fotos) : null;
  const produto = r.origemKit === kitId ? fotos.find((f) => f.id === r.produtoTratado) || capa : capa;
  const kitDeGeracao = kitId;
  const ambiente = fotos.find((f) => f.id === r.ambiente);
  const motor = r.motor || padraoPara(catalogo, "imagem")?.id || "";
  const clone = r.pessoa?.tipo === "clone" ? clones.data?.find((c) => c.id === r.pessoa?.id) : null;
  const persona = r.pessoa?.tipo === "persona" ? personas.data?.find((p) => p.id === r.pessoa?.id) : null;
  const retratos = useImagensDaPersona(persona?.id || null);
  const retrato = retratos.data?.find((i) => i.id === persona?.ancora_imagem_id);
  const cloneFoto = fotos.find((f) => f.id === (clone?.identidade_real.find((i) => i.principal) || clone?.identidade_real[0])?.imagem_id);
  const historico = historicoDaComposicao(fotos, canvases.data || [], clientId, [kitId, kitDeGeracao].filter((id): id is string => !!id), r.pessoa, cloneFoto?.id);
  const resultados = Array.from(new Set([...resultadosLocais, ...historico.map((f) => f.id)]));
  const fotosDoGrupo = resultados.map((id) => fotos.find((f) => f.id === id && f.ativa)).filter((f): f is FotoDoAcervo => !!f);
  const atual = fotosDoGrupo.find((f) => f.id === atualPorGrupo[grupo]) || fotosDoGrupo[0] || null;
  const faltaPessoa = r.pessoa?.tipo === "clone" ? !clone?.autorizacao_valida.ok : r.pessoa?.tipo === "persona" ? !persona?.ancora_imagem_id : false;
  const imagem = (foto: FotoDoAcervo | null | undefined, grande = false) => foto ? <button type="button" className="block w-full cursor-zoom-in rounded-lg focus-visible:ring-2 focus-visible:ring-primary" aria-label={`Ampliar ${foto.nome}`} onClick={() => setZoom(fotoNaGaleria(foto))}><ImagemDaMesa caminho={foto.storage_path} bucket={foto.storage_bucket || "mesa"} alt={foto.nome} className={`w-full rounded-lg !object-contain ${grande ? 'h-[360px]' : 'h-72'}`} /></button> : <div className="flex min-h-40 items-center justify-center rounded-lg bg-muted p-4 text-center text-[13px] text-muted-foreground">Escolha as imagens para compor</div>;
  const montar = (): Canvas => {
    let c = canvasVazio(clientId, `Composição · ${kit?.nome || 'Foto'} · ${new Date().toLocaleDateString('pt-BR')}`);
    const saida = novoNo("gerar", 500, 0, { motores: [motor], formato: r.formato, qualidade: "alta" });
    c = { ...c, nos: [saida] };
    c = porCartao(c, novoNo("produto", 0, 0, { kit_id: kitDeGeracao }), { gerarId: saida.id });
    if (persona) c = porCartao(c, novoNo("modelo", 0, 0, { modelo_id: persona.id, versao: persona.versao }), { gerarId: saida.id });
    if (clone?.autorizacao_valida.ok) c = porCartao(c, novoNo("modelo", 0, 0, { imagem_id: (clone.identidade_real.find((i) => i.principal) || clone.identidade_real[0])?.imagem_id, autorizada: true, titulo: clone.nome }), { gerarId: saida.id });
    if (r.ambiente) c = porCartao(c, novoNo("ambiente", 0, 0, { imagem_id: r.ambiente, modo: "foto", uso: "usar" }), { gerarId: saida.id });
    c = porCartao(c, novoNo("texto", 0, 0, { texto: [r.pedido, r.luz && `Luz: ${r.luz}`, r.enquadramento && `Enquadramento: ${r.enquadramento}`, r.pose && `Pose/ação: ${r.pose}`].filter(Boolean).join(". ") }), { gerarId: saida.id });
    return c;
  };
  const estilo = (qual: Foco) => `foto-coluna ${foco === qual ? 'border-primary/50 bg-card' : ''}`;
  return <div className="space-y-3" data-composicao-rapida="">
    <ColunasDaFoto foco={foco} rodape={fotosDoGrupo.length > 0 && <GaleriaDeFotos recolhivel key={grupo} titulo="Fotos desta composição" fotos={fotosDoGrupo.map((f) => fotoNaGaleria(f, f.modo === "canvas" ? "Composições" : "Tratamentos"))} atualId={atual?.id} onSelecionar={(id) => setAtualPorGrupo((a) => ({ ...a, [grupo]: id }))} onUsar={prepararNaAgenda} />}>
      <section className={juntar(superficie.painel, estilo("pessoa"))} aria-label="Modelo ou clone">
        <button className="mb-3 w-full text-left text-[13px] font-semibold" type="button" aria-pressed={foco === 'pessoa'} onClick={() => setFoco('pessoa')}>1. Modelos e clones</button>
        <EscolhaDoModeloDaFoto semPessoa valor={r.pessoa} onEscolher={(pessoa) => mudar({ pessoa })} />
        {retrato && <div className="mt-3"><button type="button" className="block w-full cursor-zoom-in" aria-label="Ampliar modelo" onClick={() => setZoom({ caminho: retrato.storage_path, bucket: retrato.storage_bucket || "mesa", titulo: persona?.nome || "Modelo" })}><ImagemDaMesa caminho={retrato.storage_path} bucket={retrato.storage_bucket || "mesa"} alt={persona?.nome || "Modelo"} className="max-h-80 w-full rounded-lg !object-contain" /></button><button type="button" className="mt-2 text-[12px] text-primary" onClick={() => { setEditarPessoa(!editarPessoa); setFoco("pessoa"); }}>Variações, outros geradores e upscale do modelo</button></div>}
        {cloneFoto && <div className="mt-3">{imagem(cloneFoto, foco === "pessoa")}<AcoesProDaFoto foto={cloneFoto} mostrarCriativo={false} onPronta={(nova) => { acrescentarFotos(cache, clientId, [nova]); abrirNoEstudio?.(nova.id); }} /><button type="button" className="mt-2 text-[12px] text-primary" onClick={() => irPara("clones", { imagem: cloneFoto.id })}>Fotos e variações deste clone</button></div>}

      </section>
      <section className={juntar(superficie.painel, estilo("composicao"))} aria-label="Composição principal">
        <button className="mb-3 w-full text-left text-[13px] font-semibold" type="button" aria-pressed={foco === 'composicao'} onClick={() => setFoco('composicao')}>2. Sua composição</button><AjudaRecolhida rotulo="Como compor">Direção de uma foto: ajuste pose, luz e enquadramento. Para produzir uma série com vários cenários, use Combinar.</AjudaRecolhida>
        {imagem(atual || ambiente, true)}
        <div className="my-3 flex flex-wrap gap-2"><button type="button" className="rounded border px-2 py-1 text-[12px]" onClick={() => setEscolhendo(true)}>{ambiente ? 'Trocar ambiente' : 'Escolher foto do ambiente'}</button>{ambiente && <button type="button" className="text-[12px]" onClick={() => mudar({ ambiente: null })}>Retirar ambiente</button>}</div>
        <label className="block text-[12px]">Ambiente, ação e acabamento<textarea aria-label="Pedido da composição" className={campoTexto} rows={3} value={r.pedido} onChange={(e) => mudar({ pedido: e.target.value })} placeholder="Ex.: produto sobre mármore claro, luz suave de janela, textura realista…" /></label>
        <div className="my-3 grid grid-cols-2 gap-2">{([{ campo: "luz", nome: "Luz", opcoes: ["Natural de janela", "Estúdio suave", "Fim de tarde", "Lateral dramática"] }, { campo: "enquadramento", nome: "Enquadramento", opcoes: ["Plano médio", "Retrato próximo", "Corpo inteiro", "Detalhe do produto"] }] as const).map((c) => <label key={c.campo} className="text-[12px]">{c.nome}<select className={campo} value={r[c.campo] || ""} onChange={(e) => mudar({ [c.campo]: e.target.value })}><option value="">Pela direção</option>{c.opcoes.map((o) => <option key={o}>{o}</option>)}</select></label>)}<label className="col-span-2 text-[12px]">Pose ou ação<input className={campo} value={r.pose || ""} onChange={(e) => mudar({ pose: e.target.value })} placeholder="Ex.: de perfil, segurando o produto à altura do peito" /></label></div><div className="my-2 flex flex-wrap gap-2"><select aria-label="Proporção da composição" className={campo} value={r.formato} onChange={(e) => mudar({ formato: e.target.value })}>{['4:5','1:1','9:16','16:9'].map((f) => <option key={f}>{f}</option>)}</select><SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={motor} onChange={(v) => mudar({ motor: v })} /></div>
        <BotaoComCusto rotulo="Gerar composição" titulo="Gerar composição" descricao="Uma nova foto, preservando produto e pessoa escolhidos." disabled={ocupado || !kit || !motor || !r.pedido.trim() || faltaPessoa} partes={() => partesDoGerar([motor], "alta", Math.min(14, (kit?.refs.length || 0) + (persona ? 5 : clone ? 1 : 0) + (ambiente ? 1 : 0)))} executar={async () => {
          setOcupado(true);
          try {
            const salvo = await salvarCanvas(montar());
            if (!salvo.id) throw new Error('Não foi possível salvar a composição. Nenhuma geração foi iniciada.');
            const saida = salvo.nos.find((n) => n.tipo === 'gerar');
            if (!saida) throw new Error('A composição não tem saída.');
            const resposta = await gerarNoCanvas({ canvasId: salvo.id, gerarId: saida.id, motorId: motor, qualidade: 'alta' });
            if (!resposta.imagem) throw new Error('A geração não devolveu uma imagem pronta. Consulte o Canvas antes de tentar novamente.');
            return { ...resposta, grupo };
          } finally { setOcupado(false); }
        }} aoConcluir={(resposta) => { if (resposta.imagem) { acrescentarFotos(cache, clientId, [resposta.imagem]); registrar(resposta.imagem.id, resposta.grupo); void cache.invalidateQueries({ queryKey: chaveDosCanvases(clientId) }); } atualizarCusto(); }} />
        {!kitId && <p className="mt-2 text-[12px]">Escolha o produto à direita para começar.</p>}
        {atual && <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="rounded border px-2 py-1 text-[12px]" onClick={() => abrirNoEstudio?.(atual.id)}>Melhorar esta foto</button><button type="button" className="rounded border px-2 py-1 text-[12px]" onClick={() => prepararNaAgenda?.([atual.id])}>Usar no post</button><AcoesProDaFoto foto={atual} onPronta={(nova) => { acrescentarFotos(cache, clientId, [nova]); registrar(nova.id); }} /></div>}
      </section>
      <section className={juntar(superficie.painel, estilo("produto"))} aria-label="Produto e ferramentas">
        <button className="mb-3 w-full text-left text-[13px] font-semibold" type="button" aria-pressed={foco === 'produto'} onClick={() => setFoco('produto')}>3. Produto</button>
        <EscolhaDoProduto />
        <div className="mt-3">{imagem(produto)}</div>
        {produto && <div className="mt-3"><AcoesProDaFoto foto={produto} onPronta={(nova) => { mudar({ produtoTratado: nova.id, origemKit: kitId }); toast.info('Confira a versão tratada e use o botão para aplicá-la à composição.'); }} /><button type="button" className="mt-2 text-[12px] text-primary" onClick={() => abrirNoEstudio?.(produto.id)}>Luz, cor e realismo</button></div>}
        {produto && produto.id !== capa?.id && kit && <button type="button" disabled={ocupado || (r.fotoDoKitTratado === produto.id && !!r.kitTratado)} className="mt-3 rounded-md border px-3 py-2 text-[12px]" onClick={async () => {
          setOcupado(true);
          try {
            const aprovada = await decidirFoto(clientId, produto.id, "aprovar");
            if (!aprovada?.aprovada) throw new Error("A aprovação da referência não foi confirmada.");
            acrescentarFotos(cache, clientId, [aprovada]);
            mudar({ kitTratado: kit.id, fotoDoKitTratado: produto.id, origemKit: kitId });
            void cache.invalidateQueries({ queryKey: chaveDosKits(clientId) });
            toast.success("Esta versão será usada na próxima composição.");
          } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível usar esta versão."); }
          finally { setOcupado(false); }
        }}>{r.fotoDoKitTratado === produto.id && r.kitTratado ? "Versão tratada em uso" : "Aprovar e usar esta versão"}</button>}
      </section>
    </ColunasDaFoto>
    {escolhendo && <SeletorDeFotos fotos={fotos} titulo="Foto real do ambiente" multiplas={false} onUsar={(ids) => { mudar({ ambiente: ids[0] || null }); setEscolhendo(false); }} onFechar={() => setEscolhendo(false)} />}

    {canvases.isError && <p role="status" className="text-[12px] text-muted-foreground">Histórico remoto indisponível. As fotos desta sessão continuam acessíveis.</p>}
    <Ampliar imagens={zoom ? [zoom] : []} indice={zoom ? 0 : null} onFechar={() => setZoom(null)} />
    <JanelaCentral aberta={editarPessoa && !!persona} onFechar={() => setEditarPessoa(false)} titulo={`Fotos de ${persona?.nome || "modelo"}`} largura="xl">
      {persona && <Suspense fallback={<p role="status">Abrindo versões do modelo…</p>}><FerramentasDaPersona key={persona.id} persona={persona} /></Suspense>}
    </JanelaCentral>
  </div>;
}
