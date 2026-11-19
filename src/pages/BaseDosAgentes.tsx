import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ExternalLink, FileText, Globe, GraduationCap, Link2, Loader2, Pencil, Sparkles, Trash2, TrendingUp, Upload, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Card, Chip, EmptyState, PageHeader, PillTabs, ScrollPanel, SearchField, StatCard, StatGrid, StatTrio } from "@/components/ds";
import { Carregando, EstadoDeErro, JanelaCentral, botao, campo, campoTexto, foco, juntar, superficie, texto, useEstadoDaTela } from "@/components/sistema";
import { useAuth } from "@/contexts/AuthContext";
import { AGENTES_COM_BASE, type AgenteComBase, ehDaCasa } from "../../supabase/functions/_shared/agentes-com-base";
import {
  apagarFicha,
  apagarFonte,
  aprenderComResultados,
  lerResumoDaSemana,
  editarFicha,
  ensinar,
  type FichaDaBase,
  type FonteDaBase,
  lerClientesDaBase,
  lerFichas,
  lerFontes,
  lerResumoDosAgentes,
  ligarBibliotecaDaCasa,
  novaFicha,
  pesquisarAgora,
} from "@/components/base-dos-agentes/baseDosAgentesApi";
import { lerArquivosDoAgente } from "@/components/mesa/leituraDeArquivos";
import EvolucaoDoCliente from "@/components/base-dos-agentes/EvolucaoDoCliente";
import { deveSair, resumoDoResultado, type ResultadoDaFicha } from "../../supabase/functions/_shared/resultado-das-fichas";

/** O resultado gravado na ficha, no formato do módulo puro (a coluna numeric chega como texto). */
function resultadoDe(f: FichaDaBase): ResultadoDaFicha {
  const m = f.multiplo === null || f.multiplo === undefined ? null : Number(f.multiplo);
  const ef = f.eficiencia === null || f.eficiencia === undefined ? null : Number(f.eficiencia);
  return { aprovadas: f.aprovadas || 0, ajustadas: f.ajustadas || 0, reprovadas: f.reprovadas || 0, posts: f.posts || 0, multiplo: m !== null && Number.isFinite(m) ? m : null, anuncios: f.anuncios || 0, eficiencia: ef !== null && Number.isFinite(ef) ? ef : null };
}

/**
 * Base dos agentes (17/10/2026). Dono: "todos os que estão por trás, como se
 * fosse eles tendo uma base de aprendizado, onde eu consigo mandar documentos,
 * atualizar, complementar com mais prompt; surgiu uma técnica nova, eu quero
 * complementar; quanto mais eu carrego, mais inteligente ele fica".
 *
 * Escolhe o agente, ensina (texto, link ou documento: vira fichas já em uso),
 * pesquisa na internet quando quiser (e toda terça sozinho) e cuida das fichas:
 * liga, desliga, edita, marca como só de um cliente, apaga. Cada ficha mostra
 * quantas vezes entrou numa geração.
 *
 * Redesenho de 19/11/2026 (dono: "na lateral, dá para colocar um scroll; mais
 * limpo, mais organizado, não só lista"): no computador a lista de agentes fica
 * parada e rola por dentro (ScrollPanel; no celular vira a lista suspensa e a
 * página rola normal); à direita, cartões: o agente com os números, Ensinar,
 * o que ele recebeu e a grade de fichas. A ficha abre na JanelaCentral.
 */

type ModoDeEnsino = "texto" | "link" | "documento" | "ficha";
type FiltroDeFicha = "todas" | "ativas" | "desligadas";

const ROTULO_DO_TIPO: Record<FonteDaBase["tipo"], string> = {
  texto: "Texto",
  documento: "Documento",
  link: "Link",
  pesquisa: "Pesquisa na internet",
};

/** Quantas fichas a grade mostra antes do "Mostrar mais". */
const FICHAS_POR_VEZ = 24;
/** Quantas fontes aparecem antes do "Ver todas". */
const FONTES_A_VISTA = 6;

function haQuanto(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `há ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 172_800) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86_400)} d`;
}

/** De onde a ficha veio, como a tela mostra. */
function origemDaFonte(f: FonteDaBase): string {
  if (f.nome.indexOf("Números do Instagram") === 0) return "Números do Instagram";
  if (f.nome.indexOf("Concorrentes e referências") === 0) return "Concorrentes";
  if (f.nome.indexOf("Pedidos do cliente") === 0) return "Pedido do cliente";
  if (f.nome.indexOf("Biblioteca da casa") === 0) return "Biblioteca da casa";
  return ROTULO_DO_TIPO[f.tipo];
}

const usd = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;

