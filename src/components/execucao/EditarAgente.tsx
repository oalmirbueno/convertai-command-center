import { useEffect, useMemo, useState } from "react";
import { Archive, ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CampoDeFormulario, GrupoDeCampos, JanelaCentral, botao, campo, juntar, texto } from "@/components/sistema";

/**
 * Editar, aposentar e apagar um agente da hierarquia (10/11/2026, pedido do dono).
 *
 * Só o admin chega aqui (a tela esconde o lápis de quem não é; o banco recusa de qualquer jeito: a
 * política `admin_gerencia_operadores` e os RPCs conferem o papel).
 *
 * Aposentar e apagar são coisas diferentes, e a janela mostra as duas separadas:
 * - APOSENTAR tira o agente da hierarquia (o filtro esconde aposentados) e guarda todo o histórico.
 *   Volta com um clique.
 * - APAGAR DE VEZ só existe para quem não deixou rastro (cadastro errado, duplicado). A auditoria dos
 *   agentes é imutável: quem já trabalhou não pode ser apagado, e a janela diz quantos registros ele tem.
 */

export type AgenteEditavel = {
  id: string;
  slug: string;
  display_name: string;
  role: string;
  scope: string;
  status: string;
  area: string | null;
  parent_slug: string | null;
  origem?: string | null;
  is_coordinator: boolean;
};

export const ORIGENS: { valor: string; rotulo: string }[] = [
  { valor: "hermes", rotulo: "Hermes" },
  { valor: "grok", rotulo: "Grok" },
  { valor: "paperclip", rotulo: "Paperclip" },
];
export const nomeDaOrigem = (o?: string | null) => ORIGENS.find((x) => x.valor === o)?.rotulo ?? "Hermes";

const ESTADOS = [
  { valor: "active", rotulo: "Ativo" },
  { valor: "paused", rotulo: "Pausado" },
  { valor: "retired", rotulo: "Aposentado" },
];

type Historico = Record<"execucoes" | "tarefas" | "auditoria" | "participacoes" | "aprovacoes" | "propostas" | "entregas" | "subordinados" | "chaves", number>;

/** Quem responde (direta ou indiretamente) ao agente: nenhum deles pode virar o superior dele. */
export function descendentesDe(slug: string, todos: Pick<AgenteEditavel, "slug" | "parent_slug">[]): Set<string> {
  const fora = new Set<string>([slug]);
  let cresceu = true;
  while (cresceu) {
    cresceu = false;
    for (const a of todos) {
      if (a.parent_slug && fora.has(a.parent_slug) && !fora.has(a.slug)) { fora.add(a.slug); cresceu = true; }
    }
  }
  return fora;
}

function mensagemDoErro(e: unknown): string {
  const m = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
  if (m.includes("OPERADOR_COM_HISTORICO")) return "Este agente tem histórico e não pode ser apagado. Aposente em vez de apagar.";
  if (m.includes("OPERADOR_COM_CHAVE")) return "Há uma credencial ligada a este agente. Aposente em vez de apagar.";
  if (m.includes("SO_ADMIN")) return "Só o administrador organiza os agentes.";
  if (m.includes("internal_operators_origem_check")) return "Origem inválida.";
  return m || "Não foi possível salvar.";
}

