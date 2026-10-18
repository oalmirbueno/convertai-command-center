import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ExternalLink, FileText, Globe, GraduationCap, Link2, Loader2, Pencil, Search, Trash2, TrendingUp, Upload } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { CabecalhoDePagina, Carregando, EstadoDeErro, EstadoVazio, Secao, botao, campo, campoTexto, etiqueta, juntar, superficie, texto, useEstadoDaTela } from "@/components/sistema";
import { useAuth } from "@/contexts/AuthContext";
import { AGENTES_COM_BASE, type AgenteComBase } from "../../supabase/functions/_shared/agentes-com-base";
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
 */

type ModoDeEnsino = "texto" | "link" | "documento" | "ficha";

const ROTULO_DO_TIPO: Record<FonteDaBase["tipo"], string> = {
  texto: "Texto",
  documento: "Documento",
  link: "Link",
  pesquisa: "Pesquisa na internet",
};

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
  return ROTULO_DO_TIPO[f.tipo];
}

const usd = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;

/** A linha do "Esta semana" (montada aqui: a explicação fica no "?" da seção). */
function linhaDaSemana(r: { novas: { pesquisa: number; materiais: number; numeros: number; concorrentes: number }; sairam: number; referenciasLidas: number }): string {
  const total = r.novas.pesquisa + r.novas.materiais + r.novas.numeros + r.novas.concorrentes;
  const partes = [
    `${total} técnicas novas (${r.novas.pesquisa} da pesquisa, ${r.novas.materiais} do que você mandou, ${r.novas.numeros} dos posts que renderam, ${r.novas.concorrentes} dos concorrentes)`,
    r.sairam ? `${r.sairam} saíram por atrapalhar` : "",
    `${r.referenciasLidas} referências de design lidas`,
  ];
  return partes.filter(Boolean).join(" · ");
}

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

  return (
    <div className="min-w-0 space-y-5">
      <CabecalhoDePagina
        titulo="Base dos agentes"
        descricao={<span><strong className="tabular-nums text-foreground">{totalAtivas}</strong> técnicas em uso em {AGENTES_COM_BASE.length} agentes</span>}
      />

      {semana.data && (
        <section aria-label="Esta semana" className="min-w-0 space-y-2" data-resumo-da-semana="">
          <p className="text-[13px] leading-5 text-foreground">
            <span className="font-semibold">Esta semana: </span>
            {linhaDaSemana(semana.data)}
          </p>
          {semana.data.carteirasBaixas.length > 0 && (
            <p className="rounded-md bg-warning/10 px-2.5 py-2 text-[12px] leading-5 text-warning" role="status" data-carteiras-baixas="" title="Com menos de US$ 1, a pesquisa da semana e a leitura automática das referências param. Recarregue na Mesa do cliente.">
              {`Carteira baixa: ${semana.data.carteirasBaixas.slice(0, 8).map((c) => `${c.cliente} (${usd(c.saldo)})`).join(", ")}${semana.data.carteirasBaixas.length > 8 ? ` e mais ${semana.data.carteirasBaixas.length - 8}` : ""}.`}
            </p>
          )}
        </section>
      )}

      {podeEnsinar && <EvolucaoDoCliente clientes={clientes.data || []} />}

      <div className="grid min-w-0 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Os agentes, por mesa. */}
        <nav aria-label="Agentes" className="min-w-0 space-y-4">
          {mesas.map(([mesa, lista]) => (
            <div key={mesa} className="min-w-0">
              <p className={juntar(texto.rotulo, "mb-1 px-2")}>{mesa}</p>
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
                          "flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                          atual ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                        )}
                      >
                        <GraduationCap className="mr-2 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{a.nome}</span>
                        <span className="ml-2 shrink-0 text-[12px] tabular-nums">{r?.ativas ?? 0}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-5" data-base-do-agente={agente.chave}>
          <Secao
            titulo={`${agente.nome} · ${agente.mesa}`}
            descricao={
              <span className="-mx-1 inline-flex flex-wrap items-center [&>*]:mx-1">
                <span><strong className="tabular-nums text-foreground">{(fichas.data || []).filter((f) => f.ativa).length}</strong> em uso</span>
                <span><strong className="tabular-nums text-foreground">{(fichas.data || []).reduce((s, f) => s + f.usos, 0)}</strong> usos em gerações</span>
                {resumo.data?.[agente.chave]?.ultimaPesquisa && <span>pesquisou {haQuanto(resumo.data[agente.chave].ultimaPesquisa)}</span>}
              </span>
            }
            ajuda={
              <>
                {agente.papel} O que você manda vira fichas de técnica que ele já passa a usar em toda geração; quando
                são muitas, o Jev escolhe as que servem a cada pedido. Toda terça ele pesquisa na internet o que há de
                novo sobre {agente.tema} e as fichas novas também entram em uso. Desligue o que não ajudar.
              </>
            }
            acao={podeEnsinar ? <span className="inline-flex items-center"><BotaoDosResultados aoTerminar={recarregar} /><BotaoDePesquisa agente={agente} aoTerminar={recarregar} /></span> : undefined}
          >
            {podeEnsinar && <CaixaDeEnsino agente={agente} clientes={clientes.data || []} aoTerminar={recarregar} />}
          </Secao>

          <ListaDeFichas
            agente={agente}
            fichas={fichas.data}
            carregando={fichas.isLoading}
            erro={fichas.error}
            podeEditar={podeEnsinar}
            nomeDoCliente={nomeDoCliente}
            clientes={clientes.data || []}
            fontes={fontes.data || []}
            aoMudar={recarregar}
          />

          <ListaDeFontes fontes={fontes.data || []} podeApagar={podeEnsinar} nomeDoCliente={nomeDoCliente} aoMudar={recarregar} />
        </div>
      </div>
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
    <button type="button" className={juntar(botao.secundario, "h-8 text-[12px]")} onClick={() => void clicar()} disabled={rodando} title="Pesquisa na internet as técnicas novas deste agente">
      {rodando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Globe className="mr-1.5 h-3.5 w-3.5" />}
      {rodando ? "Pesquisando…" : armado ? "Clique de novo (~US$ 0,10)" : "Pesquisar agora"}
    </button>
  );
}

function SeletorDoCliente({ valor, aoMudar, clientes, id }: { valor: string; aoMudar: (v: string) => void; clientes: { id: string; nome: string }[]; id: string }) {
  return (
    <select id={id} className={juntar(campo, "h-9")} value={valor} onChange={(e) => aoMudar(e.target.value)}>
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
    <div className="min-w-0 space-y-3" data-ensinar="">
      <div className="-m-0.5 flex flex-wrap" role="tablist" aria-label="Como ensinar">
        {MODOS.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={modo === m.id}
            onClick={() => setModo(m.id)}
            className={juntar("m-0.5 inline-flex h-8 items-center rounded-md px-2.5 text-[12px] transition-colors", modo === m.id ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}
          >
            <m.icone className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {m.rotulo}
          </button>
        ))}
      </div>

      {modo === "texto" && (
        <textarea
          className={juntar(campoTexto, "min-h-[120px]")}
          value={textoLivre}
          onChange={(e) => setTextoLivre(e.target.value)}
          placeholder={`Cole a técnica, o prompt, a anotação do vídeo que você viu ou a regra nova. O agente transforma em fichas e já passa a usar.`}
          aria-label="Texto para o agente aprender"
        />
      )}
      {modo === "link" && (
        <div className="space-y-2">
          <input className={campo} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://… (artigo, post, vídeo do YouTube ou do Instagram)" aria-label="Link para o agente aprender" inputMode="url" />
          <textarea className={juntar(campoTexto, "min-h-[64px]")} value={textoLivre} onChange={(e) => setTextoLivre(e.target.value)} placeholder="Opcional: o que chamou sua atenção nele (ajuda quando é vídeo)." aria-label="O que chamou atenção no link" />
        </div>
      )}
      {modo === "documento" && (
        <div className="space-y-2">
          <input ref={entrada} type="file" multiple className="hidden" accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.zip,.html,.json" onChange={(e) => setArquivos(Array.from(e.target.files || []))} data-entrada-da-base="" />
          <button type="button" className={juntar(botao.secundario, "h-9 text-[12px]")} onClick={() => entrada.current?.click()}>
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Escolher arquivos
          </button>
          {arquivos.length > 0 && <p className={texto.auxiliar}>{arquivos.map((a) => a.name).join(", ")}</p>}
          <p className={texto.auxiliar}>PDF, Word, PowerPoint, planilha, texto ou ZIP. Cada documento vira as próprias fichas.</p>
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
        <div className="mb-2 mr-2 w-full sm:mb-0 sm:w-64">
          <SeletorDoCliente id="base-cliente" valor={clienteId} aoMudar={setClienteId} clientes={clientes} />
        </div>
        <button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void enviar()} disabled={!pronto || enviando}>
          {enviando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BookOpen className="mr-1.5 h-3.5 w-3.5" />}
          {enviando ? "Aprendendo…" : modo === "ficha" ? "Gravar ficha" : "Ensinar"}
        </button>
      </div>
    </div>
  );
}

function ListaDeFichas({
  agente, fichas, carregando, erro, podeEditar, nomeDoCliente, clientes, fontes, aoMudar,
}: {
  agente: AgenteComBase;
  fichas: FichaDaBase[] | undefined;
  carregando: boolean;
  erro: unknown;
  podeEditar: boolean;
  nomeDoCliente: (id: string | null) => string | null;
  clientes: { id: string; nome: string }[];
  fontes: FonteDaBase[];
  aoMudar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const lista = fichas || [];
    return q ? lista.filter((f) => `${f.titulo} ${f.tecnica} ${f.quando_usar}`.toLowerCase().includes(q)) : lista;
  }, [fichas, busca]);
  const fonteDe = (id: string | null) => (id ? fontes.find((f) => f.id === id) : undefined);

  return (
    <Secao
      titulo="O que ele sabe"
      descricao={fichas ? <span><strong className="tabular-nums text-foreground">{fichas.length}</strong> {fichas.length === 1 ? "ficha" : "fichas"}</span> : undefined}
      acao={
        <label className="relative block w-48 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <input className={juntar(campo, "h-8 pl-8 text-[12px]")} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar" aria-label="Buscar nas fichas" />
        </label>
      }
    >
      {carregando ? <Carregando /> : erro ? (
        <EstadoDeErro titulo="Não deu para ler as fichas." descricao="Se a base ainda não está no banco, a migration precisa ser aplicada." />
      ) : !filtradas.length ? (
        <EstadoVazio icone={<GraduationCap className="h-5 w-5" />} titulo={busca ? "Nenhuma ficha com essa busca." : `${agente.nome} ainda não aprendeu nada aqui.`} descricao={busca ? undefined : "Mande um texto, link ou documento acima, ou clique em Pesquisar agora."} />
      ) : (
        <ul className="min-w-0 space-y-2">
          {filtradas.map((f) => editando === f.id ? (
            <EditorDaFicha key={f.id} ficha={f} clientes={clientes} aoFechar={() => setEditando(null)} aoMudar={aoMudar} />
          ) : (
            <CartaoDaFicha key={f.id} ficha={f} fonte={fonteDe(f.fonte_id)} cliente={nomeDoCliente(f.client_id)} podeEditar={podeEditar} aoEditar={() => setEditando(f.id)} aoMudar={aoMudar} />
          ))}
        </ul>
      )}
    </Secao>
  );
}

function CartaoDaFicha({ ficha, fonte, cliente, podeEditar, aoEditar, aoMudar }: { ficha: FichaDaBase; fonte?: FonteDaBase; cliente: string | null; podeEditar: boolean; aoEditar: () => void; aoMudar: () => void }) {
  const [aberta, setAberta] = useState(false);
  const [apagar, setApagar] = useState(false);
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
    } catch (e) {
      toast.error("Não deu para apagar", { description: e instanceof Error ? e.message : undefined });
    }
  };
  return (
    <li className={juntar(superficie.painel, "min-w-0 p-3", !ficha.ativa && "opacity-60")} data-ficha={ficha.id}>
      <div className="flex min-w-0 items-start">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setAberta((v) => !v)} aria-expanded={aberta}>
          <p className="text-[13px] font-semibold leading-5 text-foreground">{ficha.titulo}</p>
          <p className={juntar("mt-0.5 text-[13px] leading-5 text-foreground/85", !aberta && "line-clamp-2")}>{ficha.tecnica}</p>
          {aberta && ficha.quando_usar && <p className="mt-1 text-[12px] text-muted-foreground"><span className="font-medium text-foreground">Quando usar:</span> {ficha.quando_usar}</p>}
          {aberta && ficha.exemplo && <p className="mt-1 text-[12px] text-muted-foreground"><span className="font-medium text-foreground">Exemplo:</span> {ficha.exemplo}</p>}
        </button>
        {podeEditar && <Switch checked={ficha.ativa} onCheckedChange={(v) => void alternar(v)} className="ml-3 mt-0.5 shrink-0" aria-label={ficha.ativa ? "Desligar a ficha" : "Ligar a ficha"} />}
      </div>
      {ficha.ativa && deveSair(resultadoDe(ficha)) && (
        <p className="mt-2 rounded-md bg-warning/10 px-2.5 py-1.5 text-[12px] text-warning" role="status" data-sugestao-desligar="">
          Esta ficha está atrapalhando ({resumoDoResultado(resultadoDe(ficha))}) e já não entra nas gerações. Desligue ou edite.
        </p>
      )}
      <div className="mt-2 flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground [&>*]:mr-2.5">
        <span className={juntar(etiqueta, "bg-secondary text-foreground")}>{fonte ? origemDaFonte(fonte) : "À mão"}</span>
        {cliente && <span className={juntar(etiqueta, "bg-primary/15 text-primary")}>Só {cliente}</span>}
        {!ficha.ativa && ficha.arquivada_por && (
          <span className={juntar(etiqueta, "bg-secondary text-muted-foreground")} data-arquivada-por={ficha.arquivada_por} title="A faxina do mês desligou esta ficha. Ligue de novo se quiser.">
            {ficha.arquivada_por === "repetida" ? "Arquivada: repetida" : "Arquivada: sem uso em 60 dias"}
          </span>
        )}
        <span className="tabular-nums">{ficha.usos ? `usada ${ficha.usos} ${ficha.usos === 1 ? "vez" : "vezes"} · ${haQuanto(ficha.ultimo_uso)}` : "ainda não usada"}</span>
        {resumoDoResultado(resultadoDe(ficha)) && <span className="tabular-nums text-foreground" data-resultado-da-ficha="">{resumoDoResultado(resultadoDe(ficha))}</span>}
        {fonte && fonte.tipo !== "pesquisa" && <span className="min-w-0 max-w-[16rem] truncate" title={fonte.nome}>{fonte.nome}</span>}
        {ficha.fonte_url && (
          <a href={ficha.fonte_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-primary hover:underline">
            fonte <ExternalLink className="ml-0.5 h-3 w-3" />
          </a>
        )}
        {podeEditar && (
          <span className="ml-auto inline-flex items-center">
            <button type="button" className={botao.icone} onClick={aoEditar} aria-label="Editar a ficha" title="Editar"><Pencil className="h-3.5 w-3.5" /></button>
            <button type="button" className={juntar(botao.icone, apagar && "text-destructive")} onClick={() => void remover()} aria-label={apagar ? "Confirmar: apagar a ficha" : "Apagar a ficha"} title={apagar ? "Clique de novo para apagar" : "Apagar"}><Trash2 className="h-3.5 w-3.5" /></button>
          </span>
        )}
      </div>
    </li>
  );
}

