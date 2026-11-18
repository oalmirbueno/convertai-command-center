import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Brain, Check, Copy, Download, FileText, Folder, Loader2, Plug, RotateCcw, Save, Search, Sparkles, Terminal } from "lucide-react";
import { toast } from "sonner";
import { CabecalhoDePagina, Carregando, EstadoDeErro, EstadoVazio, Secao, botao, campo, campoTexto, etiqueta, juntar, superficie, texto, useEstadoDaTela } from "@/components/sistema";
import { useAuth } from "@/contexts/AuthContext";
import {
  ROTULO_DO_AGENTE,
  lerArquivo,
  lerArvore,
  lerManifesto,
  lerMaquinas,
  lerSkill,
  linkDoPacote,
  mudarStatus,
  salvarArquivo,
  type SkillDaCentral,
} from "@/components/central-de-skills/centralApi";

/**
 * Central de Skills (18/11/2026). Dono: "pega todas as skills do Claude, do
 * Hermes, do Codex e todas que tiver, organiza, e qualquer agente que entrar no
 * painel via MCP já pega e instala; e o segundo cérebro por ali, ler e editar
 * em tempo real". Uma tela: as skills por categoria, os conectores (plugins,
 * MCP, Composio), como instalar em qualquer máquina e o segundo cérebro.
 */

type Aba = "skills" | "conectores" | "instalar" | "cerebro";
const ABAS: Array<{ id: Aba; rotulo: string; icone: typeof Sparkles }> = [
  { id: "skills", rotulo: "Skills", icone: Sparkles },
  { id: "conectores", rotulo: "Conectores", icone: Plug },
  { id: "instalar", rotulo: "Instalar", icone: Terminal },
  { id: "cerebro", rotulo: "Segundo cérebro", icone: Brain },
];