export default function BaseDosAgentes() {
  const { profile } = useAuth();
  const podeEnsinar = ["admin", "manager"].includes(profile?.role || "");
  const queryClient = useQueryClient();
  const [chave, setChave] = useEstadoDaTela<string>("base-dos-agentes:agente", AGENTES_COM_BASE[0].chave, {
    validar: (v) => typeof v === "string" && AGENTES_COM_BASE.some((a) => a.chave === v),
  });
  const agente = AGENTES_COM_BASE.find((a) => a.chave === chave) ?? AGENTES_COM_BASE[0];

  const resumo = useQuery({ queryKey: ["base-dos-agentes", "resumo"], queryFn: lerResumoDosAgentes, refetchInterval: 30_000 });
  const fichas = useQuery({ queryKey: ["base-dos-agentes", "fichas", agente.chave], queryFn: () => lerFichas(agente.chave) });
  const fontes = useQuery({ queryKey: ["base-dos-agentes", "fontes", agente.chave], queryFn: () => lerFontes(agente.chave), refetchInterval: (q) => ((q.state.data as FonteDaBase[] | undefined) || []).some((f) => f.status === "lendo") ? 5_000 : false });
  const clientes = useQuery({ queryKey: ["base-dos-agentes", "clientes"], queryFn: lerClientesDaBase, staleTime: 300_000 });
  // 17/10: o que a base aprendeu na semana e as carteiras que travam a pesquisa e a leitura automática.
  const semana = useQuery({ queryKey: ["base-dos-agentes", "semana"], queryFn: lerResumoDaSemana, enabled: podeEnsinar, staleTime: 120_000, retry: false });
  const nomeDoCliente = (id: string | null) => (id ? clientes.data?.find((c) => c.id === id)?.nome || "um cliente" : null);

  const recarregar = () => {
    void queryClient.invalidateQueries({ queryKey: ["base-dos-agentes"] });
  };

  const mesas = useMemo(() => {
    const m = new Map<string, AgenteComBase[]>();
    for (const a of AGENTES_COM_BASE) m.set(a.mesa, [...(m.get(a.mesa) || []), a]);
    return [...m.entries()];
  }, []);
  const totalAtivas = Object.values(resumo.data || {}).reduce((s, r) => s + r.ativas, 0);
  const listaDeFichas = fichas.data || [];
  const emUso = listaDeFichas.filter((f) => f.ativa).length;
  const usos = listaDeFichas.reduce((s, f) => s + f.usos, 0);
  const ultimaPesquisa = resumo.data?.[agente.chave]?.ultimaPesquisa ?? null;

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Base dos agentes"
        subtitle={<span><strong className="tabular-nums text-foreground">{totalAtivas}</strong> técnicas em uso em {AGENTES_COM_BASE.length} agentes</span>}
        help="Cada agente tem a própria base de técnicas. O que você manda (texto, link ou documento) vira fichas que ele já passa a usar nas gerações. Toda terça ele pesquisa sozinho o que há de novo, e a ficha que atrapalha sai."
      />

      {podeEnsinar && <ResumoDaSemana carregando={semana.isLoading} dados={semana.data} totalAtivas={totalAtivas} />}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[272px_minmax(0,1fr)] lg:items-start">
        {/* Celular e tablet: os agentes numa lista suspensa (a coluna inteira ocupava duas telas antes do conteúdo). */}
        <select
          aria-label="Agente"
          value={agente.chave}
          onChange={(e) => setChave(e.target.value)}
          className={juntar(campo, "h-11 rounded-full lg:hidden")}
        >
          {mesas.map(([mesa, lista]) => (
            <optgroup key={mesa} label={mesa}>
              {lista.map((a) => (
                <option key={a.chave} value={a.chave}>{`${a.nome} (${resumo.data?.[a.chave]?.ativas ?? 0})`}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {/* Computador: a lateral fica parada e rola sozinha (a página não rola junto). */}
        <aside className="hidden min-w-0 lg:sticky lg:top-0 lg:block" data-lateral-dos-agentes="">
          <ScrollPanel fit="max" offset={0} label="Agentes" className={juntar(superficie.painel, "rolagem-fina p-2")}>
            <nav aria-label="Agentes" className="min-w-0 space-y-3">
              {mesas.map(([mesa, lista]) => (
                <div key={mesa} className="min-w-0">
                  <p className={juntar(texto.etiqueta, "mb-0.5 px-3 pt-1 font-medium text-muted-foreground")}>{mesa}</p>
                  <ul className="space-y-0.5">
                    {lista.map((a) => {
                      const r = resumo.data?.[a.chave];
                      const atual = a.chave === agente.chave;
                      return (
                        <li key={a.chave}>
                          <button
                            type="button"
                            onClick={() => setChave(a.chave)}
                            aria-current={atual ? "true" : undefined}
                            className={juntar(
                              foco,
                              "flex w-full min-w-0 items-center rounded-full px-3 py-2 text-left text-[13px] transition-colors",
                              atual ? "bg-foreground font-semibold text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            <GraduationCap className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="min-w-0 flex-1 truncate">{a.nome}</span>
                            <span className={juntar("ml-2 inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-medium tabular-nums", atual ? "bg-accent-solid text-on-accent" : "bg-muted text-muted-foreground")}>{r?.ativas ?? 0}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </ScrollPanel>
        </aside>

        <div className="min-w-0 space-y-5" data-base-do-agente={agente.chave}>
          <Card
            title={agente.nome}
            icon={<GraduationCap className="h-4 w-4" />}
            subtitle={ultimaPesquisa ? `${agente.mesa} · pesquisou ${haQuanto(ultimaPesquisa)}` : agente.mesa}
            collapsible={false}
            help={
              <>
                {agente.papel} O que você manda vira fichas de técnica que ele já passa a usar em toda geração; quando
                são muitas, o Jev escolhe as que servem a cada pedido. Toda terça ele pesquisa na internet o que há de
                novo sobre {agente.tema} e as fichas novas também entram em uso. Desligue o que não ajudar.
              </>
            }
            action={podeEnsinar ? <span className="inline-flex items-center"><BotaoDosResultados aoTerminar={recarregar} /><BotaoDePesquisa agente={agente} aoTerminar={recarregar} /></span> : undefined}
          >
            <StatTrio
              label={`Números de ${agente.nome}`}
              items={[
                { label: "Em uso", value: fichas.isLoading ? "…" : emUso, hint: fichas.data ? `de ${listaDeFichas.length}` : undefined },
                { label: "Usos em gerações", value: fichas.isLoading ? "…" : usos },
              ]}
            />
            <ChaveDaBiblioteca agente={agente} fichas={listaDeFichas} podeMudar={podeEnsinar} aoMudar={recarregar} />
          </Card>

          <div className={juntar("grid min-w-0 items-start gap-5", podeEnsinar && "xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]")}>
            {podeEnsinar && <CaixaDeEnsino agente={agente} clientes={clientes.data || []} aoTerminar={recarregar} />}
            <ListaDeFontes fontes={fontes.data || []} carregando={fontes.isLoading} podeApagar={podeEnsinar} nomeDoCliente={nomeDoCliente} aoMudar={recarregar} />
          </div>

          <ListaDeFichas
            key={agente.chave}
            agente={agente}
            fichas={fichas.data}
            carregando={fichas.isLoading}
            erro={fichas.error}
            aoTentarDeNovo={() => void fichas.refetch()}
            podeEditar={podeEnsinar}
            nomeDoCliente={nomeDoCliente}
            clientes={clientes.data || []}
            fontes={fontes.data || []}
            aoMudar={recarregar}
          />
        </div>
      </div>

      {podeEnsinar && <EvolucaoDoCliente clientes={clientes.data || []} />}
    </div>
  );
}

/** 17/10: o que a base aprendeu na semana, em números, e as carteiras que travam a pesquisa. */
function ResumoDaSemana({ carregando, dados, totalAtivas }: {
  carregando: boolean;
  dados?: { novas: { pesquisa: number; materiais: number; numeros: number; concorrentes: number }; sairam: number; referenciasLidas: number; carteirasBaixas: Array<{ cliente: string; saldo: number }> };
  totalAtivas: number;
}) {
  // O lugar fica guardado enquanto carrega (o resto não desce quando chega).
  if (carregando) {
    return (
      <div aria-hidden="true" className="grid min-w-0 grid-cols-2 gap-2.5 sm:gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-[112px] animate-pulse rounded-lg bg-muted sm:h-[136px]" />)}
      </div>
    );
  }
  if (!dados) return null;
  const n = dados.novas;
  const novas = n.pesquisa + n.materiais + n.numeros + n.concorrentes;
  const baixas = dados.carteirasBaixas;
  return (
    <section aria-label="Esta semana" className="min-w-0 space-y-3" data-resumo-da-semana="">
      <StatGrid cols={4} label="Esta semana">
        <StatCard variant="accent" icon={<GraduationCap className="h-4 w-4" />} label="Técnicas em uso" value={totalAtivas} size="md" hint="em todos os agentes" />
        <StatCard
          icon={<Sparkles className="h-4 w-4" />}
          label="Novas na semana"
          value={novas}
          size="md"
          hint={`${n.pesquisa} pesquisa · ${n.materiais} suas`}
          help={`${n.pesquisa} da pesquisa, ${n.materiais} do que você mandou, ${n.numeros} dos posts que renderam e ${n.concorrentes} dos concorrentes.`}
        />
        <StatCard icon={<Trash2 className="h-4 w-4" />} label="Saíram" value={dados.sairam} size="md" hint="por atrapalhar" />
        <StatCard icon={<BookOpen className="h-4 w-4" />} label="Referências lidas" value={dados.referenciasLidas} size="md" hint="de design" />
      </StatGrid>
      {baixas.length > 0 && (
        <p
          className="flex min-w-0 items-center rounded-md bg-warning-soft px-3 py-2 text-[12px] leading-5 text-warning"
          role="status"
          data-carteiras-baixas=""
          title="Com menos de US$ 1, a pesquisa da semana e a leitura automática das referências param. Recarregue na Mesa do cliente."
        >
          <Wallet className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{`Carteira baixa: ${baixas.slice(0, 8).map((c) => `${c.cliente} (${usd(c.saldo)})`).join(", ")}${baixas.length > 8 ? ` e mais ${baixas.length - 8}` : ""}.`}</span>
        </p>
      )}
    </section>
  );
}

/**
 * 23/10: a Biblioteca da casa deste agente (documentos da agência). Em cada pedido entram só os mais relevantes,
 * escolhidos pelo Jev; aqui liga ou desliga todos de uma vez. Uma linha dentro do cartão do agente.
 */
function ChaveDaBiblioteca({ agente, fichas, podeMudar, aoMudar }: { agente: AgenteComBase; fichas: FichaDaBase[]; podeMudar: boolean; aoMudar: () => void }) {
  const [mudando, setMudando] = useState(false);
  const daCasa = fichas.filter((f) => ehDaCasa(f.fonte_url));
  if (!daCasa.length) return null;
  const ligadas = daCasa.filter((f) => f.ativa).length;
  const ligada = ligadas > 0;
  const mudar = async (v: boolean) => {
    if (mudando) return;
    setMudando(true);
    try {
      await ligarBibliotecaDaCasa(agente.chave, v);
      toast.success(v ? "Biblioteca da casa ligada" : "Biblioteca da casa desligada", { description: `${agente.nome} ${v ? "volta a usar" : "deixa de usar"} os documentos da casa.` });
    } catch (e) {
      toast.error("Não deu para mudar a Biblioteca da casa", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setMudando(false);
      aoMudar();
    }
  };
  return (
    <div className="mt-5 flex min-w-0 items-center border-t border-border/60 pt-4" data-biblioteca-da-casa={ligada ? "ligada" : "desligada"}>
      <span aria-hidden="true" className="mr-3 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-primary">
        <BookOpen className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-foreground">Biblioteca da casa</p>
        <p className={juntar(texto.auxiliar, "truncate tabular-nums")} title={ligada ? "Em cada pedido entram só os mais relevantes." : undefined}>
          {ligada ? `${ligadas} de ${daCasa.length} documentos em uso` : `Desligada: ${daCasa.length} documentos fora das gerações`}
        </p>
      </div>
      {podeMudar && <Switch checked={ligada} disabled={mudando} onCheckedChange={(v) => void mudar(v)} className="ml-3 shrink-0" aria-label={ligada ? "Desligar a Biblioteca da casa deste agente" : "Ligar a Biblioteca da casa deste agente"} />}
    </div>
  );
}

/** Cruza agora as fichas com as aprovações e os números do Instagram (sem custo de IA). */
function BotaoDosResultados({ aoTerminar }: { aoTerminar: () => void }) {
  const [rodando, setRodando] = useState(false);
  const clicar = async () => {
    if (rodando) return;
    setRodando(true);
    try {
      const r = await aprenderComResultados();
      toast.success(`Resultados atualizados em ${r.fichas} ${r.fichas === 1 ? "ficha" : "fichas"}`, { description: r.vencedoras ? `${r.vencedoras} fichas novas dos posts que renderam acima do normal.` : "Nenhum post novo acima de 1,5x o normal." });
    } catch (e) {
      toast.error("Não deu para atualizar os resultados", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setRodando(false);
      aoTerminar();
    }
  };
  return (
    <button type="button" className={juntar(botao.icone, "mr-1")} onClick={() => void clicar()} disabled={rodando} aria-label="Aprender com os resultados agora" title="Cruza as fichas com o que foi aprovado e com os números do Instagram (toda terça isso roda sozinho)">
      {rodando ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
    </button>
  );
}

/** Pesquisa agora: dois toques (custa na carteira da agência). */
function BotaoDePesquisa({ agente, aoTerminar }: { agente: AgenteComBase; aoTerminar: () => void }) {
  const [armado, setArmado] = useState(false);
  const [rodando, setRodando] = useState(false);
  const relogio = useRef<number | null>(null);
  const clicar = async () => {
    if (rodando) return;
    if (!armado) {
      setArmado(true);
      if (relogio.current !== null) window.clearTimeout(relogio.current);
      relogio.current = window.setTimeout(() => setArmado(false), 6000);
      return;
    }
    setArmado(false);
    setRodando(true);
    try {
      const r = await pesquisarAgora(agente.chave);
      if (r.fichas) toast.success(`${agente.nome} aprendeu ${r.fichas} ${r.fichas === 1 ? "técnica nova" : "técnicas novas"}`, { description: r.titulos.slice(0, 4).join(" · ") });
      else toast.info("A pesquisa não trouxe nada novo", { description: r.observacao || undefined });
      aoTerminar();
    } catch (e) {
      toast.error("A pesquisa não terminou", { description: e instanceof Error ? e.message : undefined });
      aoTerminar();
    } finally {
      setRodando(false);
    }
  };
  return (
    <button type="button" className={juntar(botao.secundario, "h-8 text-[12px]")} onClick={() => void clicar()} disabled={rodando} aria-label={armado ? "Clique de novo para pesquisar (cerca de US$ 0,10)" : "Pesquisar agora"} title="Pesquisa na internet as técnicas novas deste agente">
      {rodando ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <Globe className="h-3.5 w-3.5 sm:mr-1.5" />}
      <span className={armado ? undefined : "hidden sm:inline"}>{rodando ? "Pesquisando…" : armado ? "Clique de novo (~US$ 0,10)" : "Pesquisar agora"}</span>
    </button>
  );
}

function SeletorDoCliente({ valor, aoMudar, clientes, id }: { valor: string; aoMudar: (v: string) => void; clientes: { id: string; nome: string }[]; id: string }) {
  return (
    <select id={id} aria-label="Para qual cliente" className={juntar(campo, "h-9")} value={valor} onChange={(e) => aoMudar(e.target.value)}>
      <option value="">Todos os clientes</option>
      {clientes.map((c) => <option key={c.id} value={c.id}>Só {c.nome}</option>)}
    </select>
  );
}

/** Ensinar: texto, link, documento ou ficha escrita à mão. */
function CaixaDeEnsino({ agente, clientes, aoTerminar }: { agente: AgenteComBase; clientes: { id: string; nome: string }[]; aoTerminar: () => void }) {
  const [modo, setModo] = useState<ModoDeEnsino>("texto");
  const [textoLivre, setTextoLivre] = useState("");
  const [link, setLink] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [ficha, setFicha] = useState({ titulo: "", tecnica: "", quando_usar: "", exemplo: "" });
  const [enviando, setEnviando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const pronto = modo === "texto" ? textoLivre.trim().length >= 20
    : modo === "link" ? /^https?:\/\//i.test(link.trim())
      : modo === "documento" ? arquivos.length > 0
        : ficha.titulo.trim().length >= 3 && ficha.tecnica.trim().length >= 10;

  const avisar = (r: { fichas: number; titulos: string[]; observacao: string }) => {
    if (r.fichas) toast.success(`${agente.nome} aprendeu ${r.fichas} ${r.fichas === 1 ? "técnica" : "técnicas"}`, { description: r.titulos.slice(0, 4).join(" · ") });
    else toast.info("Nada aproveitável para este agente", { description: r.observacao || undefined });
  };

  const enviar = async () => {
    if (!pronto || enviando) return;
    setEnviando(true);
    const cliente = clienteId || null;
    try {
      if (modo === "texto") {
        avisar(await ensinar({ agente: agente.chave, clientId: cliente, tipo: "texto", texto: textoLivre.trim() }));
        setTextoLivre("");
      } else if (modo === "link") {
        avisar(await ensinar({ agente: agente.chave, clientId: cliente, tipo: "link", url: link.trim(), texto: textoLivre.trim() || undefined }));
        setLink("");
        setTextoLivre("");
      } else if (modo === "documento") {
        // O texto sai no navegador (PDF, Word, planilha, apresentação, ZIP): o servidor recebe só o texto.
        const lidos = await lerArquivosDoAgente(arquivos);
        for (const n of lidos.naoLidos) toast.warning(`${n.nome} não foi lido`, { description: n.motivo });
        for (const a of lidos.lidos) {
          avisar(await ensinar({ agente: agente.chave, clientId: cliente, tipo: "documento", nome: a.nome, texto: a.texto }));
        }
        setArquivos([]);
      } else {
        await novaFicha({ agente: agente.chave, clientId: cliente, ...ficha });
        toast.success("Ficha gravada e em uso");
        setFicha({ titulo: "", tecnica: "", quando_usar: "", exemplo: "" });
      }
    } catch (e) {
      toast.error("Não deu para ensinar agora", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setEnviando(false);
      aoTerminar();
    }
  };

  const MODOS: Array<{ id: ModoDeEnsino; rotulo: string; icone: typeof FileText }> = [
    { id: "texto", rotulo: "Texto ou prompt", icone: FileText },
    { id: "link", rotulo: "Link ou vídeo", icone: Link2 },
    { id: "documento", rotulo: "Documento", icone: Upload },
    { id: "ficha", rotulo: "Ficha pronta", icone: Pencil },
  ];

  return (
    <Card
      title="Ensinar"
      icon={<BookOpen className="h-4 w-4" />}
      collapsible="base-dos-agentes:ensinar"
      help="Cole a técnica, o prompt, a anotação do vídeo que você viu ou a regra nova; mande um link ou um documento (PDF, Word, PowerPoint, planilha, texto ou ZIP). O agente transforma em fichas e já passa a usar. Escolha um cliente para a ficha valer só para ele."
      data-ensinar=""
    >
      <div className="min-w-0 space-y-3">
        <PillTabs
          label="Como ensinar"
          variant="soft"
          size="sm"
          value={modo}
          onChange={(v) => setModo(v as ModoDeEnsino)}
          tabs={MODOS.map((m) => ({ value: m.id, label: m.rotulo, icon: <m.icone className="h-3.5 w-3.5" /> }))}
        />

        {modo === "texto" && (
          <textarea
            className={juntar(campoTexto, "min-h-[120px]")}
            value={textoLivre}
            onChange={(e) => setTextoLivre(e.target.value)}
            placeholder="Cole a técnica, o prompt ou a regra nova."
            aria-label="Texto para o agente aprender"
          />
        )}
        {modo === "link" && (
          <div className="space-y-2">
            <input className={campo} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://… (artigo, post ou vídeo)" aria-label="Link para o agente aprender" inputMode="url" />
            <textarea className={juntar(campoTexto, "min-h-[64px]")} value={textoLivre} onChange={(e) => setTextoLivre(e.target.value)} placeholder="Opcional: o que chamou sua atenção nele." aria-label="O que chamou atenção no link" />
          </div>
        )}
        {modo === "documento" && (
          <div className="min-w-0">
            <input ref={entrada} type="file" multiple className="hidden" accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.zip,.html,.json" onChange={(e) => setArquivos(Array.from(e.target.files || []))} data-entrada-da-base="" />
            <button
              type="button"
              onClick={() => entrada.current?.click()}
              className={juntar(foco, "flex min-h-[120px] w-full min-w-0 flex-col items-center justify-center rounded-md border border-dashed border-border px-4 py-5 text-center transition-colors hover:border-foreground/30 hover:bg-muted/30")}
            >
              <Upload className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="mt-2 text-[13px] font-medium text-foreground">{arquivos.length ? `${arquivos.length} ${arquivos.length === 1 ? "arquivo" : "arquivos"}` : "Escolher arquivos"}</span>
              <span className={juntar(texto.auxiliar, "mt-0.5 max-w-full truncate")}>{arquivos.length ? arquivos.map((a) => a.name).join(", ") : "PDF, Word, PowerPoint, planilha, texto ou ZIP"}</span>
            </button>
          </div>
        )}
        {modo === "ficha" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={campo} value={ficha.titulo} onChange={(e) => setFicha({ ...ficha, titulo: e.target.value })} placeholder="Nome da técnica" aria-label="Nome da técnica" />
            <input className={campo} value={ficha.quando_usar} onChange={(e) => setFicha({ ...ficha, quando_usar: e.target.value })} placeholder="Quando usar" aria-label="Quando usar" />
            <textarea className={juntar(campoTexto, "sm:col-span-2")} value={ficha.tecnica} onChange={(e) => setFicha({ ...ficha, tecnica: e.target.value })} placeholder="Como fazer (2 a 6 frases)" aria-label="Como fazer" />
            <input className={juntar(campo, "sm:col-span-2")} value={ficha.exemplo} onChange={(e) => setFicha({ ...ficha, exemplo: e.target.value })} placeholder="Exemplo (opcional)" aria-label="Exemplo" />
          </div>
        )}

        <div className="flex min-w-0 flex-wrap items-center">
          <div className="mb-2 mr-2 w-full sm:mb-0 sm:w-56">
            <SeletorDoCliente id="base-cliente" valor={clienteId} aoMudar={setClienteId} clientes={clientes} />
          </div>
          <button type="button" className={juntar(botao.primario, "h-9 sm:ml-auto")} onClick={() => void enviar()} disabled={!pronto || enviando}>
            {enviando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BookOpen className="mr-1.5 h-3.5 w-3.5" />}
            {enviando ? "Aprendendo…" : modo === "ficha" ? "Gravar ficha" : "Ensinar"}
          </button>
        </div>
      </div>
    </Card>
  );
}

function ListaDeFichas({
  agente, fichas, carregando, erro, aoTentarDeNovo, podeEditar, nomeDoCliente, clientes, fontes, aoMudar,
}: {
  agente: AgenteComBase;
  fichas: FichaDaBase[] | undefined;
  carregando: boolean;
  erro: unknown;
  aoTentarDeNovo: () => void;
  podeEditar: boolean;
  nomeDoCliente: (id: string | null) => string | null;
  clientes: { id: string; nome: string }[];
  fontes: FonteDaBase[];
  aoMudar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useEstadoDaTela<FiltroDeFicha>("base-dos-agentes:filtro", "todas", { validar: (v) => v === "todas" || v === "ativas" || v === "desligadas" });
  const [aberta, setAberta] = useState<string | null>(null);
  const [mostrar, setMostrar] = useState(FICHAS_POR_VEZ);
  const lista = fichas || [];
  const ativas = lista.filter((f) => f.ativa).length;
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return lista.filter((f) =>
      (filtro === "todas" || (filtro === "ativas" ? f.ativa : !f.ativa))
      && (!q || `${f.titulo} ${f.tecnica} ${f.quando_usar}`.toLowerCase().indexOf(q) >= 0));
  }, [lista, busca, filtro]);
  const fonteDe = (id: string | null) => (id ? fontes.find((f) => f.id === id) : undefined);
  const fichaAberta = aberta ? lista.find((f) => f.id === aberta) : undefined;

  return (
    <section aria-label="O que ele sabe" className="min-w-0 space-y-4" data-fichas-do-agente="">
      <div className="flex min-w-0 flex-wrap items-center">
        <div className="mr-auto flex min-w-0 items-baseline py-1">
          <h2 className={juntar(texto.tituloSecao, "min-w-0 truncate")}>O que ele sabe</h2>
          {fichas && <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>{lista.length} {lista.length === 1 ? "ficha" : "fichas"}</span>}
        </div>
        <div className="-m-1 flex min-w-0 max-w-full flex-wrap items-center">
          <PillTabs
            className="m-1"
            label="Quais fichas"
            variant="soft"
            size="sm"
            value={filtro}
            onChange={(v) => { setFiltro(v); setMostrar(FICHAS_POR_VEZ); }}
            tabs={[
              { value: "todas", label: "Todas", count: lista.length },
              { value: "ativas", label: "Em uso", count: ativas },
              { value: "desligadas", label: "Desligadas", count: lista.length - ativas },
            ]}
          />
          <SearchField className="m-1 w-full sm:w-52" value={busca} onChange={(v) => { setBusca(v); setMostrar(FICHAS_POR_VEZ); }} placeholder="Buscar" label="Buscar nas fichas" />
        </div>
      </div>

      {carregando ? <Carregando forma="grade" linhas={4} rotulo="Lendo as fichas" /> : erro ? (
        <EstadoDeErro
          titulo="Não deu para ler as fichas."
          descricao="Se a base ainda não está no banco, a migration precisa ser aplicada."
          acao={<button type="button" className={botao.secundario} onClick={aoTentarDeNovo}>Tentar de novo</button>}
        />
      ) : !filtradas.length ? (
        <EmptyState
          icon={<GraduationCap className="h-5 w-5" />}
          title={busca || filtro !== "todas" ? "Nenhuma ficha aqui" : `${agente.nome} ainda não aprendeu nada`}
          description={busca || filtro !== "todas" ? undefined : "Ensine acima ou clique em Pesquisar agora."}
        />
      ) : (
        <ul className="grid min-w-0 gap-3 sm:grid-cols-2 desk:grid-cols-3">
          {filtradas.slice(0, mostrar).map((f) => (
            <CartaoDaFicha key={f.id} ficha={f} fonte={fonteDe(f.fonte_id)} cliente={nomeDoCliente(f.client_id)} podeEditar={podeEditar} aoAbrir={() => setAberta(f.id)} aoMudar={aoMudar} />
          ))}
        </ul>
      )}
      {filtradas.length > mostrar && (
        <div className="flex justify-center">
          <button type="button" className={botao.secundario} onClick={() => setMostrar((m) => m + FICHAS_POR_VEZ)}>Mostrar mais ({filtradas.length - mostrar})</button>
        </div>
      )}

      {fichaAberta && (
        <JanelaDaFicha
          key={fichaAberta.id}
          ficha={fichaAberta}
          fonte={fonteDe(fichaAberta.fonte_id)}
          cliente={nomeDoCliente(fichaAberta.client_id)}
          clientes={clientes}
          podeEditar={podeEditar}
          aoFechar={() => setAberta(null)}
          aoMudar={aoMudar}
        />
      )}
    </section>
  );
}

/** As etiquetas da ficha: de onde veio, de qual cliente, por que foi arquivada. */
function EtiquetasDaFicha({ ficha, fonte, cliente }: { ficha: FichaDaBase; fonte?: FonteDaBase; cliente: string | null }) {
  return (
    <>
      {ehDaCasa(ficha.fonte_url)
        ? <span data-da-casa=""><Chip tone="accent">Biblioteca da casa</Chip></span>
        : <Chip>{fonte ? origemDaFonte(fonte) : "À mão"}</Chip>}
      {cliente && <Chip tone="info">Só {cliente}</Chip>}
      {!ficha.ativa && ficha.arquivada_por && (
        <span data-arquivada-por={ficha.arquivada_por} title={ficha.arquivada_por === "casa_desligada" ? "Desligada junto com a Biblioteca da casa deste agente." : "A faxina do mês desligou esta ficha. Ligue de novo se quiser."}>
          <Chip>{ficha.arquivada_por === "casa_desligada" ? "Biblioteca desligada" : ficha.arquivada_por === "repetida" ? "Arquivada: repetida" : "Arquivada: sem uso em 60 dias"}</Chip>
        </span>
      )}
    </>
  );
}

function CartaoDaFicha({ ficha, fonte, cliente, podeEditar, aoAbrir, aoMudar }: { ficha: FichaDaBase; fonte?: FonteDaBase; cliente: string | null; podeEditar: boolean; aoAbrir: () => void; aoMudar: () => void }) {
  const alternar = async (ativa: boolean) => {
    try {
      await editarFicha(ficha.id, { ativa });
      aoMudar();
    } catch (e) {
      toast.error("Não deu para mudar a ficha", { description: e instanceof Error ? e.message : undefined });
    }
  };
  const resultado = resumoDoResultado(resultadoDe(ficha));
  return (
    <li className={juntar(superficie.painel, "flex min-w-0 flex-col p-4 sm:p-5", !ficha.ativa && "opacity-60")} data-ficha={ficha.id}>
      <div className="flex min-w-0 items-start">
        <button type="button" className={juntar(foco, "min-w-0 flex-1 rounded-sm text-left")} onClick={aoAbrir} aria-label={`Abrir a ficha ${ficha.titulo}`}>
          <span className="block text-[14px] font-semibold leading-5 text-foreground line-clamp-2">{ficha.titulo}</span>
          <span className="mt-1.5 block text-[13px] leading-5 text-muted-foreground line-clamp-3">{ficha.tecnica}</span>
        </button>
        {podeEditar && <Switch checked={ficha.ativa} onCheckedChange={(v) => void alternar(v)} className="ml-3 mt-0.5 shrink-0" aria-label={ficha.ativa ? "Desligar a ficha" : "Ligar a ficha"} />}
      </div>
      {ficha.ativa && deveSair(resultadoDe(ficha)) && (
        <p className="mt-3 rounded-md bg-warning-soft px-2.5 py-1.5 text-[12px] leading-4 text-warning" role="status" data-sugestao-desligar="" title={`Esta ficha está atrapalhando (${resultado}) e já não entra nas gerações. Desligue ou edite.`}>
          Atrapalhando: já não entra nas gerações
        </p>
      )}
      <div className="mt-auto min-w-0 pt-3">
        <div className="flex min-w-0 flex-wrap items-center border-t border-border/60 pt-3 [&>*]:mb-1 [&>*]:mr-1">
          <EtiquetasDaFicha ficha={ficha} fonte={fonte} cliente={cliente} />
        </div>
        <p className={juntar(texto.auxiliar, "truncate tabular-nums")} data-resultado-da-ficha={resultado ? "" : undefined}>
          {ficha.usos ? `usada ${ficha.usos} ${ficha.usos === 1 ? "vez" : "vezes"} · ${haQuanto(ficha.ultimo_uso)}` : "ainda não usada"}
          {resultado ? ` · ${resultado}` : ""}
        </p>
      </div>
    </li>
  );
}

/** A ficha inteira, no centro: ler, editar, ligar e apagar. */
function JanelaDaFicha({ ficha, fonte, cliente, clientes, podeEditar, aoFechar, aoMudar }: { ficha: FichaDaBase; fonte?: FonteDaBase; cliente: string | null; clientes: { id: string; nome: string }[]; podeEditar: boolean; aoFechar: () => void; aoMudar: () => void }) {
  const [editando, setEditando] = useState(false);
  const [apagar, setApagar] = useState(false);
  const [v, setV] = useState({ titulo: ficha.titulo, tecnica: ficha.tecnica, quando_usar: ficha.quando_usar, exemplo: ficha.exemplo, client_id: ficha.client_id || "" });
  const [salvando, setSalvando] = useState(false);
  const resultado = resumoDoResultado(resultadoDe(ficha));
  const alternar = async (ativa: boolean) => {
    try {
      await editarFicha(ficha.id, { ativa });
      aoMudar();
    } catch (e) {
      toast.error("Não deu para mudar a ficha", { description: e instanceof Error ? e.message : undefined });
    }
  };
  const remover = async () => {
    if (!apagar) { setApagar(true); window.setTimeout(() => setApagar(false), 5000); return; }
    try {
      await apagarFicha(ficha.id);
      aoMudar();
      aoFechar();
    } catch (e) {
      toast.error("Não deu para apagar", { description: e instanceof Error ? e.message : undefined });
    }
  };
  const salvar = async () => {
    setSalvando(true);
    try {
      await editarFicha(ficha.id, { ...v, client_id: v.client_id || null });
      toast.success("Ficha salva");
      aoMudar();
      setEditando(false);
    } catch (e) {
      toast.error("Não deu para salvar", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSalvando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={aoFechar}
      titulo={ficha.titulo}
      icone={<GraduationCap className="h-4 w-4" />}
      descricao={ficha.ativa ? "Em uso" : "Desligada"}
      largura="md"
      acoes={podeEditar && !editando ? <Switch checked={ficha.ativa} onCheckedChange={(x) => void alternar(x)} aria-label={ficha.ativa ? "Desligar a ficha" : "Ligar a ficha"} /> : undefined}
      rodape={podeEditar ? (
        editando ? (
          <div className="flex min-w-0 justify-end [&>*+*]:ml-2">
            <button type="button" className={juntar(botao.discreto, "h-9")} onClick={() => setEditando(false)}>Cancelar</button>
            <button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void salvar()} disabled={salvando}>Salvar</button>
          </div>
        ) : (
          <div className="flex min-w-0 items-center [&>*+*]:ml-2">
            <button type="button" className={juntar(botao.discreto, "h-9", apagar && "text-destructive")} onClick={() => void remover()} aria-label={apagar ? "Confirmar: apagar a ficha" : "Apagar a ficha"}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />{apagar ? "Clique de novo para apagar" : "Apagar"}
            </button>
            <button type="button" className={juntar(botao.secundario, "ml-auto h-9")} onClick={() => setEditando(true)} aria-label="Editar a ficha">
              <Pencil className="mr-1.5 h-3.5 w-3.5" />Editar
            </button>
          </div>
        )
      ) : undefined}
    >
      {editando ? (
        <div className="min-w-0 space-y-3">
          <input className={campo} value={v.titulo} onChange={(e) => setV({ ...v, titulo: e.target.value })} aria-label="Nome da técnica" />
          <textarea className={juntar(campoTexto, "min-h-[120px]")} value={v.tecnica} onChange={(e) => setV({ ...v, tecnica: e.target.value })} aria-label="Como fazer" />
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={campo} value={v.quando_usar} onChange={(e) => setV({ ...v, quando_usar: e.target.value })} placeholder="Quando usar" aria-label="Quando usar" />
            <input className={campo} value={v.exemplo} onChange={(e) => setV({ ...v, exemplo: e.target.value })} placeholder="Exemplo" aria-label="Exemplo" />
          </div>
          <SeletorDoCliente id={`ficha-cliente-${ficha.id}`} valor={v.client_id} aoMudar={(c) => setV({ ...v, client_id: c })} clientes={clientes} />
        </div>
      ) : (
        <div className="min-w-0 space-y-4">
          {ficha.ativa && deveSair(resultadoDe(ficha)) && (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-[12px] leading-5 text-warning" role="status">
              Esta ficha está atrapalhando ({resultado}) e já não entra nas gerações. Desligue ou edite.
            </p>
          )}
          <p className="text-[14px] leading-6 text-foreground">{ficha.tecnica}</p>
          {ficha.quando_usar && (
            <div className="min-w-0">
              <p className={texto.rotulo}>Quando usar</p>
              <p className={juntar(texto.corpo, "mt-0.5")}>{ficha.quando_usar}</p>
            </div>
          )}
          {ficha.exemplo && (
            <div className="min-w-0">
              <p className={texto.rotulo}>Exemplo</p>
              <p className={juntar(texto.corpo, "mt-0.5")}>{ficha.exemplo}</p>
            </div>
          )}
          <div className="flex min-w-0 flex-wrap items-center border-t border-border/60 pt-3 [&>*]:mb-1 [&>*]:mr-1">
            <EtiquetasDaFicha ficha={ficha} fonte={fonte} cliente={cliente} />
          </div>
          <p className={juntar(texto.auxiliar, "tabular-nums")}>
            {ficha.usos ? `Usada ${ficha.usos} ${ficha.usos === 1 ? "vez" : "vezes"}, a última ${haQuanto(ficha.ultimo_uso)}` : "Ainda não usada"}
            {resultado ? ` · ${resultado}` : ""}
          </p>
          {(fonte && fonte.tipo !== "pesquisa" && !ehDaCasa(ficha.fonte_url)) || (ficha.fonte_url && !ehDaCasa(ficha.fonte_url)) ? (
            <p className={juntar(texto.auxiliar, "flex min-w-0 items-center")}>
              {fonte && fonte.tipo !== "pesquisa" && !ehDaCasa(ficha.fonte_url) && <span className="mr-2 min-w-0 truncate" title={fonte.nome}>{fonte.nome}</span>}
              {ficha.fonte_url && !ehDaCasa(ficha.fonte_url) && (
                <a href={ficha.fonte_url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center text-primary hover:underline">
                  fonte <ExternalLink className="ml-0.5 h-3 w-3" />
                </a>
              )}
            </p>
          ) : null}
        </div>
      )}
    </JanelaCentral>
  );
}

function ListaDeFontes({ fontes, carregando, podeApagar, nomeDoCliente, aoMudar }: { fontes: FonteDaBase[]; carregando: boolean; podeApagar: boolean; nomeDoCliente: (id: string | null) => string | null; aoMudar: () => void }) {
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [todas, setTodas] = useState(false);
  const remover = async (f: FonteDaBase) => {
    if (confirmar !== f.id) { setConfirmar(f.id); window.setTimeout(() => setConfirmar((c) => (c === f.id ? null : c)), 5000); return; }
    try {
      await apagarFonte(f.id);
      toast.success("Fonte e fichas dela apagadas");
      aoMudar();
    } catch (e) {
      toast.error("Não deu para apagar", { description: e instanceof Error ? e.message : undefined });
    }
  };
  const visiveis = todas ? fontes : fontes.slice(0, FONTES_A_VISTA);
  return (
    <Card
      title="O que ele recebeu"
      icon={<FileText className="h-4 w-4" />}
      subtitle={fontes.length ? `${fontes.length} ${fontes.length === 1 ? "fonte" : "fontes"}` : undefined}
      collapsible="base-dos-agentes:fontes"
      data-fontes-do-agente=""
    >
      {carregando ? <Carregando forma="lista" linhas={3} /> : !fontes.length ? (
        <EmptyState compact title="Nada recebido ainda" />
      ) : (
        <>
          <ul className="-mx-2 min-w-0 divide-y divide-border/60">
            {visiveis.map((f) => (
              <li key={f.id} className="flex min-w-0 items-center rounded-md px-2 py-2.5 text-[13px] hover:bg-muted/40">
                <span className="mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                  {f.tipo === "pesquisa" ? <Globe className="h-3.5 w-3.5 text-info" /> : f.tipo === "link" ? <Link2 className="h-3.5 w-3.5" /> : f.tipo === "documento" ? <Upload className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground" title={f.nome}>{f.nome}</span>
                  <span className={juntar(texto.auxiliar, "block truncate tabular-nums")} title={f.status === "erro" ? f.erro || undefined : undefined}>
                    {ROTULO_DO_TIPO[f.tipo]} · {haQuanto(f.criado_em)}
                    {nomeDoCliente(f.client_id) ? ` · só ${nomeDoCliente(f.client_id)}` : ""}
                    {f.status === "lendo" ? " · lendo…" : f.status === "erro" ? ` · não deu: ${f.erro || "falha"}` : ` · ${f.fichas} ${f.fichas === 1 ? "ficha" : "fichas"}`}
                    {f.fichas === 0 && f.status === "pronta" && f.erro ? ` (${f.erro})` : ""}
                    {f.custo_usd > 0 ? ` · ${usd(Number(f.custo_usd))}` : ""}
                  </span>
                </span>
                {podeApagar && (
                  <button type="button" className={juntar(botao.icone, "ml-1 shrink-0", confirmar === f.id && "text-destructive")} onClick={() => void remover(f)} aria-label={confirmar === f.id ? "Confirmar: apagar a fonte e as fichas dela" : "Apagar a fonte e as fichas dela"} title={confirmar === f.id ? "Clique de novo: apaga a fonte e as fichas dela" : "Apagar a fonte e as fichas dela"}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {fontes.length > FONTES_A_VISTA && (
            <button type="button" className={juntar(botao.discreto, "mt-2 h-8")} onClick={() => setTodas((x) => !x)}>
              {todas ? "Ver menos" : `Ver todas (${fontes.length})`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}
