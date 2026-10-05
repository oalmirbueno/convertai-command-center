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
import { acrescentarFotos, useFotos, useKits, salvarKit, decidirFoto, chaveDosKits, type FotoDoAcervo } from "./fotoApi";
import { useClones } from "./clonesApi";
import { usePersonas, useImagensDaPersona } from "./modelosApi";
import { canvasVazio, novoNo, porCartao, salvarCanvas, gerarNoCanvas, partesDoGerar, type Canvas } from "./canvasApi";
import SeletorDeFotos from "./SeletorDeFotos";
import AcoesProDaFoto from "./AcoesProDaFoto";

const FerramentasDaPersona = lazy(() => import("./EtapaModelos").then((m) => ({ default: m.PersonaAberta })));

type Foco = "pessoa" | "composicao" | "produto";
interface Rascunho { pessoa: ModeloEscolhido | null; ambiente: string | null; pedido: string; formato: string; motor: string; resultados: string[]; grupos?: Record<string, string[]>; produtoTratado: string | null; origemKit?: string | null; kitTratado?: string | null; fotoDoKitTratado?: string | null }
const INICIAL: Rascunho = { pessoa: null, ambiente: null, pedido: "", formato: "4:5", motor: "", resultados: [], produtoTratado: null };

/** Três áreas com foco fluido; cada geração grava um Canvas próprio e preserva as fontes. */
export default function ComposicaoRapida({ escopo }: { escopo?: string } = {}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const { kitId, prepararNaAgenda, abrirNoEstudio, irPara } = useMesaFoto();
  const cache = useQueryClient();
  const fotosQ = useFotos(clientId);
  const kits = useKits(clientId);
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
  const resultados = r.grupos?.[grupo] || [];
  const registrar = (id: string, noGrupo = grupo) => {
    setR((a) => ({ ...a, grupos: { ...a.grupos, [noGrupo]: Array.from(new Set([id, ...(a.grupos?.[noGrupo] || [])])).slice(0, 50) } }));
    setAtualPorGrupo((a) => ({ ...a, [noGrupo]: id }));
  };
  const fotos = fotosQ.data || [];
  const kit = kits.data?.find((k) => k.id === kitId);
  const capa = kit ? capaDoKit(kit, fotos) : null;
  const produto = r.origemKit === kitId ? fotos.find((f) => f.id === r.produtoTratado) || capa : capa;
  const kitDeGeracao = r.origemKit === kitId && r.fotoDoKitTratado === produto?.id && r.kitTratado ? r.kitTratado : kitId;
  const atual = fotos.find((f) => f.id === (atualPorGrupo[grupo] || resultados[0])) || null;
  const ambiente = fotos.find((f) => f.id === r.ambiente);
  const motor = r.motor || padraoPara(catalogo, "imagem")?.id || "";
  const clone = r.pessoa?.tipo === "clone" ? clones.data?.find((c) => c.id === r.pessoa?.id) : null;
  const persona = r.pessoa?.tipo === "persona" ? personas.data?.find((p) => p.id === r.pessoa?.id) : null;
  const retratos = useImagensDaPersona(persona?.id || null);
  const retrato = retratos.data?.find((i) => i.id === persona?.ancora_imagem_id);
  const cloneFoto = fotos.find((f) => f.id === (clone?.identidade_real.find((i) => i.principal) || clone?.identidade_real[0])?.imagem_id);
  const faltaPessoa = r.pessoa?.tipo === "clone" ? !clone?.autorizacao_valida.ok : r.pessoa?.tipo === "persona" ? !persona?.ancora_imagem_id : false;
  const imagem = (foto: FotoDoAcervo | null | undefined, grande = false) => foto ? <ImagemDaMesa caminho={foto.storage_path} bucket={foto.storage_bucket || "mesa"} alt={foto.nome} className={`w-full rounded-lg object-contain ${grande ? 'max-h-[48vh]' : 'max-h-64'}`} /> : <div className="flex min-h-40 items-center justify-center rounded-lg bg-muted p-4 text-center text-sm text-muted-foreground">Escolha as imagens para compor</div>;
  const montar = (): Canvas => {
    let c = canvasVazio(clientId, `Composição · ${kit?.nome || 'Foto'} · ${new Date().toLocaleDateString('pt-BR')}`);
    const saida = novoNo("gerar", 500, 0, { motores: [motor], formato: r.formato, qualidade: "alta" });
    c = { ...c, nos: [saida] };
    c = porCartao(c, novoNo("produto", 0, 0, { kit_id: kitDeGeracao }), { gerarId: saida.id });
    if (persona) c = porCartao(c, novoNo("modelo", 0, 0, { modelo_id: persona.id, versao: persona.versao }), { gerarId: saida.id });
    if (clone?.autorizacao_valida.ok) c = porCartao(c, novoNo("modelo", 0, 0, { imagem_id: (clone.identidade_real.find((i) => i.principal) || clone.identidade_real[0])?.imagem_id, autorizada: true, titulo: clone.nome }), { gerarId: saida.id });
    if (r.ambiente) c = porCartao(c, novoNo("ambiente", 0, 0, { imagem_id: r.ambiente, modo: "foto", uso: "usar" }), { gerarId: saida.id });
    c = porCartao(c, novoNo("texto", 0, 0, { texto: r.pedido }), { gerarId: saida.id });
    return c;
  };
  const estilo = (qual: Foco) => `min-w-0 rounded-xl border p-3 transition-[flex-grow] duration-300 motion-reduce:transition-none ${foco === qual ? 'border-primary/50 bg-card lg:flex-[2]' : 'lg:flex-1'}`;
  return <div className="space-y-3" data-composicao-rapida="">
    <p className="text-xs text-muted-foreground">Pessoa à esquerda, composição no centro e produto à direita. Clique no título para ampliar a área.</p>
    <div className="flex flex-col gap-3 lg:flex-row">
      <section className={estilo("pessoa")} aria-label="Modelo ou clone">
        <button className="mb-3 w-full text-left text-sm font-semibold" type="button" aria-pressed={foco === 'pessoa'} onClick={() => setFoco('pessoa')}>1. Modelos e clones</button>
        <EscolhaDoModeloDaFoto semPessoa valor={r.pessoa} onEscolher={(pessoa) => mudar({ pessoa })} />
        {retrato && <div className="mt-3"><ImagemDaMesa caminho={retrato.storage_path} bucket={retrato.storage_bucket || "mesa"} alt={persona?.nome || "Modelo"} className="max-h-[48vh] w-full rounded-lg object-contain" /><button type="button" className="mt-2 text-xs text-primary" onClick={() => { setEditarPessoa(!editarPessoa); setFoco("pessoa"); }}>Variações, outros geradores e upscale do modelo</button></div>}
        {editarPessoa && persona && <Suspense fallback={<p role="status">Abrindo versões do modelo…</p>}><FerramentasDaPersona key={persona.id} persona={persona} /></Suspense>}
        {cloneFoto && <div className="mt-3">{imagem(cloneFoto, foco === "pessoa")}<AcoesProDaFoto foto={cloneFoto} mostrarCriativo={false} onPronta={(nova) => { acrescentarFotos(cache, clientId, [nova]); abrirNoEstudio?.(nova.id); }} /><button type="button" className="mt-2 text-xs text-primary" onClick={() => irPara("clones", { imagem: cloneFoto.id })}>Fotos e variações deste clone</button></div>}
        <p className="mt-2 text-xs text-muted-foreground">Sem pessoa escolhida, o produto fica sozinho. Para incluir uma pessoa nova, descreva no pedido.</p>
      </section>
      <section className={estilo("composicao")} aria-label="Composição principal">
        <button className="mb-3 w-full text-left text-sm font-semibold" type="button" aria-pressed={foco === 'composicao'} onClick={() => setFoco('composicao')}>2. Sua composição</button>
        {imagem(atual || ambiente, true)}
        <div className="my-3 flex flex-wrap gap-2"><button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => setEscolhendo(true)}>{ambiente ? 'Trocar ambiente' : 'Escolher foto do ambiente'}</button>{ambiente && <button type="button" className="text-xs" onClick={() => mudar({ ambiente: null })}>Retirar ambiente</button>}</div>
        <label className="block text-xs">Ambiente, ação e acabamento<textarea aria-label="Pedido da composição" className={campoTexto} rows={3} value={r.pedido} onChange={(e) => mudar({ pedido: e.target.value })} placeholder="Ex.: produto sobre mármore claro, luz suave de janela, textura realista…" /></label>
        <div className="my-2 flex gap-2"><select aria-label="Proporção da composição" className={campo} value={r.formato} onChange={(e) => mudar({ formato: e.target.value })}>{['4:5','1:1','9:16','16:9'].map((f) => <option key={f}>{f}</option>)}</select><SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={motor} onChange={(v) => mudar({ motor: v })} /></div>
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
        }} aoConcluir={(resposta) => { if (resposta.imagem) { acrescentarFotos(cache, clientId, [resposta.imagem]); registrar(resposta.imagem.id, resposta.grupo); } atualizarCusto(); }} />
        {!kitId && <p className="mt-2 text-xs">Escolha o produto à direita para começar.</p>}
        {atual && <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => abrirNoEstudio?.(atual.id)}>Melhorar esta foto</button><button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => prepararNaAgenda?.([atual.id])}>Usar no post</button><AcoesProDaFoto foto={atual} onPronta={(nova) => { acrescentarFotos(cache, clientId, [nova]); registrar(nova.id); }} /></div>}
      </section>
      <section className={estilo("produto")} aria-label="Produto e ferramentas">
        <button className="mb-3 w-full text-left text-sm font-semibold" type="button" aria-pressed={foco === 'produto'} onClick={() => setFoco('produto')}>3. Produto</button>
        <EscolhaDoProduto />
        <div className="mt-3">{imagem(produto)}</div>
        {produto && <div className="mt-3"><AcoesProDaFoto foto={produto} onPronta={(nova) => { mudar({ produtoTratado: nova.id, origemKit: kitId }); toast.info('Confira a versão tratada e use o botão para aplicá-la à composição.'); }} /><button type="button" className="mt-2 text-xs text-primary" onClick={() => abrirNoEstudio?.(produto.id)}>Luz, cor e realismo</button></div>}
        {produto && produto.id !== capa?.id && kit && <button type="button" disabled={ocupado || (r.fotoDoKitTratado === produto.id && !!r.kitTratado)} className="mt-3 rounded-md border px-3 py-2 text-xs" onClick={async () => {
          setOcupado(true);
          try {
            const aprovada = await decidirFoto(clientId, produto.id, "aprovar");
            if (!aprovada?.aprovada) throw new Error("A aprovação da referência não foi confirmada.");
            acrescentarFotos(cache, clientId, [aprovada]);
            const copia = await salvarKit(clientId, { ...kit, id: null, nome: `${kit.nome} · versão tratada`, frente_imagem_id: produto.id, refs: [{ imagem_id: produto.id, papel: "identidade", vista: "frente", prioridade: 0 }, ...kit.refs.filter((ref) => ref.imagem_id !== capa?.id)] });
            if (!copia.id || copia.id === kit.id) throw new Error("Não foi possível salvar a referência sem alterar o produto original.");
            mudar({ kitTratado: copia.id, fotoDoKitTratado: produto.id, origemKit: kitId });
            void cache.invalidateQueries({ queryKey: chaveDosKits(clientId) });
            toast.success("Esta versão será usada na próxima composição.");
          } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível usar esta versão."); }
          finally { setOcupado(false); }
        }}>{r.fotoDoKitTratado === produto.id && r.kitTratado ? "Versão tratada em uso" : "Aprovar e usar esta versão"}</button>}
      </section>
    </div>
    {escolhendo && <SeletorDeFotos fotos={fotos} titulo="Foto real do ambiente" multiplas={false} onUsar={(ids) => { mudar({ ambiente: ids[0] || null }); setEscolhendo(false); }} onFechar={() => setEscolhendo(false)} />}
    {resultados.length > 0 && <section aria-label="Versões da composição"><h3 className="mb-2 text-sm font-semibold">Versões desta composição</h3><div className="flex gap-2 overflow-x-auto">{resultados.map((id) => { const f = fotos.find((x) => x.id === id); return f ? <button key={id} type="button" aria-label={`Abrir ${f.nome}`} aria-pressed={atual?.id === id} onClick={() => setAtualPorGrupo((a) => ({ ...a, [grupo]: id }))} className="w-24 shrink-0 rounded border p-1">{imagem(f)}</button> : null; })}</div><button type="button" className="mt-2 text-xs text-primary" onClick={() => prepararNaAgenda?.(resultados.slice().reverse().slice(0, 10))}>Montar carrossel com estas fotos</button></section>}
  </div>;
}
