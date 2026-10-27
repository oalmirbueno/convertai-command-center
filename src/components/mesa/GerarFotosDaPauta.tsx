import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Check, ImagePlus, Search, Upload, Wand2, X } from "lucide-react";
import { BotaoComCusto } from "./Custo";
import { AcoesDaBancada } from "./BancadaDaPauta";
import { useMarcaDaMesa, useMesa } from "./MesaContexto";
import { SeletorDeModelo } from "./Seletores";
import { padraoPara } from "@/lib/mesa/api";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { botao, campo, campoTexto, foco, juntar } from "@/components/sistema/estilos";
import { MiniaturaDaFoto, Moldura } from "@/components/mesa-foto/Comuns";
import { ImagemDaBiblioteca, temImagem } from "@/components/mesa-foto/EtapaBiblioteca";
import SeletorDeFotos from "@/components/mesa-foto/SeletorDeFotos";
import { acrescentarFotos, invalidarFotos, subirOriginais, useBiblioteca, useFotos, type ItemDaBiblioteca } from "@/components/mesa-foto/fotoApi";
import { partesDoGerar } from "@/components/mesa-foto/canvasApi";
import {
  aplicarOrganizacao, gerarFotoDaPauta, gruposDasReferencias, MAX_REFERENCIAS_DA_PAUTA, organizarReferencias, PAPEIS_DA_REFERENCIA, partesDoOrganizar, ROTULO_DO_PAPEL,
  type PapelDaReferencia, type ReferenciaDaPauta,
} from "@/components/mesa-foto/fotoDaPautaApi";
import { linhasDaDirecaoDeFoto, normalizarDirecaoDeFoto } from "../../../supabase/functions/agente-calendario/modulos/peca-de-foto";
import { caminhoDaFotoDaPauta, ordenarReferencias } from "../../../supabase/functions/mesa-foto/foto-da-pauta-regras";

/** Categorias da biblioteca que viram cartão de estilo (o assunto vem da pauta e das referências). */
const CATEGORIAS_DE_ESTILO = ["estilo", "luz", "composicao", "cenario", "ambiente"];

/** Cartões de estilo: prompts da biblioteca com imagem de exemplo, os de estilo e os em destaque primeiro. Pura. */
export function estilosEmCartoes(itens: ItemDaBiblioteca[], busca = ""): ItemDaBiblioteca[] {
  const termo = busca.trim().toLowerCase();
  const peso = (i: ItemDaBiblioteca) => (CATEGORIAS_DE_ESTILO.indexOf(i.categoria) >= 0 ? 0 : 2) - (i.destaque ? 1 : 0);
  return itens
    .filter((i) => i.tipo === "prompt" && temImagem(i))
    .filter((i) => !termo || `${i.titulo} ${i.categoria} ${i.tags.join(" ")}`.toLowerCase().indexOf(termo) >= 0)
    .sort((a, b) => peso(a) - peso(b) || a.titulo.localeCompare(b.titulo, "pt-BR"));
}

/**
 * Gerar da pauta (27/10/2026): a foto nasce do contexto da pauta e do
 * cliente, no estilo escolhido em cartões, com referências marcadas por papel
 * (antes, depois, produto, cenário, estilo). Custo à vista; o resultado cai
 * no acervo e na prancheta do post.
 *
 * "Entender e organizar" (27/10): a IA olha as referências, descreve cada
 * uma, o Jev escolhe o papel e os pares antes e depois ficam juntos, na
 * ordem que o gerador usa. O papel continua editável à mão.
 */
