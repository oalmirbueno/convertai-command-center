import { useMemo, useState } from "react";
import { BookmarkCheck, Brush, Check, FlaskConical, FolderOpen, Loader2, Palette, RefreshCw, Save, Send, Shuffle, Sparkles, Star, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Card, Chip, EmptyState, PageHeader, PillTabs } from "@/components/ds";
import { botao, juntar, texto, useEstadoDaTela } from "@/components/sistema";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { useKitDaMarca } from "@/components/mesa/kitDaMesa";
import { textoDoErro } from "@/lib/mesa/api";
import { hexParaOklch, hexValido } from "../../supabase/functions/_shared/cores/oklch";
import { conferir, gerarPropostas, novaAlternativa, recalcular, trocarPapeis, type Briefing, type PapelNaProposta, type Proposta } from "../../supabase/functions/_shared/cores/paleta";
import { nichoPorTexto } from "../../supabase/functions/_shared/cores/nichos";
import {
  aplicarNoKit, apagarProjeto, escreverComIa, marcarAplicada, salvarProjeto, useInvalidarProjetos, useProjetosDeCor,
  type ModoDeEntrada, type ProjetoDeCor, type TextosDaIa,
} from "@/components/atelie-cor/api";
import CartaoDaProposta, { FaixaDaPaleta } from "@/components/atelie-cor/CartaoDaProposta";
import { BRIEFING_VAZIO, EntradaPorBriefing, EntradaPorNicho, MODOS, Questionario, ResumoDoBriefing } from "@/components/atelie-cor/Entrada";
import { CoresVivas, ExtrairDeImagem, Harmonias, SimuladorDeDaltonismo, Tons, VerificadorDeContraste } from "@/components/atelie-cor/Ferramentas";
import Laboratorio from "@/components/atelie-cor/Laboratorio";
import Entrega from "@/components/atelie-cor/Entrega";

/**
 * Ateliê de Cor (/cores, 19/11/2026). Dono: "use o Sacana, aprenda uma vez,
 * coloque tudo o que tem no Sacana na nossa ferramenta e um pouco mais".
 *
 * As cores são do motor (supabase/functions/_shared/cores: OKLCH, WCAG, APCA,
 * 60-30-10 com destaque forte), sem IA e sem limite de geração. A IA só lê o
 * briefing e escreve os porquês e os entregáveis (mesa-identidade
 * cores_ler_briefing / cores_escrever), e o Jev dá nota a cada proposta.
 * "Aplicar no cliente" grava a paleta no kit da marca, que o Estúdio usa.
 */

type Aba = "criar" | "laboratorio" | "ferramentas" | "projetos";

const CHAVE = "atelie-cor";

