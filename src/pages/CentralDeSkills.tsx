import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Brain, Check, Copy, Download, FilePlus2, FileText, Layers, Loader2, Plug, RotateCcw, Save, Sparkles, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Card, Chip, EmptyState, OverflowMenu, PageHeader, PillTabs, SearchField, Toolbar } from "@/components/ds";
import { Carregando, EstadoDeErro, JanelaCentral, SeletorCompacto, botao, campo, campoTexto, foco, juntar, superficie, texto, useEstadoDaTela } from "@/components/sistema";
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
 * em tempo real".
 *
 * Redesenho de 19/11/2026. Dono: "tem que ser skills separado para cada área,
 * escolher individual, porque são muitas; senão fica rolando a página inteira".
 * A área é a `categoria` que a própria Central já grava em cada skill
 * (CATEGORIAS em supabase/functions/central-skills/modulos/nucleo.ts, decidida
 * no servidor por pasta e por nome): a tela não inventa área. A lista mostra só
 * a área escolhida (guardada por pessoa); a busca procura em todas. O detalhe da
 * skill e o arquivo do segundo cérebro abrem na JanelaCentral.
 */

type Aba = "skills" | "conectores" | "instalar" | "cerebro";
const ABAS: Array<{ id: Aba; rotulo: string; icone: typeof Sparkles }> = [
  { id: "skills", rotulo: "Skills", icone: Sparkles },
  { id: "cerebro", rotulo: "Segundo cérebro", icone: Brain },
  { id: "conectores", rotulo: "Conectores", icone: Plug },
  { id: "instalar", rotulo: "Instalar", icone: Terminal },
];

/** Quantas skills a grade mostra antes do "Mostrar mais". */
const PAGINA = 60;

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
      className={juntar(botao.secundario, "h-8 shrink-0")}
      onClick={() => { void navigator.clipboard.writeText(valor); setOk(true); setTimeout(() => setOk(false), 1500); }}
    >
      {ok ? <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
      {ok ? "Copiado" : rotulo}
    </button>
  );
}

function Comando({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex min-w-0 items-center justify-between">
        <p className={juntar(texto.rotulo, "mr-2 min-w-0 truncate")}>{titulo}</p>
        <BotaoCopiar valor={valor} />
      </div>
      <pre className={juntar(superficie.poco, "overflow-x-auto p-3 text-[12px] leading-5 text-foreground [overflow-wrap:anywhere] whitespace-pre-wrap")}>{valor}</pre>
    </div>
  );
}

// ─── Skills ──────────────────────────────────────────────────