export default function EditarAgente({
  agente,
  todos,
  aoFechar,
  aoMudar,
  aoMoverNaArea,
}: {
  agente: AgenteEditavel | null;
  todos: AgenteEditavel[];
  aoFechar: () => void;
  /** Algo mudou no banco: a tela relê os agentes. */
  aoMudar: () => void | Promise<void>;
  /** Sobe ou desce o agente dentro da área (o arrastar do celular). */
  aoMoverNaArea?: (id: string, sentido: -1 | 1) => void | Promise<void>;
}) {
  const [f, setF] = useState<AgenteEditavel | null>(agente);
  const [ocupado, setOcupado] = useState(false);
  const [historico, setHistorico] = useState<Historico | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    setF(agente);
    setHistorico(null);
    setConfirmando(false);
    if (!agente) return;
    let vivo = true;
    void (supabase as any).rpc("operador_historico", { _id: agente.id }).then(({ data }: { data: Historico | null }) => {
      if (vivo && data) setHistorico(data);
    });
    return () => { vivo = false; };
  }, [agente]);

  const areas = useMemo(() => [...new Set(todos.map((a) => a.area?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR")), [todos]);
  const superiores = useMemo(() => {
    if (!agente) return [];
    const fora = descendentesDe(agente.slug, todos);
    return todos.filter((a) => !fora.has(a.slug) && (a.status === "active" || a.slug === agente.parent_slug))
      .sort((a, b) => a.display_name.localeCompare(b.display_name, "pt-BR"));
  }, [agente, todos]);

  if (!agente || !f) return null;

  const rastro = historico ? historico.execucoes + historico.tarefas + historico.auditoria + historico.participacoes + historico.aprovacoes + historico.propostas + historico.entregas : null;
  const podeApagar = rastro === 0 && historico?.chaves === 0;
  const mudou = (["display_name", "role", "scope", "status", "area", "parent_slug", "origem", "is_coordinator"] as const).some((k) => (f[k] ?? null) !== (agente[k] ?? null));
  const valido = f.display_name.trim().length >= 2 && f.role.trim().length >= 2;

  const rodar = async (acao: () => Promise<void>) => {
    if (ocupado) return;
    setOcupado(true);
    try { await acao(); } catch (e) { toast.error(mensagemDoErro(e)); } finally { setOcupado(false); }
  };

  const salvar = () => rodar(async () => {
    const { error } = await (supabase as any).from("internal_operators").update({
      display_name: f.display_name.trim(),
      role: f.role.trim(),
      scope: f.scope.trim() || f.role.trim(),
      status: f.status,
      area: f.area?.trim() || null,
      parent_slug: f.parent_slug || null,
      origem: f.origem || "hermes",
      is_coordinator: f.is_coordinator,
    }).eq("id", agente.id);
    if (error) throw error;
    toast.success(`${f.display_name.trim()} atualizado.`);
    await aoMudar();
    aoFechar();
  });

  const mudarEstado = (status: "active" | "retired") => rodar(async () => {
    const { error } = await (supabase as any).from("internal_operators").update({ status }).eq("id", agente.id);
    if (error) throw error;
    toast.success(status === "retired" ? `${agente.display_name} aposentado. O histórico continua guardado.` : `${agente.display_name} voltou à ativa.`);
    await aoMudar();
    aoFechar();
  });

  const apagar = () => rodar(async () => {
    const { data, error } = await (supabase as any).rpc("operador_apagar_de_vez", { _id: agente.id });
    if (error) throw error;
    const remanejados = Number(data?.subordinados_remanejados ?? 0);
    toast.success(`${agente.display_name} apagado.${remanejados ? ` ${remanejados} ${remanejados === 1 ? "agente passou" : "agentes passaram"} a responder ao superior dele.` : ""}`);
    await aoMudar();
    aoFechar();
  });

  const aposentado = ["retired", "inactive"].includes(agente.status);

  return (
    <JanelaCentral
      aberta
      onFechar={aoFechar}
      titulo={`Editar ${agente.display_name}`}
      icone={<Pencil className="h-4 w-4" aria-hidden="true" />}
      descricao={`${nomeDaOrigem(agente.origem)} · ${agente.slug}`}
      ajuda="O que você muda aqui aparece na hierarquia na hora. O identificador (slug) não muda: é por ele que o agente se apresenta ao painel."
      largura="md"
      data-editar-agente={agente.slug}
      rodape={
        <div className="flex w-full min-w-0 flex-wrap items-center">
          {aoMoverNaArea && (
            <span className="mr-auto flex items-center">
              <button type="button" className={botao.icone} disabled={ocupado} onClick={() => void aoMoverNaArea(agente.id, -1)} aria-label="Subir na área" title="Subir na área"><ArrowUp className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" className={botao.icone} disabled={ocupado} onClick={() => void aoMoverNaArea(agente.id, 1)} aria-label="Descer na área" title="Descer na área"><ArrowDown className="h-4 w-4" aria-hidden="true" /></button>
            </span>
          )}
          <button type="button" className={botao.secundario} onClick={aoFechar}>Cancelar</button>
          <button type="button" className={juntar(botao.primario, "ml-2")} disabled={ocupado || !mudou || !valido} onClick={() => void salvar()}>{ocupado ? "Salvando…" : "Salvar"}</button>
        </div>
      }
    >
      <GrupoDeCampos colunas={2}>
        <CampoDeFormulario rotulo="Nome" obrigatorio>
          <input className={campo} value={f.display_name} maxLength={60} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Função" obrigatorio>
          <input className={campo} value={f.role} maxLength={90} onChange={(e) => setF({ ...f, role: e.target.value })} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Área" apoio="Escolha uma que já existe ou escreva uma nova.">
          <input className={campo} value={f.area ?? ""} maxLength={40} list="areas-dos-agentes" onChange={(e) => setF({ ...f, area: e.target.value })} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Responde a">
          <select className={campo} value={f.parent_slug ?? ""} onChange={(e) => setF({ ...f, parent_slug: e.target.value || null })}>
            <option value="">Direto ao Hermes</option>
            {superiores.map((s) => <option key={s.slug} value={s.slug}>{s.display_name}</option>)}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Origem" ajuda="Onde o agente roda: no Hermes, como bot do Grok ou no time do Paperclip.">
          <select className={campo} value={f.origem ?? "hermes"} onChange={(e) => setF({ ...f, origem: e.target.value })}>
            {ORIGENS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Status">
          <select className={campo} value={f.status === "inactive" ? "retired" : f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {ESTADOS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="O que faz" largo>
          <textarea className={juntar(campo, "min-h-[84px] py-2")} value={f.scope} maxLength={600} onChange={(e) => setF({ ...f, scope: e.target.value })} />
        </CampoDeFormulario>
        <label className="flex min-w-0 items-center text-[13px] text-foreground sm:col-span-full">
          <input type="checkbox" className="mr-2 h-4 w-4" checked={f.is_coordinator} onChange={(e) => setF({ ...f, is_coordinator: e.target.checked })} />
          Coordena outros agentes (sobe para a linha dos coordenadores)
        </label>
      </GrupoDeCampos>
      <datalist id="areas-dos-agentes">{areas.map((a) => <option key={a} value={a} />)}</datalist>

      <div className="mt-5 border-t border-border pt-4" data-zona-de-saida="">
        <p className={juntar(texto.rotulo, "mb-2")}>Tirar da hierarquia</p>
        <div className="-m-1 flex flex-wrap items-center [&>*]:m-1">
          {aposentado ? (
            <button type="button" className={botao.secundario} disabled={ocupado} onClick={() => void mudarEstado("active")}>Voltar à ativa</button>
          ) : (
            <button type="button" className={botao.secundario} disabled={ocupado} onClick={() => void mudarEstado("retired")}>
              <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Aposentar
            </button>
          )}
          {podeApagar && !confirmando && (
            <button type="button" className={botao.perigo} disabled={ocupado} onClick={() => setConfirmando(true)}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Apagar de vez
            </button>
          )}
        </div>
        {confirmando && (
          <div role="alertdialog" aria-label="Confirmar apagar de vez" className="mt-3 rounded-md bg-destructive/10 px-3 py-2.5 text-[13px]">
            <p className="text-foreground">
              Apagar <strong className="font-medium">{agente.display_name}</strong> de vez? Não dá para desfazer.
              {historico && historico.subordinados > 0 ? ` ${historico.subordinados === 1 ? "Quem responde" : `Os ${historico.subordinados} que respondem`} a ele passa a responder ao superior dele.` : ""}
            </p>
            <div className="-m-1 mt-1 flex flex-wrap [&>*]:m-1">
              <button type="button" className={botao.perigo} disabled={ocupado} onClick={() => void apagar()}>{ocupado ? "Apagando…" : "Sim, apagar de vez"}</button>
              <button type="button" className={botao.secundario} disabled={ocupado} onClick={() => setConfirmando(false)}>Não apagar</button>
            </div>
          </div>
        )}
        <p className={juntar(texto.auxiliar, "mt-2")} data-explica-apagar="">
          {historico === null
            ? "Conferindo o histórico do agente…"
            : podeApagar
              ? "Aposentar esconde e guarda o histórico. Este agente ainda não tem histórico, então também pode ser apagado de vez."
              : rastro && rastro > 0
                ? `Este agente tem ${rastro} ${rastro === 1 ? "registro" : "registros"} de trabalho e auditoria, que são imutáveis: ele pode ser aposentado (some da hierarquia, o histórico fica), não apagado.`
                : "Há uma credencial ligada a este agente: ele pode ser aposentado, não apagado."}
        </p>
      </div>
    </JanelaCentral>
  );
}