function EditorDaFicha({ ficha, clientes, aoFechar, aoMudar }: { ficha: FichaDaBase; clientes: { id: string; nome: string }[]; aoFechar: () => void; aoMudar: () => void }) {
  const [v, setV] = useState({ titulo: ficha.titulo, tecnica: ficha.tecnica, quando_usar: ficha.quando_usar, exemplo: ficha.exemplo, client_id: ficha.client_id || "" });
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    setSalvando(true);
    try {
      await editarFicha(ficha.id, { ...v, client_id: v.client_id || null });
      toast.success("Ficha salva");
      aoMudar();
      aoFechar();
    } catch (e) {
      toast.error("Não deu para salvar", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setSalvando(false);
    }
  };
  return (
    <li className={juntar(superficie.painel, "min-w-0 space-y-2 p-3")}>
      <input className={campo} value={v.titulo} onChange={(e) => setV({ ...v, titulo: e.target.value })} aria-label="Nome da técnica" />
      <textarea className={campoTexto} value={v.tecnica} onChange={(e) => setV({ ...v, tecnica: e.target.value })} aria-label="Como fazer" />
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={campo} value={v.quando_usar} onChange={(e) => setV({ ...v, quando_usar: e.target.value })} placeholder="Quando usar" aria-label="Quando usar" />
        <input className={campo} value={v.exemplo} onChange={(e) => setV({ ...v, exemplo: e.target.value })} placeholder="Exemplo" aria-label="Exemplo" />
      </div>
      <div className="flex min-w-0 flex-wrap items-center">
        <div className="mb-2 mr-2 w-full sm:mb-0 sm:w-64">
          <SeletorDoCliente id={`ficha-cliente-${ficha.id}`} valor={v.client_id} aoMudar={(c) => setV({ ...v, client_id: c })} clientes={clientes} />
        </div>
        <button type="button" className={juntar(botao.primario, "mr-2 h-9")} onClick={() => void salvar()} disabled={salvando}>Salvar</button>
        <button type="button" className={juntar(botao.discreto, "h-9")} onClick={aoFechar}>Cancelar</button>
      </div>
    </li>
  );
}

