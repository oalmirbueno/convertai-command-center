import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Lock, LockOpen, MessageSquarePlus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { AvatarComPresenca } from "@/components/execucao/Visuais";
import { CampoDeFormulario, EstadoVazio, GrupoDeCampos, JanelaCentral, MenuMais, botao, campo, campoTexto, juntar, superficie, texto } from "@/components/sistema";
import { Chip, type Tone } from "@/components/ds";
import { haQuanto } from "@/lib/gruposAoVivo";
import { bloqueiosAbertos, credenciaisPorAgente, mensagemDoErroDoEscritorio } from "@/lib/escritorio/acessos";
import { fazendoAgora, presenteAgora, ultimaAtividade } from "@/lib/escritorio/presenca";
import { GRAUS, PAPEIS_NA_SALA, type AgenteDoEscritorio, type ChaveMcp, type Presenca } from "@/lib/escritorio/tipos";
import { EtiquetaDaPlataforma, EtiquetaDoGrau } from "./LinhaDoAgente";
import { CHAVES, bloquearAgente, desbloquearAgente, ligarCredencial, mudarGrau, useAcessos, useSalas } from "./escritorioApi";

/**
 * Ficha do agente no Escritório (19/11/2026): abre no centro ao clicar num
 * agente (Agora, Organograma, Acessos). Mostra onde roda, o grau, o que faz
 * agora, a quem responde, as salas e as credenciais (só nome e começo da
 * chave). O dono muda o grau, manda mensagem, liga credencial, bloqueia e
 * desbloqueia daqui. O resto da equipe só vê.
 */

export const ESTADO_DO_AGENTE: Record<string, { rotulo: string; tom: Tone }> = {
  active: { rotulo: "Ativo", tom: "success" },
  paused: { rotulo: "Pausado", tom: "warning" },
  retired: { rotulo: "Aposentado", tom: "neutral" },
  inactive: { rotulo: "Excluído", tom: "neutral" },
};
export const estadoDoAgente = (status: string) => ESTADO_DO_AGENTE[status] ?? { rotulo: status, tom: "neutral" as Tone };

function JanelaDeBloquear({ agente, aoFechar, aoBloquear }: { agente: AgenteDoEscritorio | null; aoFechar: () => void; aoBloquear: (motivo: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { setMotivo(""); }, [agente]);
  if (!agente) return null;
  return (
    <JanelaCentral
      aberta
      onFechar={aoFechar}
      titulo={`Bloquear ${agente.display_name}`}
      icone={<Lock className="h-4 w-4" aria-hidden="true" />}
      ajuda="A chave que era só dele é desligada e não volta: depois é preciso criar outra."
      largura="sm"
      rodape={
        <>
          <button type="button" className={botao.secundario} disabled={ocupado} onClick={aoFechar}>Não bloquear</button>
          <button
            type="button"
            className={botao.perigo}
            disabled={ocupado}
            onClick={() => { setOcupado(true); void aoBloquear(motivo.trim()).finally(() => setOcupado(false)); }}
          >
            {ocupado ? "Bloqueando…" : "Sim, bloquear"}
          </button>
        </>
      }
    >
      <p className={juntar(texto.corpo, "mb-4")}>Bloquear pausa o agente e tira as credenciais dele na hora.</p>
      <CampoDeFormulario rotulo="Motivo" apoio="Opcional">
        <textarea className={campoTexto} value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} />
      </CampoDeFormulario>
    </JanelaCentral>
  );
}

