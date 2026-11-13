import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft, Bell, ListChecks, Pencil, Plus, Shuffle, Trash2, UserCheck, Zap } from "lucide-react";
import { diaLegivel, fraseDoErro, type EstadoDoProduto } from "@/lib/produto/api";
import { nomesDasEtapas, type EtapaId } from "@/lib/produto/nichos";
import {
  ACOES,
  DIAS_PARADO,
  ETAPAS_ABERTAS,
  GATILHOS,
  LIMITE_DE_AUTOMACOES,
  NOME_DA_ACAO,
  NOME_DE_QUEM,
  NOME_DO_GATILHO,
  NOME_DO_TIPO,
  PRAZO_DA_TAREFA,
  QUEM_AVISAR,
  RASCUNHO_VAZIO,
  TIPOS_DE_TAREFA,
  aceitaSemDono,
  chaveDasAutomacoes,
  criarAutomacao,
  erroDoRascunho,
  etapasDoGatilho,
  excluirAutomacao,
  fraseDaAutomacao,
  ligarAutomacao,
  linhaDaReceita,
  linhaDoRascunho,
  listarAutomacoes,
  nomeSugerido,
  rascunhoDaAutomacao,
  receitasQueFaltam,
  salvarAutomacao,
  type AcaoDaAutomacao,
  type Automacao,
  type EtapaAberta,
  type GatilhoDaAutomacao,
  type PessoaDaEquipe,
  type QuemAvisar,
  type RascunhoDeAutomacao,
  type ReceitaDeAutomacao,
  type TipoDeTarefa,
} from "@/lib/produto/automacoes";
import { Switch } from "@/components/ui/switch";
import { CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, JanelaCentral, MenuMais, Secao, botao, campo, campoTexto, etiqueta, foco, juntar, lista, superficie, texto } from "@/components/sistema";

const ICONE_DA_ACAO: Record<AcaoDaAutomacao, JSX.Element> = {
  criar_tarefa: <ListChecks className="h-4 w-4" aria-hidden="true" />,
  atribuir_rodizio: <Shuffle className="h-4 w-4" aria-hidden="true" />,
  atribuir_membro: <UserCheck className="h-4 w-4" aria-hidden="true" />,
  mover_etapa: <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />,
  avisar: <Bell className="h-4 w-4" aria-hidden="true" />,
};

const ROTULO_DA_ETAPA: Record<GatilhoDaAutomacao, string> = {
  negocio_criado: "Criado na etapa",
  etapa_mudou: "Entrou na etapa",
  negocio_ganho: "Etapa",
  negocio_perdido: "Etapa",
  negocio_parado: "Parado na etapa",
};

/** Só algarismos, no máximo três: o campo de dias e o de prazo. */
const soNumero = (v: string) => Number(v.replace(/\D/g, "").slice(0, 3)) || 0;
const dentro = (n: number, limites: { minimo: number; maximo: number }) => Math.min(Math.max(n, limites.minimo), limites.maximo);