export default function AtelieDeCor() {
  const { user } = useAuth();
  const clientesQ = useClients();
  const clientes = useMemo(() => ((clientesQ.data || []) as Array<{ id: string; company_name?: string | null }>).map((c) => ({ id: c.id, nome: c.company_name || "Cliente" })).sort((a, b) => a.nome.localeCompare(b.nome)), [clientesQ.data]);
  const [aba, setAba] = useEstadoDaTela<Aba>(`${CHAVE}:aba`, "criar");
  const [modo, setModo] = useEstadoDaTela<ModoDeEntrada>(`${CHAVE}:modo`, "cliente");
  const [clienteId, setClienteId] = useState<string>("");
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [rascunho, setRascunho] = useState<Briefing | null>(null);
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [textos, setTextos] = useState<Partial<TextosDaIa>>({});
  const [projetoId, setProjetoId] = useState<string | null>(null);
  const [rodada, setRodada] = useState(0);
  const [ocupado, setOcupado] = useState<null | "ia" | "salvar" | "aplicar">(null);
  const [entregando, setEntregando] = useState(false);
  const [faltou, setFaltou] = useState<string[]>([]);
  // Kit da marca principal do cliente (contrato marcas-completas: a tela nunca lê o kit cru).
  const kitDaMarca = useKitDaMarca(clienteId, null);
  const kit = { data: kitDaMarca.kit, isLoading: kitDaMarca.isLoading };
  const projetos = useProjetosDeCor();
  const invalidar = useInvalidarProjetos();

  const conferencias = useMemo(() => (briefing && propostas.length ? conferir(propostas, briefing) : []), [briefing, propostas]);
  const escolhidaP = propostas.find((p) => p.id === escolhida) ?? propostas[0] ?? null;
  const nomes = useMemo(() => Object.fromEntries(propostas.map((p) => [p.id, textos.propostas?.[p.id]?.titulo || p.titulo])), [propostas, textos]);
  const nomeDoCliente = clientes.find((c) => c.id === clienteId)?.nome ?? "";

  const gerar = (b: Briefing, v = 0) => {
    const r = gerarPropostas(b, v);
    setBriefing(b);
    setPropostas(r.propostas);
    setEscolhida(r.propostas[0]?.id ?? null);
    setTextos({});
    setRodada(v);
    setAba("criar");
  };

  /** Rascunho do briefing a partir do cliente: nome e a cor primária do kit, se houver. */
  const briefingDoCliente = (): Briefing => {
    const paleta = (kit.data as { paleta?: Array<{ hex: string; papel: string }> } | null)?.paleta ?? [];
    const primaria = paleta.find((c) => c.papel === "primaria") ?? paleta.find((c) => hexValido(c.hex) && hexParaOklch(c.hex).c > 0.03);
    return { ...BRIEFING_VAZIO, marca: nomeDoCliente, corPrincipal: hexValido(primaria?.hex) };
  };

  const recomecar = () => {
    setBriefing(null); setPropostas([]); setTextos({}); setProjetoId(null); setRascunho(null); setFaltou([]);
  };

  const trocarCor = (id: string, papel: PapelNaProposta, hex: string) => {
    if (!briefing) return;
    setPropostas((ps) => ps.map((p) => (p.id === id ? recalcular(p, briefing, { [papel]: hex }) : p)));
  };

  const escrever = async () => {
    if (!briefing || !propostas.length) return;
    if (!clienteId) { toast.error("Escolha o cliente no topo: os textos com IA saem da carteira dele."); return; }
    setOcupado("ia");
    try {
      const r = await escreverComIa(clienteId, briefing, propostas, escolhida);
      setTextos(r.textos);
      if (r.aviso_jev) toast.message(r.aviso_jev);
      else toast.success("Textos prontos e nota do Jev em cada proposta.");
    } catch (e) {
      toast.error(textoDoErro(e));
    } finally {
      setOcupado(null);
    }
  };

  const salvar = async (favorita?: boolean) => {
    if (!briefing || !propostas.length) return null;
    setOcupado("salvar");
    try {
      const p = await salvarProjeto({ id: projetoId, client_id: clienteId || null, titulo: `${briefing.marca || "Paleta"}${escolhidaP ? ` · ${nomes[escolhidaP.id]}` : ""}`, modo, briefing, propostas, escolhida, textos, favorita });
      setProjetoId(p.id);
      invalidar();
      toast.success(favorita ? "Guardado nos favoritos" : "Projeto salvo");
      return p;
    } catch (e) {
      toast.error(textoDoErro(e, "Não deu para salvar o projeto."));
      return null;
    } finally {
      setOcupado(null);
    }
  };

  const aplicar = async () => {
    if (!escolhidaP) return;
    if (!clienteId) { toast.error("Escolha o cliente no topo para gravar a paleta no kit da marca."); return; }
    setOcupado("aplicar");
    try {
      await aplicarNoKit(clienteId, escolhidaP, user?.id);
      const p = projetoId ? { id: projetoId } : await salvar();
      if (p?.id) await marcarAplicada(p.id);
      toast.success(`Paleta gravada no kit de ${nomeDoCliente}. O Estúdio já usa nas próximas artes.`);
    } catch (e) {
      toast.error(textoDoErro(e, "Não deu para gravar no kit."));
    } finally {
      setOcupado(null);
    }
  };

  const abrir = (p: ProjetoDeCor) => {
    setClienteId(p.client_id ?? "");
    setModo(p.modo);
    setBriefing(p.briefing);
    setPropostas(p.propostas);
    setEscolhida(p.escolhida);
    setTextos(p.textos || {});
    setProjetoId(p.id);
    setAba("criar");
  };

  const textosDaPrevia = { marca: briefing?.marca || nomeDoCliente || "Sua marca", titulo: briefing?.oferta ? `${briefing.oferta.split(/[.!?]/)[0].slice(0, 54)}` : "Sua marca em *destaque*", sub: briefing?.publico || "Uma linha curta sobre o que a marca entrega.", botao: "Fale conosco" };
  const okConferencias = conferencias.filter((c) => c.ok).length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Criação"
        title="Ateliê de Cor"
        help="Paletas com motivo: dominante (60%), apoio (30%) e um destaque forte só no botão (10%), com contraste conferido pela WCAG 2.2 e pelo APCA e tons em OKLCH. O motor decide as cores sem IA e sem limite; a IA escreve os porquês e o Jev dá a nota contra o briefing. Aplicar no cliente grava a paleta no kit da marca, que o Estúdio usa nas artes."
        actions={
          <select aria-label="Cliente" className="h-9 max-w-[220px] rounded-full border border-border bg-card px-3 text-[13px]" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            <option value="">Sem cliente</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        }
        toolbar={
          <PillTabs label="Área" value={aba} onChange={(v) => setAba(v as Aba)} tabs={[
            { value: "criar", label: "Criar", icon: <Palette className="h-4 w-4" /> },
            { value: "laboratorio", label: "Laboratório", icon: <FlaskConical className="h-4 w-4" />, disabled: !propostas.length },
            { value: "ferramentas", label: "Ferramentas", icon: <Wrench className="h-4 w-4" /> },
            { value: "projetos", label: "Projetos", icon: <FolderOpen className="h-4 w-4" />, count: projetos.data?.length },
          ]} />
        }
      />

      {aba === "criar" && !propostas.length && (
        <div className="space-y-5">
          <PillTabs variant="soft" label="Como começar" value={modo} onChange={(v) => { setModo(v as ModoDeEntrada); setRascunho(null); }} tabs={MODOS} />
          {modo === "cliente" && (
            clienteId ? (
              kit.isLoading ? <Card><Loader2 className="h-5 w-5 animate-spin" /></Card> : <Questionario key={`cli-${clienteId}`} inicial={briefingDoCliente()} onPronto={(b) => gerar(b)} />
            ) : (
              <EmptyState title="Escolha o cliente no topo" description="O nome e a cor da marca vêm do kit do cliente; o resto você completa nas perguntas." />
            )
          )}
          {modo === "briefing" && (
            rascunho ? (
              <div className="space-y-3">
                {faltou.length > 0 && <Card title="O briefing não trouxe" subtitle={faltou.join(" · ")} />}
                <Questionario key="lido" inicial={rascunho} onPronto={(b) => gerar(b)} />
              </div>
            ) : <EntradaPorBriefing clientId={clienteId || null} onLido={(b, f) => { setRascunho({ ...BRIEFING_VAZIO, ...b, marca: b.marca || nomeDoCliente }); setFaltou(f); }} />
          )}
          {modo === "zero" && <Questionario key="zero" inicial={{ ...BRIEFING_VAZIO, marca: nomeDoCliente }} onPronto={(b) => gerar(b)} />}
          {modo === "nicho" && (
            rascunho ? <Questionario key={`n-${rascunho.nicho}`} inicial={rascunho} onPronto={(b) => gerar(b)} /> : <EntradaPorNicho onEscolher={(n, sub) => setRascunho({ ...BRIEFING_VAZIO, marca: nomeDoCliente, nicho: n.nome, subnicho: sub ?? "" })} />
          )}
        </div>
      )}

      {aba === "criar" && propostas.length > 0 && briefing && escolhidaP && (
        <div className="space-y-5">
          <Card
            title={briefing.marca || "Paleta"}
            subtitle={[nichoPorTexto(briefing.nicho)?.nome ?? briefing.nicho, briefing.subnicho].filter(Boolean).join(" · ") || undefined}
            action={<button type="button" className={botao.primario} onClick={() => setEntregando(true)}><Send className="mr-1.5 h-4 w-4" />Entregar</button>}
            menu={[
              { label: "Salvar projeto", icon: <Save className="h-4 w-4" />, onSelect: () => void salvar() },
              { label: "Guardar nos favoritos", icon: <Star className="h-4 w-4" />, onSelect: () => void salvar(true) },
              { label: "Novo conjunto de 3", icon: <Shuffle className="h-4 w-4" />, onSelect: () => gerar(briefing, rodada + 1) },
              { label: "Nova alternativa", icon: <RefreshCw className="h-4 w-4" />, onSelect: () => { const n = novaAlternativa(briefing, propostas, rodada + propostas.length + 1); setPropostas((ps) => [...ps, n]); } },
              { label: "Começar outra paleta", icon: <Brush className="h-4 w-4" />, onSelect: recomecar, separatorBefore: true },
            ]}
          >
            <div className="space-y-4">
              {textos.resumo && <p className={texto.corpo}>{textos.resumo}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={botao.secundario} disabled={ocupado !== null} onClick={() => void escrever()}>
                  {ocupado === "ia" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}{textos.escrito_em ? "Reescrever com IA" : "Escrever com IA"}
                </button>
                <button type="button" className={botao.secundario} disabled={ocupado !== null || !clienteId} title={clienteId ? undefined : "Escolha o cliente no topo"} onClick={() => void aplicar()}>
                  {ocupado === "aplicar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <BookmarkCheck className="mr-1.5 h-4 w-4" />}Aplicar no cliente
                </button>
                <button type="button" className={botao.discreto} disabled={ocupado !== null} onClick={() => void salvar()}>
                  {ocupado === "salvar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}Salvar
                </button>
                <Chip tone={okConferencias === conferencias.length ? "success" : "warning"} dot>{okConferencias}/{conferencias.length} conferências</Chip>
              </div>
              <details className="text-[12px]">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Conferências e briefing</summary>
                <div className="mt-3 grid gap-6 lg:grid-cols-2">
                  <ul className="space-y-2">
                    {conferencias.map((c) => (
                      <li key={c.id} className="flex gap-2">
                        <Check className={juntar("mt-0.5 h-4 w-4 shrink-0", c.ok ? "text-success" : "text-destructive")} />
                        <span><b>{c.titulo}.</b> <span className="text-muted-foreground">{c.detalhe}</span></span>
                      </li>
                    ))}
                    <li className="pt-1 text-muted-foreground">Base técnica: WCAG 2.2 (1.4.3 e 1.4.11), APCA, CSS Color 4 (OKLab/OKLCH) e simulação de daltonismo de Machado (2009).</li>
                  </ul>
                  <ResumoDoBriefing b={briefing} />
                </div>
              </details>
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {propostas.map((p, i) => (
              <CartaoDaProposta
                key={p.id}
                p={p}
                ordem={i}
                escolhida={p.id === escolhidaP.id}
                textos={textos as TextosDaIa}
                onEscolher={() => setEscolhida(p.id)}
                onTrocar={(papel, hex) => trocarCor(p.id, papel, hex)}
                onTrocarPapeis={(a, b) => setPropostas((ps) => ps.map((x) => (x.id === p.id ? trocarPapeis(x, briefing, a, b) : x)))}
                onLaboratorio={() => { setEscolhida(p.id); setAba("laboratorio"); }}
              />
            ))}
          </div>
          <Entrega aberta={entregando} onFechar={() => setEntregando(false)} b={briefing} p={escolhidaP} alternativas={propostas.filter((p) => p.id !== escolhidaP.id)} textos={textos} />
        </div>
      )}

      {aba === "laboratorio" && propostas.length > 0 && (
        <Laboratorio propostas={propostas} inicial={escolhida} textosIniciais={textosDaPrevia} nomes={nomes} />
      )}

      {aba === "ferramentas" && (
        <div className="space-y-5">
          <VerificadorDeContraste inicialTexto={escolhidaP?.cores.find((c) => c.papel === "destaque")?.hex} inicialFundo={escolhidaP?.cores.find((c) => c.papel === "dominante")?.hex} />
          <Tons inicial={escolhidaP?.cores.find((c) => c.papel === "destaque")?.hex ?? "#7A8B6F"} />
          <Harmonias inicial={hexValido(briefing?.corPrincipal) ?? escolhidaP?.cores[0]?.hex ?? "#002893"} onUsar={(cores) => { setModo("zero"); setRascunho(null); gerar({ ...BRIEFING_VAZIO, ...(briefing ?? {}), marca: briefing?.marca || nomeDoCliente || "Marca", corPrincipal: cores[0], preferidas: cores.slice(1) }); }} />
          {escolhidaP && <SimuladorDeDaltonismo cores={escolhidaP.cores.map((c) => c.hex)} />}
          <ExtrairDeImagem onUsar={(cores) => { setAba("criar"); setModo("zero"); setPropostas([]); setBriefing(null); setRascunho(null); toast.message(`Use ${cores[0]} como cor da marca na pergunta da cor.`); }} />
          <CoresVivas />
        </div>
      )}

      {aba === "projetos" && (
        projetos.isLoading ? <Card><Loader2 className="h-5 w-5 animate-spin" /></Card> : !(projetos.data || []).length ? (
          <EmptyState title="Nenhum projeto salvo ainda" description="Gere as propostas e toque em Salvar. Os projetos ficam no painel para toda a equipe." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {(projetos.data || []).map((p) => {
              const esc = p.propostas.find((x) => x.id === p.escolhida) ?? p.propostas[0];
              return (
                <Card
                  key={p.id}
                  title={<span className="flex items-center gap-2">{p.titulo}{p.favorita && <Star className="h-3.5 w-3.5 fill-current text-warning" />}</span>}
                  subtitle={`${clientes.find((c) => c.id === p.client_id)?.nome ?? "Sem cliente"} · ${new Date(p.atualizado_em).toLocaleDateString("pt-BR")}${p.aplicada_em ? " · aplicada" : ""}`}
                  action={<button type="button" className={botao.secundario} onClick={() => abrir(p)}>Abrir</button>}
                  menu={[{ label: "Apagar", icon: <Trash2 className="h-4 w-4" />, danger: true, onSelect: () => { if (window.confirm("Apagar este projeto de paleta? Não dá para desfazer.")) void apagarProjeto(p.id).then(invalidar).catch((e) => toast.error(textoDoErro(e))); } }]}
                >
                  {esc && <FaixaDaPaleta p={esc} alta="h-12" />}
                </Card>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
