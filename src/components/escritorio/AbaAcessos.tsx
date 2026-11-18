import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { tabela } from "@/components/finance/pecasDoFinanceiro";
import { CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, GrupoDeCampos, JanelaCentral, botao, campo, campoTexto, etiqueta, juntar, texto } from "@/components/sistema";
import { haQuanto } from "@/lib/gruposAoVivo";
import { bloqueiosAbertos, credenciaisPorAgente, mensagemDoErroDoEscritorio } from "@/lib/escritorio/acessos";
import { presencaPorSlug, ultimaAtividade } from "@/lib/escritorio/presenca";
import { GRAUS, type AgenteDoEscritorio, type ChaveMcp, type Presenca } from "@/lib/escritorio/tipos";
import LinhaDoAgente, { EtiquetaDaPlataforma, EtiquetaDoGrau } from "./LinhaDoAgente";
import { CHAVES, bloquearAgente, desbloquearAgente, ligarCredencial, mudarGrau, useAcessos } from "./escritorioApi";

/**
 * Acessos do Escritório: uma linha por agente com a plataforma, o grau, o
 * estado, as credenciais que assinam por ele (só nome e começo da chave, nunca
 * o segredo) e a última atividade. O dono muda o grau, bloqueia, desbloqueia e
 * liga uma credencial. O resto da equipe só vê.
 */

const ESTADO: Record<string, { rotulo: string; classe: string }> = {
  active: { rotulo: "Ativo", classe: "bg-success-soft text-success" },
  paused: { rotulo: "Pausado", classe: "bg-warning-soft text-warning" },
  retired: { rotulo: "Aposentado", classe: "bg-muted text-muted-foreground" },
  inactive: { rotulo: "Excluído", classe: "bg-muted text-muted-foreground" },
};

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
      largura="sm"
      rodape={
        <div className="flex w-full min-w-0 flex-wrap items-center justify-end">
          <button type="button" className={botao.secundario} disabled={ocupado} onClick={aoFechar}>Não bloquear</button>
          <button
            type="button"
            className={juntar(botao.perigo, "ml-2")}
            disabled={ocupado}
            onClick={() => { setOcupado(true); void aoBloquear(motivo.trim()).finally(() => setOcupado(false)); }}
          >
            {ocupado ? "Bloqueando…" : "Sim, bloquear"}
          </button>
        </div>
      }
    >
      <p className={juntar(texto.corpo, "mb-4")}>
        Bloquear pausa o agente e tira as credenciais dele na hora.
        A chave que era só dele é desligada e não volta: depois é preciso criar outra.
      </p>
      <CampoDeFormulario rotulo="Motivo" apoio="Opcional. Fica guardado no registro do bloqueio.">
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
        <div className="flex w-full min-w-0 flex-wrap items-center justify-end">
          <button type="button" className={botao.secundario} disabled={ocupado} onClick={aoFechar}>Cancelar</button>
          <button
            type="button"
            className={juntar(botao.primario, "ml-2")}
            disabled={ocupado || !keyId}
            onClick={() => { setOcupado(true); void aoLigar(keyId, padrao).finally(() => setOcupado(false)); }}
          >
            {ocupado ? "Ligando…" : "Ligar"}
          </button>
        </div>
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
            Esta chave assina por este agente quando não disser por quem
          </label>
        </GrupoDeCampos>
      )}
    </JanelaCentral>
  );
}