function JanelaDeLigarCredencial({ agente, chaves, aoFechar, aoLigar }: { agente: AgenteDoEscritorio | null; chaves: ChaveMcp[]; aoFechar: () => void; aoLigar: (keyId: string, padrao: boolean) => Promise<void> }) {
  const [keyId, setKeyId] = useState("");
  const [padrao, setPadrao] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { setKeyId(""); setPadrao(true); }, [agente]);
  if (!agente) return null;
  return (
    <JanelaCentral
      aberta
      onFechar={aoFechar}
      titulo={`Ligar credencial a ${agente.display_name}`}
      icone={<KeyRound className="h-4 w-4" aria-hidden="true" />}
      ajuda="A credencial é uma chave do MCP já criada em Configurações. Ligada a um agente, ela passa a assinar e a ler por ele. O segredo da chave não aparece aqui."
      largura="sm"
      rodape={
        <>
          <button type="button" className={botao.secundario} disabled={ocupado} onClick={aoFechar}>Cancelar</button>
          <button
            type="button"
            className={botao.primario}
            disabled={ocupado || !keyId}
            onClick={() => { setOcupado(true); void aoLigar(keyId, padrao).finally(() => setOcupado(false)); }}
          >
            {ocupado ? "Ligando…" : "Ligar"}
          </button>
        </>
      }
    >
      {chaves.length === 0 ? (
        <EstadoVazio compacto titulo="Nenhuma chave do MCP ativa." descricao="Crie uma em Configurações e volte aqui." />
      ) : (
        <GrupoDeCampos colunas={1}>
          <CampoDeFormulario rotulo="Credencial" obrigatorio>
            <select className={campo} value={keyId} onChange={(e) => setKeyId(e.target.value)}>
              <option value="">Escolha uma chave</option>
              {chaves.map((k) => <option key={k.id} value={k.id}>{k.name}{k.key_preview ? ` (${k.key_preview})` : ""}</option>)}
            </select>
          </CampoDeFormulario>
          <label className="flex min-w-0 items-center text-[13px] text-foreground">
            <input type="checkbox" className="mr-2 h-4 w-4" checked={padrao} onChange={(e) => setPadrao(e.target.checked)} />
            Assina por este agente quando não disser por quem
          </label>
        </GrupoDeCampos>
      )}
    </JanelaCentral>
  );
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={texto.rotulo}>{rotulo}</dt>
      <dd className={juntar(texto.corpo, "mt-0.5 min-w-0 [overflow-wrap:anywhere]")}>{children}</dd>
    </div>
  );
}