function DetalheDaSkill({ resumo, podeEscrever, aoFechar, aoMudar }: { resumo: SkillDaCentral; podeEscrever: boolean; aoFechar: () => void; aoMudar: () => void }) {
  const q = useQuery({ queryKey: ["central-skill", resumo.slug], queryFn: () => lerSkill(resumo.slug) });
  const [baixando, setBaixando] = useState(false);
  const s = q.data;
  const baixar = async () => {
    setBaixando(true);
    try {
      const url = await linkDoPacote(resumo.slug);
      if (url) window.open(url, "_blank", "noopener");
      else toast.error("Esta skill não tem pacote; copie o SKILL.md.");
    } catch (e) { toast.error((e as Error).message); } finally { setBaixando(false); }
  };
  const status = async (novo: "ativa" | "arquivada") => {
    try { await mudarStatus(resumo.slug, novo); toast.success(novo === "arquivada" ? "Arquivada: sai das próximas sincronizações." : "Restaurada."); aoMudar(); q.refetch(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const atual = s ?? resumo;
  return (
    <JanelaCentral
      aberta
      onFechar={aoFechar}
      titulo={atual.nome}
      icone={<Sparkles className="h-4 w-4" />}
      descricao={`v${atual.versao} · ${atual.arquivos} ${atual.arquivos === 1 ? "arquivo" : "arquivos"} · ${tamanho(atual.tamanho_bytes)} · ${haQuanto(atual.atualizado_em)}`}
      largura="lg"
      acoes={podeEscrever ? (
        <OverflowMenu
          items={[
            atual.status === "ativa"
              ? { label: "Arquivar", icon: <Archive className="h-4 w-4" />, onSelect: () => void status("arquivada"), danger: true }
              : { label: "Restaurar", icon: <RotateCcw className="h-4 w-4" />, onSelect: () => void status("ativa") },
          ]}
        />
      ) : undefined}
      rodape={
        <div className="flex min-w-0 flex-wrap items-center justify-end [&>*]:my-0.5 [&>*+*]:ml-2">
          {s && <BotaoCopiar valor={s.skill_md} rotulo="Copiar SKILL.md" />}
          <button type="button" className={juntar(botao.primario, "h-8")} onClick={baixar} disabled={baixando}>
            {baixando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            Baixar pacote
          </button>
        </div>
      }
    >
      <div className="min-w-0 space-y-5" data-detalhe-da-skill={resumo.slug}>
        {atual.descricao && <p className={texto.corpo}>{atual.descricao}</p>}
        <div className="-m-0.5 flex min-w-0 flex-wrap">
          <Chip className="m-0.5" outline>{resumo.slug}</Chip>
          {atual.runtimes.map((r) => <Chip key={r} className="m-0.5">{ROTULO_DO_AGENTE[r] ?? r}</Chip>)}
          {atual.plugin && <Chip className="m-0.5" tone="accent">plugin {atual.plugin}</Chip>}
          {atual.status === "arquivada" && <Chip className="m-0.5" tone="danger" dot>Arquivada</Chip>}
        </div>
        {q.isLoading ? <Carregando forma="lista" linhas={4} rotulo="Abrindo a skill" /> : q.error || !s ? (
          <EstadoDeErro descricao={(q.error as Error)?.message} acao={<button type="button" className={botao.secundario} onClick={() => q.refetch()}>Tentar de novo</button>} />
        ) : (
          <>
            {s.origens?.length > 0 && (
              <div className="min-w-0 space-y-1.5">
                <p className={texto.rotulo}>Onde foi encontrada</p>
                <ul className="min-w-0 divide-y divide-border/60">
                  {s.origens.slice(0, 8).map((o, i) => (
                    <li key={i} className={juntar(texto.auxiliar, "flex min-w-0 items-center py-2")}>
                      <span className="mr-2 shrink-0 font-medium text-foreground">{ROTULO_DO_AGENTE[o.runtime] ?? o.runtime}</span>
                      <span className="min-w-0 truncate" title={o.caminho}>{o.maquina ? `${o.maquina} · ` : ""}{o.caminho}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="min-w-0 space-y-1.5">
              <p className={texto.rotulo}>SKILL.md</p>
              <pre className={juntar(superficie.poco, "p-3 text-[12px] leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]")}>{s.skill_md}</pre>
            </div>
            {s.versoes?.length > 1 && (
              <p className={juntar(texto.auxiliar, "tabular-nums")}>Histórico: {s.versoes.map((v) => `v${v.versao} (${haQuanto(v.criado_em)})`).join(" · ")}</p>
            )}
          </>
        )}
      </div>
    </JanelaCentral>
  );
}

function CartaoDaSkill({ s, area, aoAbrir }: { s: SkillDaCentral; area?: string; aoAbrir: () => void }) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={aoAbrir}
        data-skill={s.slug}
        className={juntar(
          superficie.painel,
          foco,
          "flex h-full w-full min-w-0 flex-col p-4 text-left transition-colors hover:border-foreground/20 hover:bg-muted/30",
          s.status === "arquivada" && "opacity-60",
        )}
      >
        <span className="flex min-w-0 items-center">
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-5 text-foreground">{s.nome}</span>
          <span className={juntar(texto.etiqueta, "ml-2 shrink-0 tabular-nums text-muted-foreground")}>v{s.versao}</span>
        </span>
        <span className={juntar(texto.auxiliar, "mt-1 line-clamp-2 min-h-[32px] leading-4")}>{s.descricao || s.slug}</span>
        <span className="mt-3 flex min-w-0 flex-wrap items-center [&>*]:mb-0.5 [&>*]:mr-1">
          {area && <Chip tone="accent">{area}</Chip>}
          {s.runtimes.slice(0, 2).map((r) => <Chip key={r}>{ROTULO_DO_AGENTE[r] ?? r}</Chip>)}
          {s.runtimes.length > 2 && <Chip>+{s.runtimes.length - 2}</Chip>}
          {s.status === "arquivada" && <Chip tone="danger">Arquivada</Chip>}
        </span>
      </button>
    </li>
  );
}

function AbaSkills({ podeEscrever }: { podeEscrever: boolean }) {
  const qc = useQueryClient();
  const [arquivadas, setArquivadas] = useEstadoDaTela<boolean>("central-skills:arquivadas", false, { validar: (v) => typeof v === "boolean" });
  const q = useQuery({ queryKey: ["central-manifesto", arquivadas], queryFn: () => lerManifesto(arquivadas), staleTime: 30_000 });
  const [busca, setBusca] = useState("");
  const [areaGuardada, setArea] = useEstadoDaTela<string>("central-skills:area", "", { validar: (v) => typeof v === "string" });
  const [aberta, setAberta] = useState<SkillDaCentral | null>(null);
  const [mostrar, setMostrar] = useState(PAGINA);

  const skills = q.data?.skills ?? [];
  const cats = q.data?.categorias ?? {};
  const contagem = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of skills) c[s.categoria] = (c[s.categoria] ?? 0) + 1;
    return c;
  }, [skills]);
  // As áreas na ordem da Central, só as que têm skill; uma área que só existe na skill (fora da lista) entra no fim.
  const areas = useMemo(() => {
    const ordem = Object.keys(cats).filter((k) => contagem[k]);
    for (const k of Object.keys(contagem)) if (ordem.indexOf(k) < 0) ordem.push(k);
    return ordem;
  }, [cats, contagem]);
  const area = areas.indexOf(areaGuardada) >= 0 ? areaGuardada : areas[0] ?? "";
  const rotuloDaArea = (k: string) => cats[k] ?? k;

  const b = busca.trim().toLowerCase();
  const lista = useMemo(() => skills.filter((s) =>
    b ? `${s.slug} ${s.nome} ${s.descricao} ${(s.tags || []).join(" ")}`.toLowerCase().indexOf(b) >= 0 : s.categoria === area,
  ), [skills, b, area]);

  if (q.isLoading) return <Carregando forma="grade" rotulo="Lendo a Central" />;
  if (q.error) return <EstadoDeErro descricao={(q.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => q.refetch()}>Tentar de novo</button>} />;

  return (
    <div className="min-w-0 space-y-5" data-area-das-skills={b ? "busca" : area}>
      <Toolbar
        label="Skills"
        search={<SearchField value={busca} onChange={(v) => { setBusca(v); setMostrar(PAGINA); }} placeholder={`Buscar entre ${skills.length} skills`} label="Buscar skill em todas as áreas" />}
        filters={areas.length > 0 ? (
          <SeletorCompacto
            rotulo="Área"
            icone={<Layers className="h-4 w-4" />}
            valor={area}
            onEscolher={(v) => { setArea(v); setBusca(""); setMostrar(PAGINA); }}
            opcoes={areas.map((k) => ({ valor: k, rotulo: rotuloDaArea(k), contador: contagem[k] }))}
          />
        ) : undefined}
        actions={
          <OverflowMenu
            items={[{ label: arquivadas ? "Esconder arquivadas" : "Mostrar arquivadas", icon: <Archive className="h-4 w-4" />, onSelect: () => setArquivadas(!arquivadas) }]}
          />
        }
      />

      <div className="flex min-w-0 items-baseline">
        <h2 className={juntar(texto.tituloSecao, "min-w-0 truncate")}>{b ? "Resultado da busca" : rotuloDaArea(area)}</h2>
        <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>{lista.length} {lista.length === 1 ? "skill" : "skills"}{b ? " em todas as áreas" : ""}</span>
      </div>

      {lista.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title={b ? "Nenhuma skill com essa busca" : "Nenhuma skill aqui"}
          description={b ? undefined : "A Central enche na primeira sincronização."}
        />
      ) : (
        <ul className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3 desk:grid-cols-4">
          {lista.slice(0, mostrar).map((s) => (
            <CartaoDaSkill key={s.slug} s={s} area={b ? rotuloDaArea(s.categoria) : undefined} aoAbrir={() => setAberta(s)} />
          ))}
        </ul>
      )}
      {lista.length > mostrar && (
        <div className="flex justify-center">
          <button type="button" className={botao.secundario} onClick={() => setMostrar((m) => m + PAGINA)}>
            Mostrar mais ({lista.length - mostrar})
          </button>
        </div>
      )}

      {aberta && (
        <DetalheDaSkill
          key={aberta.slug}
          resumo={aberta}
          podeEscrever={podeEscrever}
          aoFechar={() => setAberta(null)}
          aoMudar={() => qc.invalidateQueries({ queryKey: ["central-manifesto"] })}
        />
      )}
    </div>
  );
}

// ─── Conectores ──────────────────────────────────────────────

function AbaConectores() {
  const q = useQuery({ queryKey: ["central-manifesto", false], queryFn: () => lerManifesto(false), staleTime: 30_000 });
  const [tipo, setTipo] = useEstadoDaTela<string>("central-skills:conectores", "composio", { validar: (v) => typeof v === "string" });
  if (q.isLoading) return <Carregando forma="grade" />;
  if (q.error) return <EstadoDeErro descricao={(q.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => q.refetch()}>Tentar de novo</button>} />;
  const grupos: Array<[string, string]> = [["composio", "Composio"], ["mcp", "Servidores MCP"], ["plugin", "Plugins do Claude Code"]];
  const todos = q.data!.conectores;
  if (!todos.length) return <EmptyState icon={<Plug className="h-5 w-5" />} title="Nenhum conector ainda" description="Entram na primeira sincronização." />;
  const comItens = grupos.filter(([t]) => todos.some((c) => c.tipo === t));
  const atual = comItens.some(([t]) => t === tipo) ? tipo : comItens[0][0];
  const lista = todos.filter((c) => c.tipo === atual);
  return (
    <div className="min-w-0 space-y-5">
      <PillTabs
        label="Tipo de conector"
        variant="soft"
        value={atual}
        onChange={setTipo}
        tabs={comItens.map(([t, rotulo]) => ({ value: t, label: rotulo, count: todos.filter((c) => c.tipo === t).length }))}
      />
      <ul className="grid min-w-0 gap-3 md:grid-cols-2 desk:grid-cols-3">
        {lista.map((c) => (
          <li key={c.slug} className={juntar(superficie.painel, "min-w-0 space-y-3 p-4 sm:p-5")}>
            <div className="flex min-w-0 items-center">
              <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{c.nome}</span>
              {c.skills.length > 0 && <Chip className="ml-2">{c.skills.length} skills</Chip>}
            </div>
            {c.descricao && <p className={juntar(texto.auxiliar, "line-clamp-2 [overflow-wrap:anywhere]")}>{c.descricao}</p>}
            {Object.entries(c.instalar).map(([onde, cmd]) => <Comando key={onde} titulo={onde === "claude" ? "No Claude Code" : onde === "geral" ? "Qualquer cliente MCP" : onde} valor={cmd} />)}
            {c.requer.length > 0 && <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")} title="O valor fica em cada máquina.">Variáveis: {c.requer.join(", ")}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Instalar ────────────────────────────────────────────────

function AbaInstalar() {
  const m = useQuery({ queryKey: ["central-manifesto", false], queryFn: () => lerManifesto(false), staleTime: 30_000 });
  const maq = useQuery({ queryKey: ["central-maquinas"], queryFn: lerMaquinas, refetchInterval: 60_000 });
  return (
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
      <Card
        title="Instalar em qualquer máquina"
        icon={<Terminal className="h-4 w-4" />}
        help={
          <>
            Um comando por máquina. Instala todas as skills em todos os agentes dela (Claude Code, Codex, Hermes, ~/.agents), sobe as
            que só existem ali e deixa tudo sincronizando sozinho a cada 30 min e no início de cada sessão. A chave é uma credencial MCP
            com memory:read e memory:write (API, Conectar, Gerar acesso completo) e fica só na variável ACELERIQ_CENTRAL_TOKEN da máquina.
            Agente sem terminal (ChatGPT, Claude.ai): pelo MCP, aceleriq_central_skills lista e aceleriq_central_skill traz o SKILL.md.
          </>
        }
      >
        {m.data ? (
          <div className="min-w-0 space-y-4">
            <Comando titulo="Windows (PowerShell)" valor={m.data.instalar.windows} />
            <Comando titulo="Linux e macOS" valor={m.data.instalar.linux_mac} />
            <Comando titulo="Sincronizar agora" valor={m.data.instalar.sincronizar_agora} />
          </div>
        ) : m.isLoading ? <Carregando forma="lista" linhas={3} /> : (
          <EstadoDeErro descricao={(m.error as Error)?.message} acao={<button type="button" className={botao.secundario} onClick={() => m.refetch()}>Tentar de novo</button>} />
        )}
      </Card>
      <Card
        title="Máquinas sincronizadas"
        icon={<Layers className="h-4 w-4" />}
        subtitle={maq.data?.length ? `${maq.data.length} ${maq.data.length === 1 ? "máquina" : "máquinas"}` : undefined}
      >
        {maq.isLoading ? <Carregando forma="lista" linhas={3} /> : maq.error ? (
          <EstadoDeErro descricao={(maq.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => maq.refetch()}>Tentar de novo</button>} />
        ) : !maq.data?.length ? (
          <EmptyState compact title="Nenhuma máquina ainda" description="Aparece assim que o comando rodar." />
        ) : (
          <ul className="-mx-2 min-w-0 divide-y divide-border/60">
            {maq.data.map((x) => (
              <li key={`${x.maquina}-${x.agente}`} className="flex min-w-0 items-center rounded-md px-2 py-2.5 hover:bg-muted/40">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{x.maquina}</span>
                <Chip className="ml-2">{ROTULO_DO_AGENTE[x.agente] ?? x.agente}</Chip>
                <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>{x.instaladas} · {haQuanto(x.ultima_sync)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ─── Segundo cérebro ─────────────────────────────────────────

const RAIZES = ["obsidian-vault/", "memory/", "memory/inbox/", "docs/", "work/"];

function ArquivoDoCerebro({ caminho, podeEscrever, aoFechar }: { caminho: string; podeEscrever: boolean; aoFechar: () => void }) {
  const arquivo = useQuery({ queryKey: ["cerebro-arquivo", caminho], queryFn: () => lerArquivo(caminho) });
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    if (rascunho === null) return;
    setSalvando(true);
    try {
      await salvarArquivo(caminho, rascunho, arquivo.data?.sha ?? null);
      toast.success("Salvo no segundo cérebro (commit feito).");
      setRascunho(null);
      await arquivo.refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setSalvando(false); }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={aoFechar}
      titulo={caminho.split("/").pop() || caminho}
      icone={<FileText className="h-4 w-4" />}
      descricao={arquivo.data ? `${caminho} · ${tamanho(arquivo.data.size)}${rascunho !== null ? " · não salvo" : ""}` : caminho}
      largura="xl"
      corpo="fixo"
      rodape={podeEscrever ? (
        <div className="flex justify-end">
          <button type="button" className={juntar(botao.primario, "h-8")} onClick={salvar} disabled={salvando || rascunho === null}>
            {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            Salvar
          </button>
        </div>
      ) : undefined}
    >
      {arquivo.isLoading ? <Carregando forma="lista" linhas={6} /> : arquivo.error ? (
        <EstadoDeErro descricao={(arquivo.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => arquivo.refetch()}>Tentar de novo</button>} />
      ) : arquivo.data?.truncated ? (
        <EmptyState compact title="Arquivo grande demais para abrir aqui" />
      ) : (
        <textarea
          className={juntar(campoTexto, "min-h-[240px] w-full flex-1 resize-none font-mono text-[12px] leading-5")}
          value={rascunho ?? arquivo.data?.content ?? ""}
          onChange={(e) => setRascunho(e.target.value)}
          readOnly={!podeEscrever}
          aria-label="Conteúdo do arquivo"
        />
      )}
    </JanelaCentral>
  );
}

function AbaCerebro({ podeEscrever }: { podeEscrever: boolean }) {
  const [prefixo, setPrefixo] = useEstadoDaTela<string>("central-skills:cerebro", "obsidian-vault/", { validar: (v) => typeof v === "string" && RAIZES.indexOf(v) >= 0 });
  const [filtro, setFiltro] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [novoCaminho, setNovoCaminho] = useState("");
  const arvore = useQuery({ queryKey: ["cerebro-arvore", prefixo], queryFn: () => lerArvore(prefixo), staleTime: 20_000 });

  const todos = useMemo(() => (arvore.data?.entries ?? []).filter((e) => e.type === "file"), [arvore.data]);
  const arquivos = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return todos.filter((e) => !f || e.path.toLowerCase().indexOf(f) >= 0).slice(0, 150);
  }, [todos, filtro]);

  const criar = async () => {
    const p = novoCaminho.trim();
    if (!p) return;
    try {
      await salvarArquivo(p, `# ${p.split("/").pop()?.replace(/\.md$/, "")}\n\n`, null, "nova nota pelo painel");
      toast.success("Nota criada.");
      setNovoCaminho("");
      setCriando(false);
      await arvore.refetch();
      setAberto(p);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="min-w-0 space-y-5">
      <Toolbar
        label="Segundo cérebro"
        search={<SearchField value={filtro} onChange={setFiltro} placeholder="Filtrar arquivos" label="Filtrar arquivos do segundo cérebro" />}
        filters={
          <SeletorCompacto
            rotulo="Pasta"
            icone={<Brain className="h-4 w-4" />}
            valor={prefixo}
            onEscolher={(v) => { setPrefixo(v); setFiltro(""); }}
            opcoes={RAIZES.map((r) => ({ valor: r, rotulo: r }))}
          />
        }
        actions={podeEscrever ? (
          <button type="button" className={juntar(botao.secundario, "h-9")} onClick={() => setCriando(true)}>
            <FilePlus2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Nova nota
          </button>
        ) : undefined}
      />

      <div className="flex min-w-0 items-baseline">
        <h2 className={juntar(texto.tituloSecao, "min-w-0 truncate")}>{prefixo}</h2>
        {arvore.data && <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>{arquivos.length < todos.length ? `${arquivos.length} de ${todos.length}` : todos.length} arquivos</span>}
      </div>

      {arvore.isLoading ? <Carregando forma="lista" /> : arvore.error ? (
        <EstadoDeErro descricao={(arvore.error as Error).message} acao={<button type="button" className={botao.secundario} onClick={() => arvore.refetch()}>Tentar de novo</button>} />
      ) : arquivos.length === 0 ? (
        <EmptyState icon={<Brain className="h-5 w-5" />} title={filtro ? "Nenhum arquivo com esse filtro" : "Pasta vazia"} />
      ) : (
        <ul className={juntar(superficie.painel, "grid min-w-0 gap-x-4 p-2 sm:grid-cols-2 sm:p-3 xl:grid-cols-3")}>
          {arquivos.map((e) => (
            <li key={e.path} className="min-w-0">
              <button type="button" onClick={() => setAberto(e.path)} className={juntar(foco, "flex w-full min-w-0 items-center rounded-md px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted/50")}>
                <FileText className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate" title={e.path}>{e.path.slice(prefixo.length) || e.path}</span>
                <span className={juntar(texto.etiqueta, "ml-2 shrink-0 tabular-nums text-muted-foreground")}>{tamanho(e.size)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {aberto && <ArquivoDoCerebro key={aberto} caminho={aberto} podeEscrever={podeEscrever} aoFechar={() => setAberto(null)} />}

      <JanelaCentral
        aberta={criando}
        onFechar={() => setCriando(false)}
        titulo="Nova nota"
        icone={<FilePlus2 className="h-4 w-4" />}
        largura="sm"
        rodape={
          <div className="flex justify-end">
            <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => void criar()} disabled={!novoCaminho.trim()}>Criar</button>
          </div>
        }
      >
        <label className="block min-w-0 space-y-1.5">
          <span className={texto.rotulo}>Caminho</span>
          <input className={campo} placeholder={`${prefixo}nova.md`} value={novoCaminho} onChange={(e) => setNovoCaminho(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void criar(); }} aria-label="Caminho da nova nota" />
        </label>
      </JanelaCentral>
    </div>
  );
}

export default function CentralDeSkills() {
  const { profile } = useAuth();
  const podeEscrever = profile?.role === "admin" || profile?.role === "manager";
  const [aba, setAba] = useEstadoDaTela<Aba>("central-skills:aba", "skills", { validar: (v) => ABAS.some((a) => a.id === v) });
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Skills e cérebro"
        help="Todas as skills de todos os agentes (Claude Code, Codex, Hermes, plugins e as da casa) num lugar só, separadas por área. Também os conectores, como instalar em qualquer máquina e o segundo cérebro para ler e editar em tempo real."
        toolbar={
          <PillTabs
            label="Partes da Central"
            value={aba}
            onChange={(v) => setAba(v as Aba)}
            tabs={ABAS.map(({ id, rotulo, icone: Icone }) => ({ value: id, label: rotulo, icon: <Icone className="h-3.5 w-3.5" /> }))}
          />
        }
      />
      {aba === "skills" && <AbaSkills podeEscrever={podeEscrever} />}
      {aba === "conectores" && <AbaConectores />}
      {aba === "instalar" && <AbaInstalar />}
      {aba === "cerebro" && <AbaCerebro podeEscrever={podeEscrever} />}
    </div>
  );
}
