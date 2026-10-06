import { gravarNaSessao, lerDaSessao } from "./sessao";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Folder, FolderInput, Images, Package, PackagePlus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { campo, foco, juntar } from "@/components/sistema/estilos";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { useAlturaQueCabe } from "@/components/sistema/AreaDeTrabalho";
import { MiniaturaDaFoto, useMesaFoto } from "./Comuns";
import { capaDoKit, nomeDoKit } from "./EscolhaDoProduto";
import SeletorDeFotos from "./SeletorDeFotos";
import PublicoDoProduto from "./PublicoDoProduto";
import { fotosJaCadastradas, guardarProdutoConfirmado } from "./cacheProdutos";
import { atualizarPublicoProduto, PUBLICOS_DO_PRODUTO, ROTULOS_PUBLICO, type PublicoProduto } from "./produtoPublicoApi";
import { identificarProduto, invalidarFotos, kitVazio, normalizarKit, partesDaLeitura, partesDaIdentificacao, salvarKit, useFotos, type FotoDoAcervo, type IdentificacaoDoProduto, type KitDeFoto } from "./fotoApi";
import { pastaDoProduto } from "./pastasDosProdutos";
import { moverProdutoParaPasta, useOrganizacaoDeProdutos } from "./useOrganizacaoDeProdutos";
import { limparPastaDeProdutos } from "../../../supabase/functions/mesa-foto/modulos/pastas-produtos";
import "./organizadorProdutos.css";

const EditorDoProduto = lazy(() => import("./EtapaKits"));

