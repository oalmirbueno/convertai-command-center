import ColunasDaFoto from "./ColunasDaFoto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { superficie, juntar } from "@/components/sistema/estilos";
import { toast } from "sonner";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMesa } from "@/components/mesa/MesaContexto";
import { PreviaDaPauta } from "@/components/mesa/BancadaDaPauta";
import { BotaoComCusto } from "@/components/mesa/Custo";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { padraoPara } from "@/lib/mesa/api";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { useMesaFoto } from "./Comuns";
import EscolhaDoProduto, { capaDoKit } from "./EscolhaDoProduto";
import EscolhaDoModeloDaFoto from "./EscolhaDoModeloDaFoto";
import { type ModeloEscolhido } from "./escolhasDaLinha";
import { acrescentarFotos, useFotos, useKits, decidirFoto, chaveDosKits, type FotoDoAcervo } from "./fotoApi";
import { useClones } from "./clonesApi";
import { usePersonas } from "./modelosApi";
import { useCanvases, canvasVazio, novoNo, porCartao, salvarCanvas, gerarNoCanvas, partesDoGerar, chaveDosCanvases } from "./canvasApi";
import SeletorDeFotos from "./SeletorDeFotos";
import GaleriaDeFotos from "./GaleriaDeFotos";
import { fotoNaGaleria, historicoDaComposicao } from "./organizacaoDasFotos";
import AcoesProDaFoto from "./AcoesProDaFoto";

export const CENARIOS_PARA_COMBINAR = [
  { id: "estudio", nome: "Estúdio elegante", pedido: "Fundo limpo de estúdio, sombra de contato natural e iluminação suave, produto protagonista." },
  { id: "cotidiano", nome: "Uso no cotidiano", pedido: "Cena de uso real do produto em ambiente cotidiano coerente com sua finalidade, luz natural." },
  { id: "arquitetura", nome: "Ambiente e arquitetura", pedido: "Produto integrado a um ambiente arquitetônico realista, materiais naturais e proporções fiéis." },
  { id: "vitrine", nome: "Vitrine e coleção", pedido: "Apresentação de coleção em vitrine organizada, sem inventar outros produtos, cores fiéis." },
  { id: "macro", nome: "Detalhes e acabamento", pedido: "Foto aproximada que valorize os detalhes e materiais reais, textura fiel e foco seletivo." },
  { id: "flatlay", nome: "Flat lay", pedido: "Composição vista de cima, produto organizado sobre superfície de cor harmônica, luz suave." },
] as const;
const VARIACOES = ["Composição principal em três quartos.", "Enquadramento frontal, mantendo o mesmo cenário.", "Detalhe próximo do acabamento real.", "Enquadramento aberto com mais respiro no mesmo ambiente."];
interface Rascunho { pessoa: ModeloEscolhido | null; ambiente: string | null; cenario: string; pedido: string; formato: string; motor: string; quantidade: number; resultados: string[]; grupos?: Record<string, string[]>; produtoTratado?: string; origemKit?: string | null; kitTratado?: string; fotoDoKitTratado?: string }
const INICIAL: Rascunho = { pessoa: null, ambiente: null, cenario: "estudio", pedido: "", formato: "4:5", motor: "", quantidade: 2, resultados: [] };