export default function AbaAcessos({ agentes, presencas, agora, admin }: { agentes: AgenteDoEscritorio[]; presencas: Presenca[]; agora: number; admin: boolean }) {
  const qc = useQueryClient();
  const q = useAcessos();
  const [ocupado, setOcupado] = useState(false);
  const [bloqueando, setBloqueando] = useState<AgenteDoEscritorio | null>(null);
  const [ligando, setLigando] = useState<AgenteDoEscritorio | null>(null);

  const presenca = useMemo(() => presencaPorSlug(presencas), [presencas]);
  const credenciais = useMemo(() => credenciaisPorAgente(q.data?.vinculos ?? [], q.data?.chaves ?? []), [q.data]);
  const bloqueios = useMemo(() => bloqueiosAbertos(q.data?.bloqueios ?? []), [q.data]);
  const chavesDoMcp = useMemo(() => (q.data?.chaves ?? []).filter((k) => k.audience === "mcp" && k.is_active), [q.data]);

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

  if (q.isLoading) return <Carregando rotulo="Lendo os acessos" linhas={8} />;
  if (q.error) return <EstadoDeErro titulo="Não foi possível ler os acessos." descricao={(q.error as Error).message} />;
  if (agentes.length === 0) return <EstadoVazio titulo="Nenhum agente no cadastro." />;

  return (
    <>
    <div className={tabela.moldura} data-acessos-do-escritorio="">
      <table className={juntar(tabela.tabela, admin ? "min-w-[1120px]" : "min-w-[900px]")} aria-label="Acessos dos agentes">
        <thead className={tabela.cabeca}>
          <tr>
            <th>Agente</th>
            <th>Plataforma</th>
            <th>Grau</th>
            <th>Estado</th>
            <th>Credenciais</th>
            <th>Última atividade</th>
            {admin && <th>Ações</th>}
          </tr>
        </thead>
        <tbody className={tabela.corpo}>
          {agentes.map((a) => {
            const p = presenca.get(a.slug);
            const bloqueio = bloqueios.get(a.slug);
            const estado = ESTADO[a.status] ?? { rotulo: a.status, classe: "bg-muted text-muted-foreground" };
            const doAgente = credenciais.get(a.slug) ?? [];
            const ultima = ultimaAtividade(a.last_run_at, p?.batimento_em);
            return (
              <tr key={a.id} data-acesso={a.slug}>
                <td className="align-top"><LinhaDoAgente agente={a} presenca={p} agora={agora} /></td>
                <td className="align-top"><EtiquetaDaPlataforma origem={a.origem} /></td>
                <td className="align-top">
                  {admin ? (
                    <select
                      className={juntar(campo, "h-8 w-auto")}
                      value={a.grau ?? "executor"}
                      disabled={ocupado}
                      aria-label={`Grau de ${a.display_name}`}
                      onChange={(e) => {
                        const grau = e.target.value;
                        void rodar(async () => { await mudarGrau(a.id, grau); return `${a.display_name} agora é ${GRAUS.find((g) => g.valor === grau)?.rotulo.toLowerCase() ?? grau}.`; });
                      }}
                    >
                      {GRAUS.map((g) => <option key={g.valor} value={g.valor} title={g.alcance}>{g.rotulo}</option>)}
                    </select>
                  ) : (
                    <EtiquetaDoGrau grau={a.grau} />
                  )}
                </td>
                <td className="align-top">
                  <span className={juntar(etiqueta, estado.classe)}>{estado.rotulo}</span>
                  {bloqueio && (
                    <span className={juntar(etiqueta, "ml-1.5 bg-danger-soft text-destructive")} title={bloqueio.motivo ? `Motivo: ${bloqueio.motivo}` : undefined} data-bloqueado="">
                      Bloqueado {haQuanto(bloqueio.bloqueado_em, agora)}
                    </span>
                  )}
                </td>
                <td className="align-top">
                  {doAgente.length === 0 ? (
                    <span className="text-muted-foreground">Nenhuma</span>
                  ) : (
                    <ul className="space-y-1" aria-label={`Credenciais de ${a.display_name}`}>
                      {doAgente.map((c) => (
                        <li key={c.principal} className="flex min-w-0 flex-wrap items-center">
                          <span className="mr-1.5 text-foreground">{c.nome}</span>
                          {c.previa && <span className="mr-1.5 font-mono text-[12px] text-muted-foreground">{c.previa}</span>}
                          {c.tipo === "conector" && <span className={juntar(etiqueta, "mr-1.5 bg-muted text-muted-foreground")}>conector</span>}
                          {c.padrao && <span className={juntar(etiqueta, "mr-1.5 bg-muted text-muted-foreground")}>padrão</span>}
                          {c.desligada && <span className={juntar(etiqueta, "bg-danger-soft text-destructive")}>desligada</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="whitespace-nowrap align-top tabular-nums">{ultima ? haQuanto(ultima, agora) : "sem atividade ainda"}</td>
                {admin && (
                  <td className="whitespace-nowrap align-top">
                    {bloqueio ? (
                      <button
                        type="button"
                        className={juntar(botao.secundario, "h-8")}
                        disabled={ocupado}
                        onClick={() => void rodar(async () => {
                          const r = await desbloquearAgente(a.slug);
                          const naoVoltam = Number(r?.chaves_que_nao_voltam ?? 0);
                          return `${a.display_name} desbloqueado.${naoVoltam ? ` ${naoVoltam === 1 ? "1 chave desligada não volta" : `${naoVoltam} chaves desligadas não voltam`}: crie outra e ligue aqui.` : ""}`;
                        })}
                      >
                        <LockOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Desbloquear
                      </button>
                    ) : (
                      <button type="button" className={juntar(botao.perigo, "h-8")} disabled={ocupado} onClick={() => setBloqueando(a)}>
                        <Lock className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Bloquear
                      </button>
                    )}
                    <button type="button" className={juntar(botao.secundario, "ml-1.5 h-8")} disabled={ocupado} onClick={() => setLigando(a)} aria-label={`Ligar credencial a ${a.display_name}`}>
                      <KeyRound className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Ligar credencial
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>

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