function ListaDeFontes({ fontes, podeApagar, nomeDoCliente, aoMudar }: { fontes: FonteDaBase[]; podeApagar: boolean; nomeDoCliente: (id: string | null) => string | null; aoMudar: () => void }) {
  const [confirmar, setConfirmar] = useState<string | null>(null);
  if (!fontes.length) return null;
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
  return (
    <Secao titulo="O que ele recebeu" descricao={<span><strong className="tabular-nums text-foreground">{fontes.length}</strong> fontes</span>}>
      <ul className="divide-y divide-border">
        {fontes.map((f) => (
          <li key={f.id} className="flex min-w-0 items-center py-2 text-[13px]">
            <span className="mr-2 shrink-0">
              {f.tipo === "pesquisa" ? <Globe className="h-3.5 w-3.5 text-info" /> : f.tipo === "link" ? <Link2 className="h-3.5 w-3.5" /> : f.tipo === "documento" ? <Upload className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground" title={f.nome}>{f.nome}</span>
              <span className={texto.auxiliar}>
                {ROTULO_DO_TIPO[f.tipo]} · {haQuanto(f.criado_em)}
                {nomeDoCliente(f.client_id) ? ` · só ${nomeDoCliente(f.client_id)}` : ""}
                {f.status === "lendo" ? " · lendo…" : f.status === "erro" ? ` · não deu: ${f.erro || "falha"}` : ` · ${f.fichas} ${f.fichas === 1 ? "ficha" : "fichas"}`}
                {f.fichas === 0 && f.status === "pronta" && f.erro ? ` (${f.erro})` : ""}
                {f.custo_usd > 0 ? ` · ${usd(Number(f.custo_usd))}` : ""}
              </span>
            </span>
            {podeApagar && (
              <button type="button" className={juntar(botao.icone, confirmar === f.id && "text-destructive")} onClick={() => void remover(f)} aria-label={confirmar === f.id ? "Confirmar: apagar a fonte e as fichas dela" : "Apagar a fonte e as fichas dela"} title={confirmar === f.id ? "Clique de novo: apaga a fonte e as fichas dela" : "Apagar a fonte e as fichas dela"}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </Secao>
  );
}