/** Composição por série, com memória e Canvas próprios. Não reutiliza o rascunho do Compor. */
export default function CombinarFotos({ escopo }: { escopo?: string } = {}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const { kitId, prepararNaAgenda } = useMesaFoto();
  const cache = useQueryClient();
  const fotosQ = useFotos(clientId); const kits = useKits(clientId);
  const canvases = useCanvases(clientId);
  const clones = useClones(clientId); const modelos = usePersonas(clientId);
  const [r, setR] = useEstadoDaTela<Rascunho>(escopo || `mesa-foto:combinar:${clientId}`, INICIAL);
  const mudar = (p: Partial<Rascunho>) => setR((a) => ({ ...a, ...p }));
  const [escolhendo, setEscolhendo] = useState(false); const [ocupado, setOcupado] = useState(false); const [vendo, setVendo] = useState<string | null>(null);
  const [foco, setFoco] = useState("resultado");
  const fotos = fotosQ.data || []; const kit = kits.data?.find((k) => k.id === kitId);
  const capa = kit ? capaDoKit(kit, fotos) : null;
  const produto = r.origemKit === kitId ? fotos.find((f) => f.id === r.produtoTratado) || capa : capa;
  const kitDeGeracao = kitId;
  const ambiente = fotos.find((f) => f.id === r.ambiente);
  const modelo = r.pessoa?.tipo === "persona" ? modelos.data?.find((p) => p.id === r.pessoa?.id) : null;
  const clone = r.pessoa?.tipo === "clone" ? clones.data?.find((p) => p.id === r.pessoa?.id) : null;
  const grupo = `${kitId || "sem-produto"}:${r.pessoa?.tipo || "sem-pessoa"}:${r.pessoa?.id || ""}`;
  const historico = historicoDaComposicao(fotos, canvases.data || [], clientId, [kitId, kitDeGeracao].filter((id): id is string => !!id), r.pessoa, (clone?.identidade_real.find((i) => i.principal) || clone?.identidade_real[0])?.imagem_id, "Combinar · ");
  const resultados = Array.from(new Set([...(r.grupos?.[grupo] || []), ...historico.map((f) => f.id)])).map((id) => fotos.find((f) => f.id === id && f.ativa)).filter((f): f is FotoDoAcervo => !!f);
  const atual = resultados.find((f) => f.id === vendo) || resultados[0];
  const faltaPessoa = !!r.pessoa && (r.pessoa.tipo === "clone" ? !clone?.autorizacao_valida.ok : !modelo?.ancora_imagem_id);
  const motor = r.motor || padraoPara(catalogo, "imagem")?.id || "";
  const cenario = CENARIOS_PARA_COMBINAR.find((c) => c.id === r.cenario) || CENARIOS_PARA_COMBINAR[0];
  const registrar = (foto: FotoDoAcervo) => { acrescentarFotos(cache, clientId, [foto]); setR((a) => ({ ...a, grupos: { ...a.grupos, [grupo]: Array.from(new Set([foto.id, ...(a.grupos?.[grupo] || [])])).slice(0, 100) } })); setVendo(foto.id); };
  const classe = (id: string) => `min-h-0 min-w-0 p-3 lg:overflow-y-auto lg:overscroll-contain transition-[flex-grow] duration-300 motion-reduce:transition-none ${foco === id ? 'border-primary/50 lg:flex-[2]' : 'lg:flex-1'}`;
  return <div className="space-y-4" data-combinar-fotos="">
    <ColunasDaFoto rodape={!!resultados.length && <GaleriaDeFotos titulo="Série de combinações" fotos={resultados.map((f) => fotoNaGaleria(f, "Combinações"))} atualId={atual?.id} onSelecionar={setVendo} onUsar={prepararNaAgenda} />}>
      <section className={juntar(superficie.painel, classe("pessoa"))}><button type="button" aria-pressed={foco === "pessoa"} onClick={() => setFoco("pessoa")} className="mb-4 text-[13px] font-semibold">Pessoa e cenário</button><AjudaRecolhida className="ml-2" rotulo="Como combinar">Escolha produto e cenário e gere uma série com enquadramentos diferentes. A pessoa é opcional. Cada coluna rola separadamente.</AjudaRecolhida><EscolhaDoModeloDaFoto semPessoa valor={r.pessoa} onEscolher={(pessoa) => mudar({ pessoa })} /><label className="mt-4 block text-[12px]">Cenário<select className="mt-2 w-full rounded-md border bg-background p-2" value={r.cenario} onChange={(e) => mudar({ cenario: e.target.value })}>{CENARIOS_PARA_COMBINAR.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label><button type="button" className="mt-4 rounded-md border p-2 text-[12px]" onClick={() => setEscolhendo(true)}>{ambiente ? "Trocar foto do ambiente" : "Usar ambiente do Workspace"}</button>{ambiente && <><p className="mt-2 text-[12px]">{ambiente.nome}</p><button type="button" className="text-[12px] text-primary" onClick={() => mudar({ ambiente: null })}>Retirar ambiente</button></>}{faltaPessoa && <p role="status" className="mt-3 text-[12px]">Escolha um modelo com foto base ou um clone autorizado.</p>}</section>
      <section className={juntar(superficie.painel, classe("resultado"))}><button type="button" aria-pressed={foco === "resultado"} onClick={() => setFoco("resultado")} className="mb-3 text-[13px] font-semibold">Sua combinação</button>{atual || ambiente ? <PreviaDaPauta compacta caminho={(atual || ambiente)!.storage_path} bucket={(atual || ambiente)!.storage_bucket} nome={(atual || ambiente)!.nome} /> : <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed p-5 text-center text-[13px]">{cenario.pedido}</div>}<label className="mt-3 block text-[12px]">O que você quer ambientar?<textarea className="mt-2 w-full rounded-md border bg-background p-3" rows={3} value={r.pedido} onChange={(e) => mudar({ pedido: e.target.value })} placeholder="Ex.: óculos sobre balcão claro da loja, luz de fim de tarde…" /></label><div className="my-3 flex flex-wrap gap-2"><select aria-label="Proporção da série" className="rounded-md border bg-background p-2 text-[12px]" value={r.formato} onChange={(e) => mudar({ formato: e.target.value })}>{["4:5", "1:1", "9:16", "16:9"].map((f) => <option key={f}>{f}</option>)}</select><select aria-label="Quantidade de variações" className="rounded-md border bg-background p-2 text-[12px]" value={r.quantidade} onChange={(e) => mudar({ quantidade: Number(e.target.value) })}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} {n === 1 ? "foto" : "variações"}</option>)}</select><SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={motor} onChange={(motor) => mudar({ motor })} /></div>
        <BotaoComCusto rotulo={`Gerar ${r.quantidade} ${r.quantidade === 1 ? "foto" : "variações"}`} titulo="Combinar produtos e cenários" descricao="Cria novas versões com as referências escolhidas." disabled={ocupado || !kit || !motor || faltaPessoa} partes={() => Array.from({ length: r.quantidade }, () => partesDoGerar([motor], "alta", Math.min(14, (kit?.refs.length || 0) + 6))).flat()} executar={async () => {
          setOcupado(true);
          try { for (let i = 0; i < r.quantidade; i++) {
            const saida = novoNo("gerar", 500, 0, { motores: [motor], formato: r.formato, qualidade: "alta" });
            let c = { ...canvasVazio(clientId, `Combinar · ${kit?.nome} · ${cenario.nome} · ${i + 1}`), nos: [saida] };
            c = porCartao(c, novoNo("produto", 0, 0, { kit_id: kitDeGeracao }), { gerarId: saida.id });
            if (modelo) c = porCartao(c, novoNo("modelo", 0, 0, { modelo_id: modelo.id, versao: modelo.versao }), { gerarId: saida.id });
            if (clone?.autorizacao_valida.ok) c = porCartao(c, novoNo("modelo", 0, 0, { imagem_id: (clone.identidade_real.find((i) => i.principal) || clone.identidade_real[0])?.imagem_id, autorizada: true, titulo: clone.nome }), { gerarId: saida.id });
            if (ambiente) c = porCartao(c, novoNo("ambiente", 0, 0, { imagem_id: ambiente.id, modo: "foto", uso: "usar" }), { gerarId: saida.id });
            c = porCartao(c, novoNo("texto", 0, 0, { texto: `${cenario.pedido}\n${r.pedido}\n${VARIACOES[i]} Preserve a identidade, forma, cor e proporção do produto.` }), { gerarId: saida.id });
            const salvo = await salvarCanvas(c);
            if (!salvo.id) throw new Error("Não foi possível salvar a combinação.");
            const resultado = await gerarNoCanvas({ canvasId: salvo.id, gerarId: saida.id, motorId: motor, qualidade: "alta" });
            if (!resultado.imagem) throw new Error("A imagem ainda não foi confirmada. As versões concluídas continuam salvas.");
            registrar(resultado.imagem);
          } return { pronto: true }; } finally { setOcupado(false); atualizarCusto(); void cache.invalidateQueries({ queryKey: chaveDosCanvases(clientId) }); }
        }} />
        {atual && <button type="button" className="ml-2 mt-3 rounded-md border p-2 text-[12px]" onClick={() => prepararNaAgenda?.([atual.id])}>Usar esta foto no post</button>}
      </section>
      <section className={juntar(superficie.painel, classe("produto"))}><button type="button" aria-pressed={foco === "produto"} onClick={() => setFoco("produto")} className="mb-4 text-[13px] font-semibold">Produto e tratamento</button><EscolhaDoProduto />{produto && <><PreviaDaPauta compacta caminho={produto.storage_path} bucket={produto.storage_bucket} nome={produto.nome} /><AcoesProDaFoto foto={produto} onPronta={(nova) => { acrescentarFotos(cache, clientId, [nova]); mudar({ produtoTratado: nova.id, origemKit: kitId }); }} />{produto.id !== capa?.id && kit && <button type="button" className="mt-3 rounded-md border p-2 text-[12px]" disabled={ocupado || (r.fotoDoKitTratado === produto.id && !!r.kitTratado)} onClick={async () => {
          setOcupado(true);
          try {
            const aprovada = await decidirFoto(clientId, produto.id, "aprovar");
            if (!aprovada?.aprovada) throw new Error("A referência não foi confirmada.");
            acrescentarFotos(cache, clientId, [aprovada]);
            mudar({ kitTratado: kit.id, fotoDoKitTratado: produto.id, origemKit: kitId });
            void cache.invalidateQueries({ queryKey: chaveDosKits(clientId) });
            toast.success("Versão tratada pronta para combinar.");
          } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível usar esta versão."); }
          finally { setOcupado(false); }
        }}>{r.fotoDoKitTratado === produto.id && r.kitTratado ? "Versão tratada em uso" : "Aprovar e usar esta versão"}</button>}</>}</section>
    </ColunasDaFoto>
    {escolhendo && <SeletorDeFotos fotos={fotos} titulo="Escolher ambiente" multiplas={false} onUsar={(ids) => { mudar({ ambiente: ids[0] }); setEscolhendo(false); }} onFechar={() => setEscolhendo(false)} />}

  </div>;
}