function haQuanto(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "agora";
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} d`;
}

function tamanho(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function BotaoCopiar({ valor, rotulo = "Copiar" }: { valor: string; rotulo?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className={juntar(botao.secundario, "h-8")}
      onClick={() => { void navigator.clipboard.writeText(valor); setOk(true); setTimeout(() => setOk(false), 1500); }}
    >
      {ok ? <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
      {ok ? "Copiado" : rotulo}
    </button>
  );
}

function Comando({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className={texto.rotulo}>{titulo}</p>
        <BotaoCopiar valor={valor} />
      </div>
      <pre className="overflow-x-auto rounded-md bg-muted/60 p-3 text-[12px] leading-5 text-foreground [overflow-wrap:anywhere] whitespace-pre-wrap">{valor}</pre>
    </div>
  );
}

// ─── Skills ──────────────────────────────────────────────────

function DetalheDaSkill({ slug, podeEscrever, aoMudar }: { slug: string; podeEscrever: boolean; aoMudar: () => void }) {
  const q = useQuery({ queryKey: ["central-skill", slug], queryFn: () => lerSkill(slug) });
  const [baixando, setBaixando] = useState(false);
  if (q.isLoading) return <Carregando rotulo="Abrindo a skill" />;
  if (q.error || !q.data) return <EstadoDeErro descricao={(q.error as Error)?.message} />;
  const s = q.data;
  const baixar = async () => {
    setBaixando(true);
    try {
      const url = await linkDoPacote(s.slug);
      if (url) window.open(url, "_blank", "noopener");
      else toast.error("Esta skill não tem pacote; copie o SKILL.md.");
    } catch (e) { toast.error((e as Error).message); } finally { setBaixando(false); }
  };
  const status = async (novo: "ativa" | "arquivada") => {
    try { await mudarStatus(s.slug, novo); toast.success(novo === "arquivada" ? "Arquivada: sai das próximas sincronizações." : "Restaurada."); aoMudar(); q.refetch(); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className={texto.tituloSecao}>{s.nome}</h3>
        <p className={texto.auxiliar}>{s.slug} · v{s.versao} · {s.arquivos} arquivo(s) · {tamanho(s.tamanho_bytes)} · {haQuanto(s.atualizado_em)}</p>
        {s.descricao && <p className={texto.corpo}>{s.descricao}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={juntar(botao.primario, "h-8")} onClick={baixar} disabled={baixando}>
          {baixando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
          Baixar pacote
        </button>
        <BotaoCopiar valor={s.skill_md} rotulo="Copiar SKILL.md" />
        {podeEscrever && (s.status === "ativa"
          ? <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => status("arquivada")}><Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Arquivar</button>
          : <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => status("ativa")}><RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Restaurar</button>)}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {s.runtimes.map((r) => <span key={r} className={juntar(etiqueta, "bg-muted text-muted-foreground")}>{ROTULO_DO_AGENTE[r] ?? r}</span>)}
        {s.plugin && <span className={juntar(etiqueta, "bg-primary/10 text-primary")}>plugin {s.plugin}</span>}
      </div>
      {s.origens?.length > 0 && (
        <div className="space-y-1">
          <p className={texto.rotulo}>Onde foi encontrada</p>
          <ul className="space-y-0.5">
            {s.origens.slice(0, 8).map((o, i) => <li key={i} className={texto.auxiliar}>{ROTULO_DO_AGENTE[o.runtime] ?? o.runtime}{o.maquina ? ` · ${o.maquina}` : ""} · {o.caminho}</li>)}
          </ul>
        </div>
      )}
      <div className="space-y-1">
        <p className={texto.rotulo}>SKILL.md</p>
        <pre className="max-h-[50vh] overflow-auto rounded-md bg-muted/60 p-3 text-[12px] leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">{s.skill_md}</pre>
      </div>
      {s.versoes?.length > 1 && (
        <p className={texto.auxiliar}>Histórico: {s.versoes.map((v) => `v${v.versao} (${haQuanto(v.criado_em)})`).join(" · ")}</p>
      )}
    </div>
  );
}

function AbaSkills({ podeEscrever }: { podeEscrever: boolean }) {
  const qc = useQueryClient();
  const [arquivadas, setArquivadas] = useState(false);
  const q = useQuery({ queryKey: ["central-manifesto", arquivadas], queryFn: () => lerManifesto(arquivadas), staleTime: 30_000 });
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useEstadoDaTela<string>("central-skills:categoria", "", { validar: (v) => typeof v === "string" });
  const [aberta, setAberta] = useState<string | null>(null);
  const [mostrar, setMostrar] = useState(120);

  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of q.data?.skills ?? []) c[s.categoria] = (c[s.categoria] ?? 0) + 1;
    return c;
  }, [q.data]);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (q.data?.skills ?? []).filter((s: SkillDaCentral) =>
      (!categoria || s.categoria === categoria)
      && (!b || `${s.slug} ${s.nome} ${s.descricao}`.toLowerCase().includes(b)));
  }, [q.data, busca, categoria]);

  if (q.isLoading) return <Carregando forma="lista" rotulo="Lendo a Central" />;
  if (q.error) return <EstadoDeErro descricao={(q.error as Error).message} acao={<button className={botao.secundario} onClick={() => q.refetch()}>Tentar de novo</button>} />;
  const cats = q.data!.categorias;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="min-w-0 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input className={juntar(campo, "pl-9")} placeholder={`Buscar entre ${q.data!.skills.length} skills`} value={busca} onChange={(e) => { setBusca(e.target.value); setMostrar(120); }} aria-label="Buscar skill" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setCategoria("")} className={juntar(etiqueta, "h-7 px-3", !categoria ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>Todas · {q.data!.skills.length}</button>
          {Object.entries(cats).filter(([k]) => contagem[k]).map(([k, rotulo]) => (
            <button key={k} type="button" onClick={() => setCategoria(k)} className={juntar(etiqueta, "h-7 px-3", categoria === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{rotulo} · {contagem[k]}</button>
          ))}
        </div>
        <label className={juntar(texto.auxiliar, "flex items-center gap-2")}>
          <input type="checkbox" checked={arquivadas} onChange={(e) => setArquivadas(e.target.checked)} /> Mostrar arquivadas
        </label>
        {lista.length === 0 ? (
          <EstadoVazio titulo="Nenhuma skill aqui" descricao="A Central enche quando a primeira máquina sincroniza (aba Instalar)." />
        ) : (
          <ul className={juntar(superficie.painel, "divide-y divide-border overflow-hidden")}>
            {lista.slice(0, mostrar).map((s) => (
              <li key={s.slug}>
                <button
                  type="button"
                  onClick={() => setAberta(s.slug)}
                  className={juntar("w-full px-4 py-3 text-left transition-colors hover:bg-muted/50", aberta === s.slug && "bg-muted/60")}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-[13px] font-medium text-foreground">{s.nome}</span>
                    <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>v{s.versao}</span>
                    {s.status === "arquivada" && <span className={juntar(etiqueta, "bg-destructive/10 text-destructive")}>arquivada</span>}
                    <span className={juntar(texto.auxiliar, "ml-auto shrink-0")}>{cats[s.categoria] ?? s.categoria}</span>
                  </div>
                  {s.descricao && <p className={juntar(texto.auxiliar, "mt-0.5 line-clamp-2")}>{s.descricao}</p>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {lista.length > mostrar && (
          <button type="button" className={juntar(botao.secundario, "w-full")} onClick={() => setMostrar((m) => m + 120)}>
            Mostrar mais ({lista.length - mostrar})
          </button>
        )}
      </div>
      <div className={juntar(superficie.painel, "min-w-0 p-4 lg:sticky lg:top-4 lg:self-start")}>
        {aberta
          ? <DetalheDaSkill slug={aberta} podeEscrever={podeEscrever} aoMudar={() => qc.invalidateQueries({ queryKey: ["central-manifesto"] })} />
          : <EstadoVazio icone={<FileText className="h-5 w-5" />} titulo="Escolha uma skill" descricao="Veja o SKILL.md, de onde ela veio, as versões e baixe o pacote completo." />}
      </div>
    </div>
  );
}

// ─── Conectores ──────────────────────────────────────────────

function AbaConectores() {
  const q = useQuery({ queryKey: ["central-manifesto", false], queryFn: () => lerManifesto(false), staleTime: 30_000 });
  if (q.isLoading) return <Carregando forma="lista" />;
  if (q.error) return <EstadoDeErro descricao={(q.error as Error).message} />;
  const grupos: Array<[string, string]> = [["composio", "Composio"], ["mcp", "Servidores MCP"], ["plugin", "Plugins do Claude Code"]];
  const todos = q.data!.conectores;
  if (!todos.length) return <EstadoVazio titulo="Nenhum conector ainda" descricao="Os plugins e servidores MCP de cada máquina entram aqui na primeira sincronização (só o nome e como instalar; chave nunca)." />;
  return (
    <div className="space-y-6">
      {grupos.map(([tipo, rotulo]) => {
        const lista = todos.filter((c) => c.tipo === tipo);
        if (!lista.length) return null;
        return (
          <Secao key={tipo} titulo={`${rotulo} · ${lista.length}`}>
            <div className="grid gap-3 md:grid-cols-2">
              {lista.map((c) => (
                <div key={c.slug} className={juntar(superficie.painel, "min-w-0 space-y-2 p-4")}>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium">{c.nome}</span>
                    {c.skills.length > 0 && <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>{c.skills.length} skills</span>}
                  </div>
                  {c.descricao && <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")}>{c.descricao}</p>}
                  {Object.entries(c.instalar).map(([onde, cmd]) => <Comando key={onde} titulo={onde === "claude" ? "No Claude Code" : onde === "geral" ? "Qualquer cliente MCP" : onde} valor={cmd} />)}
                  {c.requer.length > 0 && <p className={texto.auxiliar}>Precisa das variáveis: {c.requer.join(", ")} (o valor fica em cada máquina).</p>}
                </div>
              ))}
            </div>
          </Secao>
        );
      })}
    </div>
  );
}

// ─── Instalar ────────────────────────────────────────────────

function AbaInstalar() {
  const m = useQuery({ queryKey: ["central-manifesto", false], queryFn: () => lerManifesto(false), staleTime: 30_000 });
  const maq = useQuery({ queryKey: ["central-maquinas"], queryFn: lerMaquinas, refetchInterval: 60_000 });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Secao titulo="Instalar em qualquer máquina" descricao="Um comando por máquina. Instala todas as skills em todos os agentes dela (Claude Code, Codex, Hermes, ~/.agents), sobe as que só existem ali e deixa tudo sincronizando sozinho a cada 30 min e no início de cada sessão.">
        {m.data ? (
          <div className="space-y-4">
            <Comando titulo="Windows (PowerShell)" valor={m.data.instalar.windows} />
            <Comando titulo="Linux e macOS (VPS do Hermes, Mac)" valor={m.data.instalar.linux_mac} />
            <Comando titulo="Sincronizar agora (depois de criar ou mudar skill)" valor={m.data.instalar.sincronizar_agora} />
            <p className={texto.auxiliar}>A chave é uma credencial MCP com memory:read e memory:write (API › Conectar › Gerar acesso completo). Ela fica só na variável ACELERIQ_CENTRAL_TOKEN da máquina.</p>
            <p className={texto.auxiliar}>Agente sem terminal (ChatGPT, Claude.ai): pelo MCP, aceleriq_central_skills lista e aceleriq_central_skill traz o SKILL.md para seguir na hora.</p>
          </div>
        ) : m.isLoading ? <Carregando /> : <EstadoDeErro descricao={(m.error as Error)?.message} />}
      </Secao>
      <Secao titulo="Máquinas sincronizadas">
        {maq.isLoading ? <Carregando forma="lista" /> : !maq.data?.length ? (
          <EstadoVazio titulo="Nenhuma máquina ainda" descricao="Aparece aqui assim que o comando rodar em alguma máquina." />
        ) : (
          <ul className={juntar(superficie.painel, "divide-y divide-border")}>
            {maq.data.map((x) => (
              <li key={`${x.maquina}-${x.agente}`} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 truncate text-[13px] font-medium">{x.maquina}</span>
                <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>{ROTULO_DO_AGENTE[x.agente] ?? x.agente}</span>
                <span className={juntar(texto.auxiliar, "ml-auto shrink-0")}>{x.instaladas} skills · {haQuanto(x.ultima_sync)}</span>
              </li>
            ))}
          </ul>
        )}
      </Secao>
    </div>
  );
}

// ─── Segundo cérebro ─────────────────────────────────────────

const RAIZES = ["obsidian-vault/", "memory/", "memory/inbox/", "docs/", "work/"];

function AbaCerebro({ podeEscrever }: { podeEscrever: boolean }) {
  const [prefixo, setPrefixo] = useEstadoDaTela<string>("central-skills:cerebro", "obsidian-vault/", { validar: (v) => typeof v === "string" });
  const [filtro, setFiltro] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [novoCaminho, setNovoCaminho] = useState("");
  const arvore = useQuery({ queryKey: ["cerebro-arvore", prefixo], queryFn: () => lerArvore(prefixo), staleTime: 20_000 });
  const arquivo = useQuery({ queryKey: ["cerebro-arquivo", aberto], queryFn: () => lerArquivo(aberto!), enabled: !!aberto });

  const arquivos = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return (arvore.data?.entries ?? []).filter((e) => e.type === "file" && (!f || e.path.toLowerCase().includes(f))).slice(0, 150);
  }, [arvore.data, filtro]);

  const abrir = (p: string) => { setAberto(p); setRascunho(null); };
  const salvar = async () => {
    if (!aberto || rascunho === null) return;
    setSalvando(true);
    try {
      await salvarArquivo(aberto, rascunho, arquivo.data?.sha ?? null);
      toast.success("Salvo no segundo cérebro (commit feito).");
      setRascunho(null);
      await arquivo.refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setSalvando(false); }
  };
  const criar = async () => {
    const p = novoCaminho.trim();
    if (!p) return;
    try {
      await salvarArquivo(p, `# ${p.split("/").pop()?.replace(/\.md$/, "")}\n\n`, null, "nova nota pelo painel");
      toast.success("Nota criada.");
      setNovoCaminho("");
      await arvore.refetch();
      abrir(p);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {RAIZES.map((r) => (
            <button key={r} type="button" onClick={() => setPrefixo(r)} className={juntar(etiqueta, "h-7 px-3", prefixo === r ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{r}</button>
          ))}
        </div>
        <input className={campo} placeholder="Filtrar arquivos" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar arquivos do segundo cérebro" />
        {podeEscrever && (
          <div className="flex gap-2">
            <input className={campo} placeholder="obsidian-vault/10-Notas/nova.md" value={novoCaminho} onChange={(e) => setNovoCaminho(e.target.value)} aria-label="Caminho da nova nota" />
            <button type="button" className={juntar(botao.secundario, "shrink-0")} onClick={criar}>Criar</button>
          </div>
        )}
        {arvore.isLoading ? <Carregando forma="lista" /> : arvore.error ? <EstadoDeErro descricao={(arvore.error as Error).message} /> : (
          <ul className={juntar(superficie.painel, "max-h-[60vh] divide-y divide-border overflow-auto")}>
            {arquivos.map((e) => (
              <li key={e.path}>
                <button type="button" onClick={() => abrir(e.path)} className={juntar("flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-muted/50", aberto === e.path && "bg-muted/60")}>
                  <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 truncate">{e.path.slice(prefixo.length) || e.path}</span>
                  <span className={juntar(texto.auxiliar, "ml-auto shrink-0")}>{tamanho(e.size)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={juntar(superficie.painel, "min-w-0 space-y-3 p-4")}>
        {!aberto ? (
          <EstadoVazio icone={<Brain className="h-5 w-5" />} titulo="Escolha um arquivo" descricao="Os agentes leem e editam este mesmo segundo cérebro pelo MCP, em tempo real. Cada gravação vira um commit." />
        ) : arquivo.isLoading ? <Carregando /> : arquivo.error ? <EstadoDeErro descricao={(arquivo.error as Error).message} /> : (
          <>
            <div className="flex items-center gap-2">
              <p className="min-w-0 truncate text-[13px] font-medium">{aberto}</p>
              {podeEscrever && (
                <button type="button" className={juntar(botao.primario, "ml-auto h-8 shrink-0")} onClick={salvar} disabled={salvando || rascunho === null}>
                  {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                  Salvar
                </button>
              )}
            </div>
            {arquivo.data?.truncated ? (
              <p className={texto.auxiliar}>Arquivo grande demais para abrir aqui.</p>
            ) : (
              <textarea
                className={juntar(campoTexto, "min-h-[60vh] font-mono text-[12.5px]")}
                value={rascunho ?? arquivo.data?.content ?? ""}
                onChange={(e) => setRascunho(e.target.value)}
                readOnly={!podeEscrever}
                aria-label="Conteúdo do arquivo"
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function CentralDeSkills() {
  const { profile } = useAuth();
  const podeEscrever = profile?.role === "admin" || profile?.role === "manager";
  const [aba, setAba] = useEstadoDaTela<Aba>("central-skills:aba", "skills", { validar: (v) => ABAS.some((a) => a.id === v) });
  return (
    <div className="space-y-6">
      <CabecalhoDePagina
        titulo="Skills e cérebro"
        descricao="Todas as skills de todos os agentes (Claude Code, Codex, Hermes, plugins e as da casa) num lugar só, os conectores, como instalar em qualquer máquina e o segundo cérebro para ler e editar."
      />
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {ABAS.map(({ id, rotulo, icone: Icone }) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} onClick={() => setAba(id)} className={juntar(aba === id ? botao.primario : botao.secundario, "h-9")}>
            <Icone className="mr-1.5 h-4 w-4" aria-hidden="true" />{rotulo}
          </button>
        ))}
      </div>
      {aba === "skills" && <AbaSkills podeEscrever={podeEscrever} />}
      {aba === "conectores" && <AbaConectores />}
      {aba === "instalar" && <AbaInstalar />}
      {aba === "cerebro" && <AbaCerebro podeEscrever={podeEscrever} />}
    </div>
  );
}