/** Um dos três passos do criador: número, palavra e os campos dele. */
function Passo({ numero, titulo, children }: { numero: number; titulo: string; children: ReactNode }) {
  return (
    <section className="min-w-0" data-passo={titulo}>
      <h3 className="mb-3 flex min-w-0 items-center">
        <span className="mr-2.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary" aria-hidden="true">{numero}</span>
        <span className={texto.tituloSecao}>{titulo}</span>
      </h3>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/**
 * Automações da empresa: as receitas prontas (um clique liga), a lista do que
 * já roda, com a frase que qualquer pessoa lê, e o criador "Quando, Se, Então".
 * O motor é do banco; aqui só se cadastra. Gerente e quem administra gravam;
 * o vendedor vê tudo, sem botão de gravar.
 */
export default function AutomacoesDaConta({ estado }: { estado: EstadoDoProduto }) {
  const qc = useQueryClient();
  // Como texto: o cargo de gerente chega pelo banco antes de entrar no tipo do estado.
  const papel: string = estado.eu ? estado.eu.papel : "";
  const podeGravar = papel === "admin" || papel === "gerente";
  const nomes = nomesDasEtapas(estado.conta ? estado.conta.perfil : {});
  const equipe: PessoaDaEquipe[] = estado.equipe || [];
  const ativos = equipe.filter((m) => m.user_id && m.estado === "ativo");

  const automacoes = useQuery({ queryKey: chaveDasAutomacoes, queryFn: listarAutomacoes });
  const reler = () => qc.invalidateQueries({ queryKey: chaveDasAutomacoes });

  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<Automacao | null>(null);
  const [r, setR] = useState<RascunhoDeAutomacao>(RASCUNHO_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [ocupada, setOcupada] = useState("");
  const [saindo, setSaindo] = useState<Automacao | null>(null);

  const itens = automacoes.data || [];
  const cheio = itens.length >= LIMITE_DE_AUTOMACOES;
  const receitas = receitasQueFaltam(itens);
  const ligadas = itens.filter((a) => a.ativa).length;

  const mudar = (parte: Partial<RascunhoDeAutomacao>) => setR((antes) => ({ ...antes, ...parte }));

  const abrirNova = () => {
    setEditando(null);
    setR(RASCUNHO_VAZIO);
    setAberto(true);
  };

  const abrirEdicao = (a: Automacao) => {
    setEditando(a);
    setR(rascunhoDaAutomacao(a));
    setAberto(true);
  };

  const trocarGatilho = (gatilho: GatilhoDaAutomacao) => {
    // A etapa escolhida só continua se o gatilho novo aceita aquela etapa.
    const etapa = r.etapa && etapasDoGatilho(gatilho).indexOf(r.etapa) >= 0 ? r.etapa : "";
    mudar({ gatilho, etapa, semDono: r.semDono && aceitaSemDono(gatilho) });
  };

  const erro = erroDoRascunho(r);
  const previa = linhaDoRascunho(r, nomes, equipe);

  const salvar = async () => {
    if (erro) {
      toast.error(erro);
      return;
    }
    setSalvando(true);
    try {
      if (editando) {
        await salvarAutomacao(editando.id, linhaDoRascunho(r, nomes, equipe, editando.ativa));
        toast.success("Automação salva.");
      } else {
        await criarAutomacao(linhaDoRascunho(r, nomes, equipe));
        toast.success("Automação criada. Ela já vale para os próximos negócios.");
      }
      await reler();
      setAberto(false);
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar a automação."));
    } finally {
      setSalvando(false);
    }
  };

  const ligarReceita = async (receita: ReceitaDeAutomacao) => {
    setOcupada(receita.id);
    try {
      await criarAutomacao(linhaDaReceita(receita));
      await reler();
      toast.success(`${receita.nome}: ligada.`);
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível ligar a receita."));
    } finally {
      setOcupada("");
    }
  };

  const alternar = async (a: Automacao, ativa: boolean) => {
    setOcupada(a.id);
    try {
      await ligarAutomacao(a.id, ativa);
      await reler();
      toast.success(ativa ? "Automação ligada." : "Automação desligada.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível mudar a automação."));
    } finally {
      setOcupada("");
    }
  };

  const excluir = async (a: Automacao) => {
    try {
      await excluirAutomacao(a.id);
      await reler();
      toast.success("Automação excluída.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível excluir a automação."));
    }
  };

  const etapasDaCondicao = etapasDoGatilho(r.gatilho);
  const pessoaDeFora = r.acao === "atribuir_membro" && r.userId && !ativos.some((m) => m.user_id === r.userId);

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-x-10 gap-y-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)]" data-automacoes-da-conta="">
      <Secao
        titulo="Automações"
        descricao={automacoes.data ? `${itens.length} de ${LIMITE_DE_AUTOMACOES}, ${ligadas} ${ligadas === 1 ? "ligada" : "ligadas"}` : undefined}
        ajuda="Uma automação faz sozinha o que a equipe esquece: marca a tarefa, distribui o negócio, avisa o gerente. Ela age quando o negócio é criado, muda de etapa, é ganho ou perdido, ou fica parado. Negócio parado é o que está aberto, sem mudança e sem tarefa futura marcada; a conferência roda de hora em hora. Uma automação não dispara outra."
        acao={
          podeGravar ? (
            <button type="button" className={juntar(botao.primario, "h-8")} onClick={abrirNova} disabled={cheio} title={cheio ? `O limite é de ${LIMITE_DE_AUTOMACOES} automações por empresa` : undefined} data-nova-automacao="">
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Nova
            </button>
          ) : undefined
        }
      >
        {automacoes.isLoading ? (
          <Carregando linhas={3} rotulo="Carregando as automações" />
        ) : automacoes.isError ? (
          <EstadoDeErro
            titulo="Não foi possível carregar as automações."
            acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void automacoes.refetch()}>Tentar de novo</button>}
          />
        ) : itens.length === 0 ? (
          <EstadoVazio
            icone={<Zap className="h-5 w-5" aria-hidden="true" />}
            titulo="Nenhuma automação ainda"
            descricao={podeGravar ? "Ligue uma receita pronta ou monte a sua." : "Quando o gerente criar uma, ela aparece aqui."}
            acao={podeGravar ? <button type="button" className={botao.secundario} onClick={abrirNova}>Montar a primeira</button> : undefined}
          />
        ) : (
          <ul className={juntar(lista.aberta, lista.divisoria)} data-lista-de-automacoes="">
            {itens.map((a) => (
              <li key={a.id} className={lista.linha} data-automacao={a.id} data-ativa={a.ativa ? "sim" : "nao"}>
                <span className={juntar("mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", a.ativa ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{ICONE_DA_ACAO[a.acao]}</span>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate font-medium", !a.ativa && "text-muted-foreground")}>{a.nome}</span>
                  <span className={juntar(texto.corpo, "block text-muted-foreground")} data-frase="">{fraseDaAutomacao(a, nomes, equipe)}</span>
                  <span className={juntar(texto.auxiliar, "mt-0.5 block truncate tabular-nums")}>
                    {a.execucoes === 0 ? "Ainda não rodou" : `${a.execucoes} ${a.execucoes === 1 ? "execução" : "execuções"}`}
                    {a.ultima_em ? `, a última em ${diaLegivel(a.ultima_em)}` : ""}
                  </span>
                </span>
                {podeGravar ? (
                  <>
                    <Switch
                      className="ml-3"
                      data-compacto=""
                      checked={a.ativa}
                      disabled={ocupada === a.id}
                      onCheckedChange={(v) => void alternar(a, v)}
                      aria-label={`${a.ativa ? "Desligar" : "Ligar"} a automação ${a.nome}`}
                    />
                    <MenuMais
                      className="ml-1"
                      rotulo={`Ações da automação ${a.nome}`}
                      itens={[
                        { rotulo: "Editar", icone: <Pencil className="h-4 w-4" aria-hidden="true" />, aoEscolher: () => abrirEdicao(a) },
                        { rotulo: "Excluir", icone: <Trash2 className="h-4 w-4" aria-hidden="true" />, aoEscolher: () => setSaindo(a), perigo: true },
                      ]}
                    />
                  </>
                ) : (
                  <span className={juntar(etiqueta, "ml-3", a.ativa ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{a.ativa ? "Ligada" : "Desligada"}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao
        titulo="Receitas prontas"
        descricao={automacoes.data ? (receitas.length === 0 ? "Todas ligadas" : `${receitas.length} para ligar`) : undefined}
        ajuda="Automações que servem para qualquer ramo, já com os nomes das etapas da sua empresa. Um clique liga; depois dá para editar o prazo, o texto ou a etapa na lista ao lado. A receita some daqui quando a empresa já tem uma automação igual."
      >
        {automacoes.isLoading ? (
          <Carregando linhas={4} rotulo="Carregando as receitas" />
        ) : automacoes.isError ? null : receitas.length === 0 ? (
          <EstadoVazio compacto titulo="Todas as receitas já estão na sua lista." />
        ) : (
          <ul className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1" data-receitas="">
            {receitas.map((receita) => (
              <li key={receita.id} className={juntar(superficie.painel, "flex min-w-0 items-center p-3")} data-receita={receita.id}>
                <span className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{ICONE_DA_ACAO[receita.acao]}</span>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate font-medium")}>{receita.nome}</span>
                  <span className={juntar(texto.auxiliar, "block")} title={receita.linha}>{fraseDaAutomacao(receita, nomes, equipe)}</span>
                </span>
                {podeGravar && (
                  <button
                    type="button"
                    className={juntar(botao.secundario, "ml-3 h-8")}
                    onClick={() => void ligarReceita(receita)}
                    disabled={!!ocupada || cheio}
                    aria-label={`Ligar a receita ${receita.nome}`}
                    data-ligar-receita=""
                  >
                    {ocupada === receita.id ? "Ligando..." : "Ligar"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <JanelaCentral
        aberta={aberto}
        onFechar={() => setAberto(false)}
        largura="md"
        titulo={editando ? "Editar automação" : "Nova automação"}
        ajuda="Três passos. Quando: o que acontece com o negócio. Se: em que caso vale (opcional). Então: o que o CRM faz sozinho. A frase no fim mostra a regra como a equipe vai ler."
        rodape={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setAberto(false)}>Cancelar</button>
            <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando} data-salvar-automacao="">
              {salvando ? "Salvando..." : editando ? "Salvar" : "Criar automação"}
            </button>
          </>
        }
        data-criador-de-automacao=""
      >
        <div className="min-w-0 space-y-6">
          <Passo numero={1} titulo="Quando">
            <CampoDeFormulario rotulo="O que acontece" largo={r.gatilho !== "negocio_parado"}>
              <select value={r.gatilho} onChange={(e) => trocarGatilho(e.target.value as GatilhoDaAutomacao)} className={campo} data-campo="gatilho">
                {GATILHOS.map((g) => <option key={g} value={g}>{NOME_DO_GATILHO[g]}</option>)}
              </select>
            </CampoDeFormulario>
            {r.gatilho === "negocio_parado" && (
              <CampoDeFormulario rotulo="Há quantos dias" ajuda={`De ${DIAS_PARADO.minimo} a ${DIAS_PARADO.maximo} dias sem mudança e sem tarefa futura marcada. Cada negócio recebe a ação uma vez a cada período.`}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={String(r.dias)}
                  onChange={(e) => mudar({ dias: soNumero(e.target.value) })}
                  onBlur={() => mudar({ dias: dentro(r.dias, DIAS_PARADO) })}
                  className={juntar(campo, "tabular-nums")}
                  data-campo="dias"
                />
              </CampoDeFormulario>
            )}
          </Passo>

          <Passo numero={2} titulo="Se">
            {etapasDaCondicao.length > 0 && (
              <CampoDeFormulario rotulo={ROTULO_DA_ETAPA[r.gatilho]}>
                <select value={r.etapa} onChange={(e) => mudar({ etapa: e.target.value as EtapaId | "" })} className={campo} data-campo="etapa">
                  <option value="">Qualquer etapa</option>
                  {etapasDaCondicao.map((id) => <option key={id} value={id}>{nomes[id]}</option>)}
                </select>
              </CampoDeFormulario>
            )}
            {aceitaSemDono(r.gatilho) ? (
              <label className={juntar("flex min-w-0 cursor-pointer items-center sm:h-9", etapasDaCondicao.length > 0 ? "sm:mt-[22px]" : "sm:col-span-full")}>
                <input type="checkbox" checked={r.semDono} onChange={(e) => mudar({ semDono: e.target.checked })} className={juntar("mr-2 h-4 w-4 shrink-0 rounded border-input accent-primary", foco)} data-campo="sem-dono" />
                <span className={juntar(texto.corpo, "min-w-0")}>Só negócio sem responsável</span>
              </label>
            ) : null}
          </Passo>

          <Passo numero={3} titulo="Então">
            <CampoDeFormulario rotulo="O que o CRM faz" largo>
              <select value={r.acao} onChange={(e) => mudar({ acao: e.target.value as AcaoDaAutomacao })} className={campo} data-campo="acao">
                {ACOES.map((a) => <option key={a} value={a}>{NOME_DA_ACAO[a]}</option>)}
              </select>
            </CampoDeFormulario>

            {r.acao === "criar_tarefa" && (
              <>
                <CampoDeFormulario rotulo="Título da tarefa" obrigatorio largo>
                  <input value={r.titulo} onChange={(e) => mudar({ titulo: e.target.value })} className={campo} maxLength={160} placeholder="Ligar para saber da proposta" data-campo="titulo" />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Tipo">
                  <select value={r.tipo} onChange={(e) => mudar({ tipo: e.target.value as TipoDeTarefa })} className={campo} data-campo="tipo">
                    {TIPOS_DE_TAREFA.map((t) => <option key={t} value={t}>{NOME_DO_TIPO[t]}</option>)}
                  </select>
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Prazo em dias" ajuda={`De ${PRAZO_DA_TAREFA.minimo} (no mesmo dia) a ${PRAZO_DA_TAREFA.maximo} dias. A tarefa vence às 9h e fica com o responsável pelo negócio.`}>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={String(r.emDias)}
                    onChange={(e) => mudar({ emDias: soNumero(e.target.value) })}
                    onBlur={() => mudar({ emDias: dentro(r.emDias, PRAZO_DA_TAREFA) })}
                    className={juntar(campo, "tabular-nums")}
                    data-campo="em-dias"
                  />
                </CampoDeFormulario>
              </>
            )}

            {r.acao === "atribuir_rodizio" && (
              <p className={juntar(texto.auxiliar, "leading-5 sm:col-span-full")}>Vai para o vendedor com menos negócios abertos.</p>
            )}

            {r.acao === "atribuir_membro" && (
              <CampoDeFormulario rotulo="Quem recebe" obrigatorio largo>
                <select value={r.userId} onChange={(e) => mudar({ userId: e.target.value })} className={campo} data-campo="pessoa">
                  <option value="">Escolha a pessoa</option>
                  {pessoaDeFora ? <option value={r.userId}>Pessoa que saiu da equipe</option> : null}
                  {ativos.map((m) => <option key={m.user_id || ""} value={m.user_id || ""}>{m.nome || "Sem nome"}</option>)}
                </select>
              </CampoDeFormulario>
            )}

            {r.acao === "mover_etapa" && (
              <CampoDeFormulario rotulo="Para a etapa" largo>
                <select value={r.para} onChange={(e) => mudar({ para: e.target.value as EtapaAberta })} className={campo} data-campo="para">
                  {ETAPAS_ABERTAS.map((id) => <option key={id} value={id}>{nomes[id]}</option>)}
                </select>
              </CampoDeFormulario>
            )}

            {r.acao === "avisar" && (
              <>
                <CampoDeFormulario rotulo="Quem recebe o aviso" largo ajuda="O aviso chega no sino do CRM. Sem gerente definido para o responsável, o aviso do gerente vai para quem administra a empresa.">
                  <select value={r.quem} onChange={(e) => mudar({ quem: e.target.value as QuemAvisar })} className={campo} data-campo="quem">
                    {QUEM_AVISAR.map((q) => <option key={q} value={q}>{NOME_DE_QUEM[q]}</option>)}
                  </select>
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Recado" largo apoio="Em branco, o aviso leva o nome do negócio">
                  <textarea value={r.texto} onChange={(e) => mudar({ texto: e.target.value })} className={campoTexto} maxLength={280} data-campo="texto" />
                </CampoDeFormulario>
              </>
            )}
          </Passo>

          <CampoDeFormulario rotulo="Nome da automação" ajuda="É como ela aparece na lista e, quando a ação é avisar, o título do aviso. Em branco, o CRM dá um nome.">
            <input value={r.nome} onChange={(e) => mudar({ nome: e.target.value })} className={campo} maxLength={80} placeholder={nomeSugerido(r, nomes, equipe)} data-campo="nome" />
          </CampoDeFormulario>

          <div className={juntar(superficie.poco, "min-w-0 p-3")} data-previa-da-automacao="">
            <p className={texto.rotulo}>Como a equipe lê</p>
            <p className={juntar(texto.corpo, "mt-1")}>{fraseDaAutomacao(previa, nomes, equipe)}</p>
            {erro ? <p className="mt-1.5 text-[12px] leading-4 text-destructive" role="status">{erro}</p> : null}
          </div>
        </div>
      </JanelaCentral>

      <JanelaCentral
        aberta={!!saindo}
        onFechar={() => setSaindo(null)}
        largura="sm"
        titulo={saindo ? `Excluir a automação ${saindo.nome}?` : "Excluir"}
        rodape={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setSaindo(null)}>Manter</button>
            <button
              type="button"
              className={botao.perigo}
              data-confirmar-exclusao=""
              onClick={() => {
                const a = saindo;
                setSaindo(null);
                if (a) void excluir(a);
              }}
            >
              Excluir
            </button>
          </>
        }
      >
        <p className={texto.corpo}>Ela para de agir agora. O que já fez nos negócios continua lá.</p>
      </JanelaCentral>
    </div>
  );
}