export default function GerarFotosDaPauta({ taskId, titulo, direcao, referencias, onReferencias, onFotos }: {
  taskId: string; titulo: string; direcao?: Record<string, unknown>;
  referencias: ReferenciaDaPauta[]; onReferencias: (r: ReferenciaDaPauta[]) => void;
  /** Fotos novas (vão para a prancheta, depois das que já estão). */
  onFotos: (ids: string[]) => void;
}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const { marca } = useMarcaDaMesa();
  const cache = useQueryClient();
  const fotos = useFotos(clientId);
  const biblioteca = useBiblioteca(clientId);
  const inicial = normalizarDirecaoDeFoto(direcao, { tema: titulo });
  const chave = (parte: string) => `mesa:foto:gerar:${clientId}:${taskId}:${parte}`;
  const [instrucao, setInstrucao] = useEstadoDaTela(`mesa:foto:gerar:${clientId}:${taskId}`, linhasDaDirecaoDeFoto(inicial).join("\n"));
  const [estiloId, setEstiloId] = useEstadoDaTela<string | null>(chave("estilo"), null);
  const [formato, setFormato] = useEstadoDaTela(chave("formato"), "4:5");
  const [motor, setMotor] = useState("");
  const modelo = motor || padraoPara(catalogo, "imagem")?.id || "";
  const [quantidade, setQuantidade] = useState(Math.min(4, Math.max(1, direcao ? inicial.quantidade : 1)));
  const [papelNovo, setPapelNovo] = useState<PapelDaReferencia>("produto");
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(6);
  const [escolhendo, setEscolhendo] = useState(false);
  const [subindo, setSubindo] = useState("");
  const [progresso, setProgresso] = useState("");
  const [sugerirOrganizar, setSugerirOrganizar] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);
  // A resposta da organização chega depois: aplica sobre a lista de agora, não a do clique.
  const referenciasAgora = useRef(referencias);
  referenciasAgora.current = referencias;

  const cartoes = useMemo(() => estilosEmCartoes(biblioteca.data || [], busca), [biblioteca.data, busca]);
  const estilo = (biblioteca.data || []).find((i) => i.id === estiloId) || null;
  const porId = new Map((fotos.data || []).map((f) => [f.id, f]));
  const refs = referencias.filter((r) => porId.has(r.imagem_id));
  const cheio = refs.length >= MAX_REFERENCIAS_DA_PAUTA;
  const antes = refs.filter((r) => r.papel === "antes").length;
  const depois = refs.filter((r) => r.papel === "depois").length;

  const acrescentarRefs = (ids: string[], papel: PapelDaReferencia) => {
    const novas = ids.filter((id) => !referencias.some((r) => r.imagem_id === id)).map((imagem_id) => ({ imagem_id, papel }));
    onReferencias(referencias.concat(novas).slice(0, MAX_REFERENCIAS_DA_PAUTA));
  };
  const subir = async (lista: FileList | null) => {
    if (!lista || !lista.length) return;
    try {
      const r = await subirOriginais(clientId, Array.from(lista).slice(0, MAX_REFERENCIAS_DA_PAUTA), (feitos, total) => setSubindo(`Subindo ${feitos} de ${total}…`));
      acrescentarFotos(cache, clientId, r.registradas);
      acrescentarRefs(r.registradas.map((f) => f.id), papelNovo);
      if (r.registradas.length) setSugerirOrganizar(true);
      if (r.recusadas.length) toast.message(`${r.recusadas.length} ficou de fora`, { description: r.recusadas[0].motivo });
    } catch (e) {
      toast.error("As fotos não subiram", { description: e instanceof Error ? e.message : "Tente de novo." });
    } finally { setSubindo(""); if (arquivo.current) arquivo.current.value = ""; }
  };

  const pronto = !!modelo && (!!instrucao.trim() || refs.length > 0) && !progresso;
  const ordenadas = ordenarReferencias(refs);
  const caminho = caminhoDaFotoDaPauta(ordenadas);
  const montar = async () => {
    if (caminho.tipo !== "montagem") return;
    try {
      for (let n = 0; n < caminho.pares; n++) {
        setProgresso(`Montando ${n + 1} de ${caminho.pares}…`);
        const r = await gerarFotoDaPauta({ clientId, taskId, titulo, pedido: instrucao, referencias: ordenadas, guia: { modo: "nenhum" }, modeloImagemId: modelo, formato, marcaId: marca?.id || null, posicao: { atual: n + 1, total: caminho.pares } });
        if (!r.imagem) throw new Error("A montagem não foi confirmada.");
        acrescentarFotos(cache, clientId, [r.imagem]);
        onFotos([r.imagem.id]);
      }
      toast.success("Antes e depois pronto", { description: "Com as fotos reais, sem IA. Está na prancheta." });
    } catch (e) {
      toast.error("O antes e depois não foi montado", { description: e instanceof Error ? e.message : "Tente de novo." });
    } finally { setProgresso(""); invalidarFotos(cache, clientId); }
  };
  const grupos = gruposDasReferencias(refs);
  const trocarPapel = (id: string, papel: PapelDaReferencia) => onReferencias(referencias.map((x) => x.imagem_id === id ? { ...x, papel } : x));
  const itemDaReferencia = (r: ReferenciaDaPauta) => {
    const f = porId.get(r.imagem_id)!;
    return <div className="min-w-0" data-referencia={r.papel}>
      <div className="relative"><MiniaturaDaFoto foto={f} className="rounded-md" /><button type="button" aria-label={`Tirar ${f.nome} das referências`} title="Tirar das referências" onClick={() => onReferencias(referencias.filter((x) => x.imagem_id !== r.imagem_id))} className="absolute right-1 top-1 rounded-full bg-card/90 p-0.5 hover:bg-card"><X className="h-3 w-3" aria-hidden="true" /></button></div>
      <select aria-label={`Papel de ${f.nome}`} value={r.papel} onChange={(e) => trocarPapel(r.imagem_id, e.target.value as PapelDaReferencia)} className="mt-1 h-8 w-full min-w-0 rounded-md border border-input bg-background px-1 text-[12px]">
        {PAPEIS_DA_REFERENCIA.map((p) => <option key={p} value={p}>{ROTULO_DO_PAPEL[p]}</option>)}
      </select>
      {r.descricao && <p className="mt-0.5 line-clamp-2 break-words text-[11px] text-muted-foreground" title={r.descricao} data-descricao-da-referencia="">{r.descricao}</p>}
    </div>;
  };
  return <section aria-label="Gerar fotos da pauta" className="min-w-0 space-y-4" data-gerar-da-pauta="">
    <div className="min-w-0">
      <label className="mb-1 block text-[12px] font-medium text-muted-foreground" htmlFor={`direcao-${taskId}`}>O que a foto mostra</label>
      <textarea id={`direcao-${taskId}`} aria-label="Direção para gerar as fotos" value={instrucao} onChange={(e) => setInstrucao(e.target.value)} className={juntar(campoTexto, "min-h-28")} />
      <p className="mt-1 text-[12px] text-muted-foreground">Já vem da pauta e do contexto do cliente.</p>
    </div>

    <div className="min-w-0" data-estilos-da-pauta="">
      <div className="mb-2 flex min-w-0 items-center justify-between"><p className="text-[12px] font-medium text-muted-foreground">Estilo</p><span className="truncate text-[12px]">{estilo ? estilo.titulo : "Pela marca"}</span></div>
      <div className="relative mb-2"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" /><input aria-label="Buscar estilo" value={busca} onChange={(e) => { setBusca(e.target.value); setLimite(6); }} placeholder="Buscar estilo" className={juntar(campo, "pl-8")} /></div>
      <div role="radiogroup" aria-label="Estilo da foto" className="grid grid-cols-3 gap-2">
        <button type="button" role="radio" aria-checked={!estiloId} onClick={() => setEstiloId(null)} className={juntar("min-w-0 rounded-lg border-2 p-1 text-left", foco, !estiloId ? "border-primary" : "border-transparent hover:border-border")}>
          <Moldura proporcao={1} className="bg-muted"><span className="flex h-full w-full items-center justify-center px-1 text-center text-[11px] text-muted-foreground">Pela marca</span></Moldura>
          <span className="mt-1 block truncate text-[11px]">Sem estilo extra</span>
        </button>
        {cartoes.slice(0, limite).map((i) => <button key={i.id} type="button" role="radio" aria-checked={estiloId === i.id} title={i.uso || i.titulo} onClick={() => setEstiloId(i.id)} className={juntar("min-w-0 rounded-lg border-2 p-1 text-left", foco, estiloId === i.id ? "border-primary" : "border-transparent hover:border-border")}>
          <Moldura proporcao={1} className="overflow-hidden rounded-md bg-muted"><ImagemDaBiblioteca item={i} />{estiloId === i.id && <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground"><Check className="h-3 w-3" aria-hidden="true" /></span>}</Moldura>
          <span className="mt-1 block truncate text-[11px]">{i.titulo}</span>
        </button>)}
      </div>
      {biblioteca.isLoading && <p role="status" className="mt-2 text-[12px] text-muted-foreground">Lendo os estilos…</p>}
      {cartoes.length > limite && <button type="button" className="mt-2 text-[12px] text-primary" onClick={() => setLimite((l) => l + 9)}>Ver mais estilos ({cartoes.length - limite})</button>}
    </div>

    <div className="min-w-0" data-referencias-da-pauta="">
      <div className="mb-2 flex min-w-0 items-center justify-between">
        <p className="text-[12px] font-medium text-muted-foreground">Referências</p>
        <div className="flex min-w-0 items-center">
          <BotaoComCusto rotulo={<><Wand2 className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Entender e organizar as fotos</span></>} titulo="Entender e organizar as fotos"
            variant={sugerirOrganizar ? "default" : "ghost"} className="mr-1 h-8 px-2" disabled={!refs.length || !!progresso}
            partes={() => partesDoOrganizar(catalogo, refs.length)}
            executar={async () => {
              const r = await organizarReferencias({ clientId, taskId, titulo, pedido: instrucao, referencias: refs });
              onReferencias(aplicarOrganizacao(referenciasAgora.current, r.referencias));
              setSugerirOrganizar(false);
              if (r.avisos.length) toast.message("Confira as referências", { description: r.avisos.join(" ") });
              return { custo_usd: r.custo_usd };
            }} />
          <span className="text-[12px] text-muted-foreground">{refs.length}/{MAX_REFERENCIAS_DA_PAUTA}</span>
        </div>
      </div>
      {sugerirOrganizar && refs.length > 0 && <p role="status" className="mb-2 text-[12px] text-primary">Fotos novas: use a varinha para a IA entender e organizar.</p>}
      <div role="radiogroup" aria-label="Papel das próximas referências" className="mb-2 flex flex-wrap">
        {PAPEIS_DA_REFERENCIA.map((p) => <button key={p} type="button" role="radio" aria-checked={papelNovo === p} onClick={() => setPapelNovo(p)} className={juntar("mb-1 mr-1 rounded-full border px-2.5 py-1 text-[12px]", foco, papelNovo === p ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>{ROTULO_DO_PAPEL[p]}</button>)}
      </div>
      {refs.length > 0 && <ul className="mb-2 grid grid-cols-3 gap-2" aria-label="Referências escolhidas">
        {grupos.map((g) => g.tipo === "par"
          ? <li key={`${g.antes.imagem_id}-${g.depois.imagem_id}`} className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-1" data-par-antes-depois="" aria-label={`Par: ${porId.get(g.antes.imagem_id)!.nome} antes, ${porId.get(g.depois.imagem_id)!.nome} depois`}>
              {itemDaReferencia(g.antes)}
              <ArrowRight className="mt-8 h-4 w-4 text-primary" aria-hidden="true" />
              {itemDaReferencia(g.depois)}
            </li>
          : <li key={g.referencia.imagem_id} className="min-w-0">{itemDaReferencia(g.referencia)}</li>)}
      </ul>}
      {(antes > 0 || depois > 0) && <p className="mb-2 text-[12px] text-muted-foreground">{antes && depois ? `Antes e depois: a foto sai como comparação fiel, sem inventar resultado.` : antes ? "Marque também o depois para montar a comparação." : "Marque também o antes para montar a comparação."}</p>}
      <div className="flex flex-wrap">
        <button type="button" disabled={cheio} onClick={() => setEscolhendo(true)} className={juntar(botao.secundario, "mb-1 mr-2")}><ImagePlus className="mr-1.5 h-4 w-4" aria-hidden="true" />Do acervo</button>
        <button type="button" disabled={cheio || !!subindo} onClick={() => arquivo.current?.click()} className={juntar(botao.secundario, "mb-1")}><Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />{subindo || "Subir"}</button>
        <input ref={arquivo} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden aria-label="Subir referências" onChange={(e) => void subir(e.target.files)} />
      </div>
    </div>

    <div className="grid min-w-0 grid-cols-2 gap-2">
      <label className="min-w-0 text-[12px] text-muted-foreground">Formato<select aria-label="Formato da foto" className={juntar(campo, "mt-1")} value={formato} onChange={(e) => setFormato(e.target.value)}>{["4:5", "1:1", "9:16", "16:9"].map((f) => <option key={f}>{f}</option>)}</select></label>
      <label className="min-w-0 text-[12px] text-muted-foreground">Fotos<select aria-label="Quantidade de fotos a gerar" className={juntar(campo, "mt-1")} value={quantidade} onChange={(e) => setQuantidade(Number(e.target.value))}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
    </div>
    <SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={modelo} onChange={setMotor} />
    {/* 27/10 (dono): foto real nunca passa pelo gerador. Antes e depois: montagem com os pixels reais (sem custo);
        antes, depois ou lugar sem par: entra no post como está; só produto ou estilo: aí o gerador cria a cena. */}
    {caminho.tipo === "montagem" ? <AcoesDaBancada><button type="button" className={juntar(botao.primario, "mb-1")} disabled={!!progresso} onClick={() => void montar()} data-montar-antes-depois="">{progresso || (caminho.pares > 1 ? `Montar ${caminho.pares} antes e depois` : "Montar antes e depois")}</button></AcoesDaBancada>
      : caminho.tipo === "real_como_esta" ? <AcoesDaBancada><button type="button" className={juntar(botao.primario, "mb-1")} onClick={() => { onFotos(caminho.indices.map((k) => ordenadas[k].imagem_id)); toast.success("Fotos reais no post", { description: "Entram como estão, sem passar pelo gerador." }); }} data-usar-fotos-reais="">Usar as fotos reais</button></AcoesDaBancada>
      : <AcoesDaBancada><BotaoComCusto rotulo={progresso || (quantidade === 1 ? "Gerar foto" : `Gerar ${quantidade} fotos`)} titulo="Gerar fotos da pauta" descricao="Cria fotos novas pelo contexto da pauta, no estilo e com as referências escolhidas. Entram no acervo e na prancheta, marcadas como geradas."
      disabled={!pronto} partes={() => Array.from({ length: quantidade }, () => partesDoGerar([modelo], "alta", refs.length + (estilo ? 1 : 0))).flat()}
      executar={async () => {
        const geradas: string[] = []; let custo = 0;
        try {
          for (let n = 0; n < quantidade; n++) {
            setProgresso(`Gerando ${n + 1} de ${quantidade}…`);
            const r = await gerarFotoDaPauta({
              clientId, taskId, titulo, pedido: instrucao, referencias: refs, guia: estilo ? { modo: "biblioteca", prompt_id: estilo.id } : { modo: "nenhum" },
              modeloImagemId: modelo, formato, marcaId: marca?.id || null, posicao: quantidade > 1 ? { atual: n + 1, total: quantidade } : null,
            });
            if (!r.imagem) throw new Error(`A foto ${n + 1} não foi confirmada. As já concluídas continuam no acervo.`);
            acrescentarFotos(cache, clientId, [r.imagem]); geradas.push(r.imagem.id); custo += r.custo_usd;
            onFotos([r.imagem.id]);
            if (r.avisos.length) toast.message("Confira a foto nova", { description: r.avisos.join(" ") });
          }
          return { custo_usd: custo };
        } finally { setProgresso(""); invalidarFotos(cache, clientId); atualizarCusto(); }
      }} /></AcoesDaBancada>}
    {caminho.tipo !== "gerar" && <p className="text-[12px] text-muted-foreground" data-foto-real-intacta="">{caminho.tipo === "montagem" ? "Antes e depois montado com as duas fotos reais, lado a lado, sem IA e sem custo." : "Foto real de antes, depois ou do lugar não vai ao gerador (ele redesenha). Entra no post como está; marque antes e depois para montar a comparação."}</p>}
    {!modelo && <p className="text-[12px] text-muted-foreground">Escolha o modelo de imagem.</p>}
    {progresso && <p role="status" className="text-[12px] text-primary">{progresso}</p>}
    <JanelaCentral aberta={escolhendo} onFechar={() => setEscolhendo(false)} titulo={`Referências: ${ROTULO_DO_PAPEL[papelNovo]}`} largura="xl">
      {escolhendo && <SeletorDeFotos fotos={(fotos.data || []).filter((f) => f.client_id === clientId && f.ativa)} titulo={`Escolher ${ROTULO_DO_PAPEL[papelNovo].toLowerCase()}`} multiplas jaEscolhidas={refs.map((r) => r.imagem_id)} limiteSelecao={MAX_REFERENCIAS_DA_PAUTA - refs.length} onUsar={(ids) => { acrescentarRefs(ids, papelNovo); setEscolhendo(false); }} onFechar={() => setEscolhendo(false)} />}
    </JanelaCentral>
  </section>;
}