export default function FichaDoAgente({
  slug,
  agentes,
  presenca,
  agora,
  admin,
  aoFechar,
  aoMandarMensagem,
  aoEditar,
}: {
  /** O agente aberto; null fecha a ficha. */
  slug: string | null;
  agentes: AgenteDoEscritorio[];
  presenca: Map<string, Presenca>;
  agora: number;
  admin: boolean;
  aoFechar: () => void;
  aoMandarMensagem: (slug: string) => void;
  aoEditar: (agente: AgenteDoEscritorio) => void;
}) {
  const qc = useQueryClient();
  const acessos = useAcessos();
  const salas = useSalas();
  const [ocupado, setOcupado] = useState(false);
  const [bloqueando, setBloqueando] = useState<AgenteDoEscritorio | null>(null);
  const [ligando, setLigando] = useState<AgenteDoEscritorio | null>(null);

  const credenciais = useMemo(() => credenciaisPorAgente(acessos.data?.vinculos ?? [], acessos.data?.chaves ?? []), [acessos.data]);
  const bloqueios = useMemo(() => bloqueiosAbertos(acessos.data?.bloqueios ?? []), [acessos.data]);
  const chavesDoMcp = useMemo(() => (acessos.data?.chaves ?? []).filter((k) => k.audience === "mcp" && k.is_active), [acessos.data]);

  const agente = slug ? agentes.find((a) => a.slug === slug) ?? null : null;

  const reler = () => Promise.all([
    qc.invalidateQueries({ queryKey: CHAVES.agentes }),
    qc.invalidateQueries({ queryKey: CHAVES.acessos }),
    qc.invalidateQueries({ queryKey: ["operadores-internos"] }),
  ]);
  /** Faz, avisa e relê. Devolve se deu certo (a janela só fecha quando deu). */
  const rodar = async (acao: () => Promise<string>): Promise<boolean> => {
    if (ocupado) return false;
    setOcupado(true);
    try {
      toast.success(await acao());
      await reler();
      return true;
    } catch (e) {
      toast.error(mensagemDoErroDoEscritorio(e));
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const p = agente ? presenca.get(agente.slug) : undefined;
  const presente = agente ? presenteAgora(p?.batimento_em, agora) : false;
  const fazendo = fazendoAgora(p, agora);
  const ultima = agente ? ultimaAtividade(agente.last_run_at, p?.batimento_em) : null;
  const bloqueio = agente ? bloqueios.get(agente.slug) : undefined;
  const estado = agente ? estadoDoAgente(agente.status) : null;
  const doAgente = agente ? credenciais.get(agente.slug) ?? [] : [];
  const chefe = agente?.parent_slug ? agentes.find((a) => a.slug === agente.parent_slug)?.display_name ?? agente.parent_slug : null;
  const salasDele = agente
    ? (salas.data?.membros ?? []).filter((m) => m.operator_slug === agente.slug).map((m) => {
      const sala = salas.data?.salas.find((s) => s.id === m.grupo_id);
      return { id: m.grupo_id, nome: sala?.nome ?? "Sala", papel: PAPEIS_NA_SALA.find((x) => x.valor === m.papel)?.rotulo ?? m.papel };
    })
    : [];

  return (
    <>
      <JanelaCentral
        aberta={Boolean(agente)}
        onMudar={(v) => { if (!v) aoFechar(); }}
        titulo={agente?.display_name ?? "Agente"}
        icone={agente ? <AvatarComPresenca nome={agente.display_name} ativo={agente.status === "active"} tamanho={24} /> : undefined}
        descricao={presente ? "Aqui agora" : ultima ? `Visto ${haQuanto(ultima, agora)}` : "Sem atividade ainda"}
        largura="md"
        data-ficha-do-agente={agente?.slug}
        rodape={admin && agente ? (
          <>
            <MenuMais
              rotulo={`Mais ações de ${agente.display_name}`}
              alinhar="start"
              desativado={ocupado}
              itens={[
                { rotulo: "Editar agente", icone: <Pencil className="h-4 w-4" />, aoEscolher: () => { aoFechar(); aoEditar(agente); } },
                { rotulo: "Ligar credencial", icone: <KeyRound className="h-4 w-4" />, aoEscolher: () => { aoFechar(); setLigando(agente); } },
                bloqueio
                  ? {
                    rotulo: "Desbloquear",
                    icone: <LockOpen className="h-4 w-4" />,
                    aoEscolher: () => void rodar(async () => {
                      const r = await desbloquearAgente(agente.slug);
                      const naoVoltam = Number(r?.chaves_que_nao_voltam ?? 0);
                      return `${agente.display_name} desbloqueado.${naoVoltam ? ` ${naoVoltam === 1 ? "1 chave desligada não volta" : `${naoVoltam} chaves desligadas não voltam`}: crie outra e ligue aqui.` : ""}`;
                    }),
                  }
                  : { rotulo: "Bloquear", icone: <Lock className="h-4 w-4" />, perigo: true, aoEscolher: () => { aoFechar(); setBloqueando(agente); } },
              ]}
            />
            <span className="flex-1" aria-hidden="true" />
            <button type="button" className={botao.primario} onClick={() => { aoFechar(); aoMandarMensagem(agente.slug); }} disabled={agente.status !== "active"}>
              <MessageSquarePlus className="mr-1.5 h-4 w-4" aria-hidden="true" />Mandar mensagem
            </button>
          </>
        ) : undefined}
      >
        {agente && estado && (
          <div className="min-w-0 space-y-5">
            <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-1.5 [&>*]:mr-1.5">
              <Chip tone={presente ? "success" : estado.tom} dot>{presente ? "Aqui agora" : estado.rotulo}</Chip>
              {bloqueio && (
                <span className="inline-flex" data-bloqueado="" title={bloqueio.motivo ? `Motivo: ${bloqueio.motivo}` : undefined}>
                  <Chip tone="danger">Bloqueado {haQuanto(bloqueio.bloqueado_em, agora)}</Chip>
                </span>
              )}
              <EtiquetaDaPlataforma origem={agente.origem} />
              {!admin && <EtiquetaDoGrau grau={agente.grau} />}
            </div>

            {fazendo && (
              <p className={juntar(superficie.poco, texto.corpo, "px-3.5 py-3")} data-fazendo-na-ficha="">{fazendo}</p>
            )}

            <dl className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-4">
              {admin ? (
                <div className="min-w-0">
                  <dt className={texto.rotulo}><label htmlFor={`grau-${agente.slug}`}>Grau</label></dt>
                  <dd className="mt-1 min-w-0">
                    <select
                      id={`grau-${agente.slug}`}
                      className={juntar(campo, "h-9")}
                      value={agente.grau ?? "executor"}
                      disabled={ocupado}
                      aria-label={`Grau de ${agente.display_name}`}
                      onChange={(e) => {
                        const grau = e.target.value;
                        void rodar(async () => { await mudarGrau(agente.id, grau); return `${agente.display_name} agora é ${GRAUS.find((g) => g.valor === grau)?.rotulo.toLowerCase() ?? grau}.`; });
                      }}
                    >
                      {GRAUS.map((g) => <option key={g.valor} value={g.valor} title={g.alcance}>{g.rotulo}</option>)}
                    </select>
                  </dd>
                </div>
              ) : null}
              <Dado rotulo="Função">{agente.role || "Sem função"}</Dado>
              <Dado rotulo="Área">{agente.area || "Sem área"}</Dado>
              <Dado rotulo="Responde a">{chefe || "Dono"}</Dado>
              <Dado rotulo="Última atividade"><span className="tabular-nums">{ultima ? haQuanto(ultima, agora) : "sem atividade ainda"}</span></Dado>
            </dl>

            <section aria-label="Salas" className="min-w-0">
              <h3 className={texto.rotulo}>Salas</h3>
              {salasDele.length === 0 ? (
                <p className={juntar(texto.auxiliar, "mt-1")}>Em nenhuma sala</p>
              ) : (
                <div className="mt-1.5 flex min-w-0 flex-wrap [&>*]:mb-1.5 [&>*]:mr-1.5">
                  {salasDele.map((s) => <Chip key={s.id} outline title={s.papel}>{s.nome}</Chip>)}
                </div>
              )}
            </section>

            <section aria-label={`Credenciais de ${agente.display_name}`} className="min-w-0" data-credenciais="">
              <h3 className={texto.rotulo}>Credenciais</h3>
              {doAgente.length === 0 ? (
                <p className={juntar(texto.auxiliar, "mt-1")}>Nenhuma</p>
              ) : (
                <ul className="mt-1 min-w-0 divide-y divide-border/50">
                  {doAgente.map((c) => (
                    <li key={c.principal} className="flex min-w-0 flex-wrap items-center py-2">
                      <KeyRound className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className={juntar(texto.corpo, "mr-2 min-w-0 truncate font-medium")}>{c.nome}</span>
                      {c.previa && <span className={juntar(texto.auxiliar, "mr-2 tabular-nums")}>{c.previa}</span>}
                      {c.tipo === "conector" && <Chip className="mr-1.5">conector</Chip>}
                      {c.padrao && <Chip className="mr-1.5">padrão</Chip>}
                      {c.desligada && <Chip tone="danger">desligada</Chip>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </JanelaCentral>

      {admin && (
        <JanelaDeBloquear
          agente={bloqueando}
          aoFechar={() => setBloqueando(null)}
          aoBloquear={async (motivo) => {
            const alvo = bloqueando;
            if (!alvo) return;
            const deuCerto = await rodar(async () => {
              const r = await bloquearAgente(alvo.slug, motivo || null);
              const chaves = Number(r?.chaves_desligadas ?? 0);
              return `${alvo.display_name} bloqueado. ${chaves === 1 ? "1 chave desligada" : `${chaves} chaves desligadas`}.`;
            });
            if (deuCerto) setBloqueando(null);
          }}
        />
      )}
      {admin && (
        <JanelaDeLigarCredencial
          agente={ligando}
          chaves={chavesDoMcp}
          aoFechar={() => setLigando(null)}
          aoLigar={async (keyId, padrao) => {
            const alvo = ligando;
            if (!alvo) return;
            const deuCerto = await rodar(async () => { await ligarCredencial(keyId, alvo.slug, padrao); return `Credencial ligada a ${alvo.display_name}.`; });
            if (deuCerto) setLigando(null);
          }}
        />
      )}
    </>
  );
}
