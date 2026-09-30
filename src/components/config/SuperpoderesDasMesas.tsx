import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Switch } from "@/components/ui/switch";
import { Carregando, EstadoDeErro, Secao, juntar, lista, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import {
  CHAVE_DOS_SUPERPODERES,
  chaveDoResumo,
  gravarChave,
  lerSuperpoderes,
  resumoDoUso,
  type LinhaDoUso,
} from "@/lib/superpoderes/api";
import {
  agenteComSuperpoderes,
  IDS_DOS_METODOS,
  LICENCA_DO_SUPERPOWERS,
  MESAS_DOS_SUPERPODERES,
  mesasComOMetodo,
  metodosDesligados,
  ondeValeOMetodo,
  ROTULOS_DOS_METODOS,
  SKILL_DE_ORIGEM,
  SKILLS_DO_SUPERPOWERS,
  SKILLS_LIBERADAS_NO_MOTOR,
  TEXTOS_DO_ENTENDER,
  TEXTOS_DOS_METODOS,
  URL_DO_SUPERPOWERS,
  VERSAO_DO_SUPERPOWERS,
  VERSAO_DOS_SUPERPODERES,
  type IdDoMetodo,
  type LinhaDaChave,
} from "../../../supabase/functions/_shared/superpoderes-catalogo";

/**
 * Configurações, Superpoderes (frente SPP, 30/09/2026): o método da casa que
 * todos os agentes de todas as mesas seguem, adaptado de obra/superpowers
 * (licença MIT). Mostra o texto que o agente recebe, onde cada método vale, a
 * chave por mesa (a equipe vê; só o admin grava; a verificação é travada), o
 * que está no motor de código e o uso dos últimos 30 dias.
 *
 * Carregado sob demanda pela linha "Superpoderes" da SettingsPage.
 */

export const AJUDA_DOS_SUPERPODERES =
  "Os superpoderes são o jeito de trabalhar de todos os agentes do painel: entender antes de produzir, plano antes de ação cara, " +
  "causa antes do conserto, receber ajuste sem bajulação, revisão, critério de aceite, frentes paralelas e, sempre, a verificação " +
  "antes de dizer pronto. O texto é nosso, adaptado de obra/superpowers (licença MIT, Jesse Vincent). O contexto do cliente, " +
  "as regras da equipe e as regras da casa vencem o método. Um catálogo só vale para todas as mesas: mudar um método muda todas juntas.";

const nomeDaMesa = (id: string) => {
  if (id === "*") return "Todas as mesas";
  const m = MESAS_DOS_SUPERPODERES.find((x) => x.id === id);
  return m ? m.rotulo : id;
};

function ChaveDaMesa({
  mesa,
  metodo,
  ligado,
  podeGravar,
  gravando,
  onMudar,
}: {
  mesa: string;
  metodo: IdDoMetodo;
  ligado: boolean;
  podeGravar: boolean;
  gravando: boolean;
  onMudar: (ligado: boolean) => void;
}) {
  const id = `sp-${metodo}-${mesa === "*" ? "todas" : mesa}`;
  return (
    <label htmlFor={id} className={juntar(lista.linha, "cursor-pointer py-1.5")} data-chave-da-mesa={mesa}>
      <span className={juntar(texto.corpo, "mr-3 min-w-0 flex-1 truncate")}>{nomeDaMesa(mesa)}</span>
      <Switch
        id={id}
        checked={ligado}
        disabled={!podeGravar || gravando}
        onCheckedChange={(v) => onMudar(!!v)}
        aria-label={`${ROTULOS_DOS_METODOS[metodo]} em ${nomeDaMesa(mesa)}`}
      />
    </label>
  );
}

function Metodo({
  metodo,
  linhas,
  podeGravar,
  gravando,
  onMudar,
}: {
  metodo: IdDoMetodo;
  linhas: LinhaDaChave[];
  podeGravar: boolean;
  gravando: string | null;
  onMudar: (mesa: string, metodo: IdDoMetodo, ligado: boolean) => void;
}) {
  const onde = ondeValeOMetodo(metodo);
  const { ligadas, total } = mesasComOMetodo(linhas, metodo);
  const travado = metodo === "prova";
  const linhaDeTodas = linhas.find((l) => l.mesa === "*" && l.metodo === metodo);
  const textos = metodo === "entender"
    ? [TEXTOS_DO_ENTENDER.grande, TEXTOS_DO_ENTENDER.pequeno, TEXTOS_DO_ENTENDER.viabilidade]
    : [TEXTOS_DOS_METODOS[metodo]];
  return (
    <Secao
      nivel={3}
      titulo={ROTULOS_DOS_METODOS[metodo]}
      descricao={travado ? "sempre ligada" : `ligado em ${ligadas} de ${total} mesas`}
      resumo={`${SKILL_DE_ORIGEM[metodo].join(", ")} · ${travado ? "sempre ligada" : `${ligadas} de ${total} mesas`}`}
      recolher={`config:superpoderes:metodo:${metodo}`}
      recolhidaDeInicio
      data-metodo={metodo}
    >
      <div className="min-w-0 space-y-4">
        <div className="min-w-0 space-y-1.5">
          <p className={texto.rotulo}>Texto que o agente recebe</p>
          {textos.map((t) => (
            <p key={t.slice(0, 40)} className={juntar(texto.corpo, "whitespace-pre-wrap text-muted-foreground")} data-texto-do-metodo={metodo}>
              {t}
            </p>
          ))}
        </div>
        <div className="min-w-0 space-y-1.5">
          <p className={texto.rotulo}>Skill de origem</p>
          <p className={texto.corpo}>{SKILL_DE_ORIGEM[metodo].join(", ")}</p>
        </div>
        <div className="min-w-0 space-y-1.5">
          <p className={texto.rotulo}>Onde vale</p>
          <p className={texto.corpo}>{onde.map(nomeDaMesa).join(", ")}</p>
        </div>
        {travado ? (
          <p className={juntar(texto.auxiliar, "flex items-center")} data-prova-travada="">
            <Lock className="mr-1.5 h-3 w-3 shrink-0" aria-hidden />
            Sempre ligada: regra da casa
          </p>
        ) : (
          <div className="min-w-0 space-y-1.5">
            <p className={texto.rotulo}>Chave por mesa{podeGravar ? "" : " (só o admin muda)"}</p>
            <ul className={juntar(lista.aberta, "grid min-w-0 grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3")}>
              <li className="min-w-0">
                <ChaveDaMesa
                  mesa="*"
                  metodo={metodo}
                  ligado={linhaDeTodas ? linhaDeTodas.ligado : true}
                  podeGravar={podeGravar}
                  gravando={gravando === `*:${metodo}`}
                  onMudar={(v) => onMudar("*", metodo, v)}
                />
              </li>
              {onde.map((mesa) => (
                <li key={mesa} className="min-w-0">
                  <ChaveDaMesa
                    mesa={mesa}
                    metodo={metodo}
                    ligado={metodosDesligados(linhas, mesa).indexOf(metodo) < 0}
                    podeGravar={podeGravar}
                    gravando={gravando === `${mesa}:${metodo}`}
                    onMudar={(v) => onMudar(mesa, metodo, v)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Secao>
  );
}

function MotorDeCodigo() {
  const liberadas = new Set<string>(
    ([] as string[]).concat(SKILLS_LIBERADAS_NO_MOTOR.construir, SKILLS_LIBERADAS_NO_MOTOR.ajustar),
  );
  const nomes = Object.keys(SKILLS_DO_SUPERPOWERS);
  return (
    <Secao
      nivel={3}
      titulo="Motor de código"
      descricao={`${nomes.length} skills instaladas · ${liberadas.size} liberadas`}
      recolher="config:superpoderes:motor"
      recolhidaDeInicio
      ajuda="No motor de código (Mesa Site) as skills originais ficam instaladas completas, fixadas na versão, com a licença. Cada tipo de trabalho que passa pelo modelo libera só as que servem: construir ou ajustar (o revisar é o build e as regras fixas, sem modelo). As outras ficam bloqueadas e o motivo aparece ao lado."
    >
      <ul className={juntar(lista.aberta, lista.divisoria)} data-skills-do-motor={nomes.length}>
        {nomes.map((nome) => {
          const s = SKILLS_DO_SUPERPOWERS[nome];
          return (
            <li key={nome} className={juntar(lista.linha, "items-start")} data-skill={nome}>
              <div className="min-w-0 flex-1">
                <p className={juntar(texto.corpo, "truncate font-medium")}>{nome}</p>
                <p className={juntar(texto.auxiliar, "whitespace-normal")}>{s.como}</p>
                {s.motor === "negada" && s.motivo_no_motor ? <p className={juntar(texto.auxiliar, "whitespace-normal")} data-motivo-no-motor={nome}>No motor: {s.motivo_no_motor}.</p> : null}
              </div>
              <span className={juntar(texto.etiqueta, "ml-3 shrink-0", s.motor === "liberada" ? "text-success" : "text-muted-foreground")}>
                {s.motor === "liberada" ? "liberada" : "bloqueada"}
              </span>
            </li>
          );
        })}
      </ul>
    </Secao>
  );
}

function agruparUso(uso: LinhaDoUso[]) {
  const porAgente = new Map<string, { vezes: Record<string, number>; faltaram: number; jev: number; regra: number; codigo: number }>();
  for (const l of uso) {
    const a = porAgente.get(l.agente) || { vezes: {}, faltaram: 0, jev: 0, regra: 0, codigo: 0 };
    a.vezes[l.metodo] = (a.vezes[l.metodo] || 0) + l.vezes;
    a.faltaram += l.provas_faltaram;
    if (l.metodo === "prova") {
      a.jev += l.pelo_jev;
      a.regra += l.pela_regra;
      a.codigo += l.pelo_codigo;
    }
    porAgente.set(l.agente, a);
  }
  return Array.from(porAgente.entries()).sort((x, y) => (y[1].vezes.prova || 0) - (x[1].vezes.prova || 0));
}

function UsoDosMetodos() {
  const dias = 30;
  const uso = useQuery({ queryKey: chaveDoResumo(dias), queryFn: () => resumoDoUso(dias), staleTime: 60_000 });
  const linhas = uso.data ? agruparUso(uso.data) : [];
  return (
    <Secao
      nivel={3}
      titulo="Uso em 30 dias"
      descricao={uso.data ? `${linhas.length} agentes` : undefined}
      recolher="config:superpoderes:uso"
      recolhidaDeInicio
      ajuda="Quantas vezes cada método entrou em cada agente e quantas verificações ficaram pendentes (o agente disse pronto sem ação feita). É daqui que sai o próximo ajuste de um método: só com um caso real que falhou e um teste de controle."
    >
      {uso.isLoading ? (
        <Carregando linhas={3} />
      ) : uso.error ? (
        <EstadoDeErro descricao={textoDoErro(uso.error)} />
      ) : linhas.length === 0 ? (
        <p className={texto.auxiliar}>Nenhum uso registrado nos últimos 30 dias.</p>
      ) : (
        <ul className={juntar(lista.aberta, lista.divisoria)} data-uso-dos-metodos={linhas.length}>
          {linhas.map(([agente, a]) => {
            const conhecido = agenteComSuperpoderes(agente);
            const partes = IDS_DOS_METODOS.filter((id) => a.vezes[id]).map((id) => `${ROTULOS_DOS_METODOS[id]} ${a.vezes[id]}`);
            return (
              <li key={agente} className={juntar(lista.linha, "items-start")} data-uso-do-agente={agente}>
                <div className="min-w-0 flex-1">
                  <p className={juntar(texto.corpo, "truncate font-medium")}>{conhecido ? `${nomeDaMesa(conhecido.mesa)}: ${conhecido.rotulo}` : agente}</p>
                  <p className={juntar(texto.auxiliar, "whitespace-normal")}>{partes.join(" · ")}</p>
                </div>
                <span className={juntar(texto.etiqueta, "ml-3 shrink-0 tabular-nums", a.faltaram ? "text-warning" : "text-muted-foreground")}>
                  {a.faltaram ? `${a.faltaram} pendentes` : "sem pendência"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Secao>
  );
}

export default function SuperpoderesDasMesas() {
  const { profile } = useAuth();
  const admin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const chaves = useQuery({ queryKey: CHAVE_DOS_SUPERPODERES, queryFn: lerSuperpoderes, staleTime: 30_000 });
  const [gravando, setGravando] = useState<string | null>(null);

  const mudar = async (mesa: string, metodo: IdDoMetodo, ligado: boolean) => {
    if (!admin || gravando) return;
    setGravando(`${mesa}:${metodo}`);
    try {
      await gravarChave(mesa, metodo, ligado);
      await queryClient.invalidateQueries({ queryKey: CHAVE_DOS_SUPERPODERES });
      toast.success(ligado ? "Método ligado" : "Método desligado", { description: `${ROTULOS_DOS_METODOS[metodo]} em ${nomeDaMesa(mesa)}` });
    } catch (e) {
      toast.error("Não foi possível mudar a chave", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setGravando(null);
    }
  };

  const linhas = chaves.data || [];
  return (
    <Secao
      titulo="Superpoderes"
      descricao={`obra/superpowers ${VERSAO_DO_SUPERPOWERS} · MIT`}
      ajuda={AJUDA_DOS_SUPERPODERES}
      recolher="config:superpoderes"
      className="max-w-3xl"
      data-superpoderes=""
    >
      <div className="min-w-0 space-y-5">
        <p className={texto.auxiliar} data-atribuicao="">
          {`obra/superpowers ${VERSAO_DO_SUPERPOWERS}, ${LICENCA_DO_SUPERPOWERS}. `}
          <a href={`${URL_DO_SUPERPOWERS}/blob/${VERSAO_DO_SUPERPOWERS}/LICENSE`} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
            Licença
          </a>
          {` · catálogo ${VERSAO_DOS_SUPERPODERES}`}
        </p>
        {chaves.isLoading ? (
          <Carregando linhas={4} />
        ) : chaves.error ? (
          <EstadoDeErro descricao={textoDoErro(chaves.error)} />
        ) : (
          <div className="min-w-0 space-y-1" data-metodos={IDS_DOS_METODOS.length}>
            {IDS_DOS_METODOS.map((id) => (
              <Metodo key={id} metodo={id} linhas={linhas} podeGravar={admin} gravando={gravando} onMudar={(m, met, v) => void mudar(m, met, v)} />
            ))}
          </div>
        )}
        <MotorDeCodigo />
        <UsoDosMetodos />
      </div>
    </Secao>
  );
}