export default function OrganizadorDeProdutos({ onEscolher }: { onEscolher?: (id: string) => void }) {
  const { clientId, catalogo } = useMesa();
  const mesa = useMesaFoto();
  const cache = useQueryClient();
  const erro = useAvisarErro();
  const fotosQ = useFotos(clientId);
  const fotos = fotosQ.data || [];
  const org = useOrganizacaoDeProdutos(clientId, fotos);
  const kits = (org.kits.data || []).filter((k) => k.client_id === clientId && k.tipo !== "pessoa" && k.status !== "arquivado" && k.id);
  const [aba, setAba] = useState<"produtos" | "geracoes">("produtos");
  const [pasta, setPasta] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [grupo, setGrupo] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [destino, setDestino] = useState("");
  const [movendo, setMovendo] = useState(false);
  const [recebidas] = useState<string[]>(() => !mesa.kitId ? lerDaSessao<string[]>(clientId, "kit-com-fotos") || [] : []);
  const [cadastrar, setCadastrar] = useState(recebidas.length > 0);
  const [adicionarAo, setAdicionarAo] = useState<string | null>(null);
  const [ids, setIds] = useState<string[]>(recebidas);
  const [nome, setNome] = useState(() => fotos.find((f) => f.id === recebidas[0])?.nome || "Meu produto");
  useEffect(() => { if (recebidas.length) gravarNaSessao(clientId, "kit-com-fotos", null); }, [clientId, recebidas]);
  const [papel, setPapel] = useState<"identidade" | "embalagem">("identidade");
  const [alvo, setAlvo] = useState("novo");
  const [salvando, setSalvando] = useState(false);
  const [publicoNovo, setPublicoNovo] = useState("automatico");
  const [detalhes, setDetalhes] = useState(false);
  const [pessoa, setPessoa] = useState("");
  const [produtoFiltro, setProdutoFiltro] = useState("");
  const { ref, altura } = useAlturaQueCabe(true);
  const produto = kits.find((k) => k.id === aberto);
  const pastas = Array.from(new Set(kits.map(pastaDoProduto))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const visiveis = kits.filter((k) => (pasta === null || pastaDoProduto(k) === pasta) && `${k.nome} ${k.variante} ${pastaDoProduto(k)}`.toLocaleLowerCase("pt-BR").includes(termo));
  const geracoes = org.organizadas.filter((g) => g.geracao && (!produtoFiltro || g.produtoIds.includes(produtoFiltro)) && (!pessoa || g.pessoas.some((p) => `${p.tipo}:${p.id}` === pessoa)) && `${g.pasta} ${g.foto.nome}`.toLocaleLowerCase("pt-BR").includes(termo));
  const grupos = useMemo(() => {
    const mapa = new Map<string, typeof geracoes>();
    for (const g of geracoes) mapa.set(g.chave, [...(mapa.get(g.chave) || []), g]);
    return Array.from(mapa.entries());
  }, [geracoes]);
  const recarregar = () => { invalidarFotos(cache, clientId); void org.recarregar(); };
  const usar = (id: string) => { mesa.escolherKit(id); if (onEscolher) onEscolher(id); else mesa.irPara("combinar", { kit: id }); };
  const iniciarCadastro = (kit?: KitDeFoto) => {
    setCadastrar(true); setAdicionarAo(kit?.id || null); setAlvo(kit?.id || "novo"); setIds([]); setNome(""); setPapel("identidade"); setDestino(kit?.atributos.organizacao?.pasta || ""); setPublicoNovo("automatico");
  };
  const escolherFotos = (novos: string[]) => {
    setIds(novos);
    const existentes = kits.filter((k) => novos.some((id) => k.refs.some((r) => r.imagem_id === id)));
    if (!adicionarAo && existentes.length === 1) setAlvo(existentes[0].id!);
    setNome(novos.length ? fotos.find((f) => f.id === novos[0])?.nome || "Meu produto" : "");
  };
  const salvar = async () => {
    if (!ids.length || salvando) return;
    const existente = kits.find((k) => k.id === alvo);
    const base = existente || { ...kitVazio(clientId), nome: nome.trim(), atributos: { observado: [], informado: [], inferido: [], organizacao: { pasta: limparPastaDeProdutos(destino), ...(publicoNovo !== "automatico" ? { publico: { valor: publicoNovo as PublicoProduto, origem: "equipe" as const, confianca: 1, evidencia: "Definido pela equipe" } } : {}) } } };
    const novas = ids.filter((id) => !base.refs.some((r) => r.imagem_id === id)).map((id, i) => ({ imagem_id: id, papel, vista: "", prioridade: base.refs.length + i }));
    if (base.refs.length + novas.length > 40) { toast.error("Este produto aceita até 40 fotos de referência."); return; }
    setSalvando(true);
    try {
      const salvo = await salvarKit(clientId, { ...base, frente_imagem_id: base.frente_imagem_id || ids[0], refs: [...base.refs, ...novas] }, true);
      if (!salvo.id) throw new Error("O produto não foi confirmado pelo servidor.");
      await guardarProdutoConfirmado(cache, clientId, salvo);
      let resultado = { custo_usd: 0 };
      if (!existente && publicoNovo === "automatico") {
        try { resultado = await atualizarPublicoProduto(cache, clientId, salvo, "automatico"); }
        catch (e) { erro(e, "Produto salvo; público a identificar"); }
      }
      setCadastrar(false); setAberto(salvo.id); mesa.escolherKit(salvo.id); toast.success(`${ids.length} ${ids.length === 1 ? "foto marcada" : "fotos marcadas"} como produto`);
      return resultado;
    } finally { setSalvando(false); }
  };
  const mover = async () => {
    setMovendo(true);
    let feitas = 0;
    try {
      for (const id of marcados) { const d = await moverProdutoParaPasta(clientId, id, destino); const salvo = normalizarKit(d.kit); if (!salvo) throw new Error("A pasta não foi confirmada."); await guardarProdutoConfirmado(cache, clientId, salvo); feitas++; }
      toast.success(`${feitas} ${feitas === 1 ? "produto organizado" : "produtos organizados"}`); setMarcados([]); setPasta(null);
    } catch (e) { erro(e, feitas ? `${feitas} movidos; confira os restantes` : "Pasta não salva"); }
    finally { recarregar(); setMovendo(false); }
  };
  const aoIdentificar = async (data: IdentificacaoDoProduto) => {
    if (data.kit?.id) { await guardarProdutoConfirmado(cache, clientId, data.kit); setAberto(data.kit.id); mesa.escolherKit(data.kit.id); setCadastrar(false); toast.success("Produto identificado. Confira as fotos e os detalhes."); }
    else toast.error("A leitura terminou, mas o produto não foi salvo. Você pode cadastrá-lo manualmente.");
  };
  const identificarMarcados = async () => {
    setMovendo(true);
    let custo_usd = 0; let saldo_usd: number | undefined;
    try {
      for (const k of kits.filter((k) => marcados.includes(k.id!) && !k.atributos.organizacao?.publico)) {
        const r = await atualizarPublicoProduto(cache, clientId, k, "automatico");
        custo_usd += r.custo_usd || 0; saldo_usd = r.saldo_usd ?? saldo_usd;
      }
      setMarcados([]); setPasta(null);
      return { custo_usd, saldo_usd };
    } finally { setMovendo(false); }
  };
  const abrirFoto = (f: FotoDoAcervo) => { mesa.abrirNoEstudio?.(f.id); if (onEscolher) onEscolher(mesa.kitId || ""); };

  if (detalhes) return <div className="space-y-4"><Button variant="outline" onClick={() => setDetalhes(false)}><ArrowLeft className="mr-2 h-4 w-4" />Voltar aos produtos</Button><Suspense fallback={<p role="status">Abrindo produto…</p>}><EditorDoProduto /></Suspense></div>;
  return <section className="organizador-produtos min-w-0" aria-label="Organizador de produtos">
    <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2"><h2 className="text-[15px] font-semibold">Produtos e gerações</h2><AjudaRecolhida rotulo="Como organizar produtos">Marque apenas as fotos do mesmo produto, com ou sem embalagem. As pastas são salvas por cliente. Gerações ficam separadas pelo produto e pelo modelo ou clone usado; os arquivos originais e as versões continuam preservados.</AjudaRecolhida></div>
      <Button size="sm" onClick={() => iniciarCadastro()}><PackagePlus className="mr-2 h-4 w-4" />Marcar fotos como produto</Button>
    </div>
    <div className="mb-4 flex min-w-0 flex-wrap items-center gap-3">
      <div className="flex rounded-lg bg-muted p-1" aria-label="Organizar"><Button size="sm" aria-pressed={aba === "produtos"} variant={aba === "produtos" ? "default" : "ghost"} onClick={() => { setAba("produtos"); setAberto(null); setCadastrar(false); }}>Produtos · {kits.length}</Button><Button size="sm" aria-pressed={aba === "geracoes"} variant={aba === "geracoes" ? "default" : "ghost"} onClick={() => { setAba("geracoes"); setCadastrar(false); setGrupo(null); }}>Gerações</Button></div>
      <div className="relative min-w-[180px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><input className={juntar(campo, "pl-9")} aria-label="Buscar produtos e gerações" placeholder="Buscar produto, pasta ou pessoa" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
    </div>
    {(fotosQ.isError || org.erro) && <p role="alert" className="mb-3 text-[13px]">Não foi possível carregar toda a organização. <button className="text-primary" onClick={() => { void fotosQ.refetch(); void org.recarregar(); }}>Tentar novamente</button></p>}
    <div ref={ref} className="produtos-espaco" style={{ height: altura ? Math.max(280, altura - (onEscolher ? 52 : 12)) : undefined }}>
      {cadastrar ? <div className="produtos-conteudo space-y-4">
        <div className="flex items-center gap-2"><Button variant="ghost" size="icon" aria-label="Voltar sem cadastrar" onClick={() => setCadastrar(false)} disabled={salvando}><ArrowLeft className="h-4 w-4" /></Button><h3 className="text-[14px] font-semibold">Fotos do mesmo produto</h3></div>
        {!ids.length ? <SeletorDeFotos fotos={fotos.filter((f) => f.client_id === clientId && f.ativa && !f.referencia_web && (!f.gerada || f.aprovada))} titulo="Escolha as fotos do produto ou da embalagem" produtosMarcados={fotosJaCadastradas(kits)} limiteSelecao={40} onUsar={escolherFotos} onFechar={() => setCadastrar(false)} /> : <>
          <div className="flex flex-wrap items-center gap-3">{ids.slice(0, 8).map((id) => { const f = fotos.find((x) => x.id === id); return f ? <span key={id} className="w-20"><MiniaturaDaFoto foto={f} selo={false} /></span> : null; })}<Button variant="outline" onClick={() => setIds([])} disabled={salvando}>Trocar fotos ({ids.length})</Button></div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="space-y-1 text-[12px]">Guardar em<select className={campo} value={alvo} onChange={(e) => setAlvo(e.target.value)}><option value="novo">Novo produto</option>{kits.map((k) => <option key={k.id} value={k.id!}>{nomeDoKit(k)}</option>)}</select></label>
            <label className="space-y-1 text-[12px]">O que aparece nas fotos<select className={campo} value={papel} onChange={(e) => setPapel(e.target.value as typeof papel)}><option value="identidade">Produto fora da embalagem</option><option value="embalagem">Caixa ou embalagem do produto</option></select></label>
            {alvo === "novo" && <><label className="space-y-1 text-[12px]">Nome do produto<input className={campo} value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} /></label><label className="space-y-1 text-[12px]">Pasta<input className={campo} list="pastas-de-produtos" placeholder="Ex.: Óculos / Sol" value={destino} onChange={(e) => setDestino(e.target.value)} /></label></>}
          </div>
          {alvo === "novo" && <label className="flex max-w-md items-center gap-2 text-[12px]">Público<select aria-label="Público do novo produto" className={campo} value={publicoNovo} disabled={salvando} onChange={(e) => setPublicoNovo(e.target.value)}><option value="automatico">Identificar automaticamente</option>{PUBLICOS_DO_PRODUTO.map((p) => <option key={p} value={p}>{ROTULOS_PUBLICO[p]}</option>)}</select></label>}
          <div className="flex flex-wrap gap-3">{alvo === "novo" && publicoNovo === "automatico" ? <BotaoComCusto rotulo="Marcar e identificar público" titulo="Produto salvo" partes={() => partesDaLeitura(catalogo)} executar={salvar} disabled={salvando || !nome.trim() || ids.length > 40} /> : <Button disabled={salvando || (alvo === "novo" && !nome.trim()) || ids.length > 40} onClick={() => void salvar().catch((e) => erro(e, "Produto não salvo"))}>{salvando ? "Salvando…" : "Marcar e salvar produto"}</Button>}
            <BotaoComCusto variant="outline" rotulo="Reconhecer pela foto ou caixa" titulo="Produto identificado" descricao="Lê as fotos e identifica o produto. Marca e modelo só são preenchidos quando há evidência. Confira o rascunho antes de gerar." disabled={salvando || ids.length > 6} partes={() => partesDaIdentificacao(catalogo, ids.length)} executar={() => identificarProduto(clientId, ids)} aoConcluir={aoIdentificar} />
          </div>
          {ids.length > 6 && <p className="text-[12px] text-muted-foreground">Até 6 fotos para reconhecer · até 40 para cadastrar.</p>}
        </>}
      </div> : aba === "produtos" ? <>
        <aside className="produtos-pastas" aria-label="Pastas dos produtos">
          <button className={juntar("produtos-pasta", pasta === null && "bg-primary/10 text-primary", foco)} onClick={() => { setPasta(null); setAberto(null); }}><Package className="h-4 w-4" />Todos <span className="ml-auto">{kits.length}</span></button>
          {pastas.map((p) => <button key={p} className={juntar("produtos-pasta", pasta === p && "bg-primary/10 text-primary", foco)} title={p || "Sem pasta"} onClick={() => { setPasta(p); setAberto(null); }}><Folder className="h-4 w-4 shrink-0" /><span className="min-w-0 truncate">{p || "Sem pasta"}</span><span className="ml-auto">{kits.filter((k) => pastaDoProduto(k) === p).length}</span></button>)}
        </aside>
        <div className="produtos-conteudo">
          {produto ? <>
            <div className="mb-4 flex flex-wrap items-center gap-2"><Button size="icon" variant="ghost" aria-label="Voltar à lista de produtos" onClick={() => setAberto(null)}><ArrowLeft className="h-4 w-4" /></Button><h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{nomeDoKit(produto)}</h3><Button onClick={() => usar(produto.id!)}>Usar este produto</Button></div>
            <div className="mb-5 flex flex-wrap gap-2"><Button variant="outline" onClick={() => iniciarCadastro(produto)}>Adicionar fotos</Button><Button variant="outline" onClick={() => { mesa.escolherKit(produto.id); setDetalhes(true); }}>Editar produto</Button><Button variant="outline" onClick={() => { setProdutoFiltro(produto.id!); setAba("geracoes"); setGrupo(null); }}>Ver gerações</Button><Button variant="outline" onClick={() => { setMarcados([produto.id!]); setDestino(produto.atributos.organizacao?.pasta || ""); setAberto(null); }}><FolderInput className="mr-2 h-4 w-4" />Mudar pasta</Button></div>
            <div className="mb-4 max-w-lg"><PublicoDoProduto key={produto.id} kit={produto} /></div>
            {!!produto.lacunas.length && <div className="mb-4 flex items-center gap-2 text-[12px] text-muted-foreground">{produto.status === "rascunho" ? "Identificação para conferir" : "Observações do produto"}<AjudaRecolhida rotulo="O que conferir no produto">{produto.lacunas.join(" · ")}</AjudaRecolhida></div>}
            <div className="produtos-grade">{produto.refs.map((r) => { const f = fotos.find((x) => x.id === r.imagem_id); return f ? <button key={`${r.imagem_id}:${r.papel}`} className={juntar("min-w-0 text-left", foco)} onClick={() => abrirFoto(f)}><MiniaturaDaFoto foto={f} selo={false} /><span className="mt-2 block truncate text-[12px]">{r.papel === "embalagem" ? "Embalagem" : f.id === produto.frente_imagem_id ? "Foto principal" : "Referência"}{f.aprovada ? " · aprovada" : ""}</span></button> : null; })}</div>
          </> : <>
            {marcados.length > 0 && <form className="mb-4 flex flex-wrap items-center gap-2 border-b pb-4" onSubmit={(e) => { e.preventDefault(); void mover(); }}><span className="text-[12px]">{marcados.length} selecionados</span><input className={juntar(campo, "min-w-[180px] flex-1")} list="pastas-de-produtos" aria-label="Pasta de destino" placeholder="Escolha ou crie: Óculos / Sol" value={destino} onChange={(e) => setDestino(e.target.value)} disabled={movendo} /><Button type="submit" disabled={movendo}>{movendo ? "Movendo…" : destino.trim() ? "Mover para pasta" : "Deixar sem pasta"}</Button><BotaoComCusto variant="outline" rotulo="Identificar público" titulo="Produtos organizados por público" partes={() => partesDaLeitura(catalogo, kits.filter((k) => marcados.includes(k.id!) && !k.atributos.organizacao?.publico).length)} executar={identificarMarcados} disabled={movendo || !kits.some((k) => marcados.includes(k.id!) && !k.atributos.organizacao?.publico)} /><Button type="button" size="icon" variant="ghost" aria-label="Limpar seleção" onClick={() => setMarcados([])} disabled={movendo}><X className="h-4 w-4" /></Button></form>}
            {org.kits.isLoading ? <p role="status">Carregando produtos…</p> : !visiveis.length ? <div className="py-12 text-center"><Package className="mx-auto mb-3 h-7 w-7 text-muted-foreground" /><p className="text-[13px]">{kits.length ? "Nenhum produto neste filtro." : "Marque as fotos dos seus produtos para começar."}</p></div> : <div className="produtos-grade">{visiveis.map((k) => {
              const capa = capaDoKit(k, fotos); const marcado = marcados.includes(k.id!);
              return <article key={k.id} className="min-w-0" data-produto-organizado={k.id}><div className="relative"><button className={juntar("block w-full rounded-lg", foco)} aria-label={`Abrir produto ${nomeDoKit(k)}`} onClick={() => setAberto(k.id)}>{capa ? <MiniaturaDaFoto foto={capa} selo={false} /> : <span className="flex h-40 items-center justify-center rounded-lg bg-muted"><Package className="h-8 w-8 text-muted-foreground" /></span>}</button><button className={juntar("absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-md border bg-card", marcado && "border-primary text-primary", foco)} aria-label={`Selecionar ${nomeDoKit(k)} para mover`} aria-pressed={marcado} onClick={() => setMarcados(marcado ? marcados.filter((id) => id !== k.id) : [...marcados, k.id!])} disabled={movendo}>{marcado && <Check className="h-4 w-4" />}</button></div><button className="mt-2 block w-full truncate text-left text-[13px] font-medium" onClick={() => setAberto(k.id)} title={nomeDoKit(k)}>{nomeDoKit(k)}</button><p className="mt-1 truncate text-[12px] text-muted-foreground">{k.refs.length} {k.refs.length === 1 ? "foto" : "fotos"} · {pastaDoProduto(k) || "Sem pasta"}</p><Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => usar(k.id!)}>Usar produto</Button></article>;
            })}</div>}
          </>}
        </div>
      </> : <div className="produtos-conteudo">
        <div className="mb-4 flex flex-wrap gap-3"><select aria-label="Gerações por produto" className={juntar(campo, "min-w-[180px] flex-1")} value={produtoFiltro} onChange={(e) => { setProdutoFiltro(e.target.value); setGrupo(null); }}><option value="">Todos os produtos</option>{kits.map((k) => <option key={k.id} value={k.id!}>{nomeDoKit(k)}</option>)}</select><select aria-label="Gerações por modelo ou clone" className={juntar(campo, "min-w-[180px] flex-1")} value={pessoa} onChange={(e) => { setPessoa(e.target.value); setGrupo(null); }}><option value="">Todos os modelos e clones</option>{org.pessoas.map((p) => <option key={`${p.tipo}:${p.id}`} value={`${p.tipo}:${p.id}`}>{p.tipo === "clone" ? "Clone" : "Modelo"} · {p.nome}</option>)}</select></div>
        {org.carregando ? <p role="status">Organizando as gerações…</p> : grupo ? <>
          <Button variant="ghost" className="mb-4" onClick={() => setGrupo(null)}><ArrowLeft className="mr-2 h-4 w-4" />Voltar às pastas</Button><p className="mb-4 text-[13px] font-medium">{grupos.find(([id]) => id === grupo)?.[1][0].pasta}</p>
          <div className="produtos-grade">{geracoes.filter((g) => g.chave === grupo).map(({ foto: f }) => <button key={f.id} className={juntar("min-w-0 text-left", foco)} onClick={() => abrirFoto(f)} aria-label={`Abrir foto ${f.nome}`}><MiniaturaDaFoto foto={f} /><span className="mt-2 block truncate text-[12px]">{f.nome}</span></button>)}</div>
        </> : grupos.length ? <div className="produtos-grade">{grupos.map(([id, lista]) => <button key={id} className={juntar("min-w-0 text-left", foco)} onClick={() => setGrupo(id)}><MiniaturaDaFoto foto={lista[0].foto} selo={false} /><span className="mt-2 flex items-start gap-2 text-[13px] font-medium"><Folder className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{lista[0].pasta.replace("Gerações / ", "")}</span><span className="mt-1 block text-[12px] text-muted-foreground">{lista.length} {lista.length === 1 ? "foto" : "fotos"} · {lista.filter((g) => g.foto.aprovada).length} aprovadas</span></button>)}</div> : <div className="py-12 text-center"><Images className="mx-auto mb-3 h-7 w-7 text-muted-foreground" /><p className="text-[13px]">Nenhuma geração neste filtro.</p></div>}
      </div>}
    </div>
    <datalist id="pastas-de-produtos">{Array.from(new Set(kits.map((k) => k.atributos.organizacao?.pasta || ""))).filter(Boolean).map((p) => <option key={p} value={p} />)}</datalist>
  </section>;
}
