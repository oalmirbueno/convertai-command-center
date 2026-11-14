import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Circle, Copy, Gauge, LayoutDashboard, Lock, MessageCircle, Pencil, Plus, Send, Trash2, Users, Webhook, X } from "lucide-react";
import { ROTULO_DO_PAPEL, ehGestor, fraseDoErro, type EstadoDoProduto } from "@/lib/produto/api";
import {
  DIAS_DA_SEMANA,
  LINHA_DO_MODO,
  NOME_DA_FAIXA,
  NOME_DO_ENVIO,
  PASSOS_DA_META,
  TEMPLATES_SUGERIDOS,
  ajustarCortes,
  bensDasRegras,
  chaveDaAtividade,
  chaveDaIntegracao,
  chaveDoTexto,
  chaveDosVendedores,
  conferir,
  destinoDoLead,
  ehOPadrao,
  enderecoDoWebhook,
  erroDasRegras,
  erroDoExpediente,
  faltaParaLigarDeVerdade,
  formatarExpediente,
  fraseDaSimulacao,
  idDaMetaValido,
  lerAtividade,
  lerFormularios,
  lerIntegracao,
  lerPrazos,
  lerRegras,
  lerVendedores,
  limparWhatsapp,
  linhaDoSegredo,
  nomeDaFaixaDeValor,
  nomeDaOpcao,
  nomeDeTemplateValido,
  prazoLegivel,
  regrasDoRamo,
  respostasDeExemplo,
  salvarIntegracao,
  salvarVendedor,
  segredoPareceValido,
  simularLead,
  simularNota,
  situacaoDaIntegracao,
  whatsappLegivel,
  whatsappValido,
  type ChaveDoTemplate,
  type Criterio,
  type Expediente,
  type Faixa,
  type Integracao,
  type ModoDaIntegracao,
  type MudancaDaIntegracao,
  type NomesDosTemplates,
  type ParteDaIntegracao,
  type RegrasDePontuacao,
  type Vendedor,
} from "@/lib/produto/integracoes";
import { Switch } from "@/components/ui/switch";
import { CabecalhoDePagina, CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, FaixaDeNumeros, GrupoDeCampos, JanelaCentral, Secao, SeletorCompacto, botao, campo, etiqueta, foco, juntar, lista, texto } from "@/components/sistema";
import { Foto } from "./pecas";

type Guardar = (dados: MudancaDaIntegracao, aviso: string) => Promise<boolean>;
interface DaParte {
  i: Integracao;
  guardar: Guardar;
  salvando: boolean;
  irPara: (p: ParteDaIntegracao) => void;
  nicho: string | undefined;
}

const copiar = (valor: string, oQue: string) => void navigator.clipboard.writeText(valor).then(() => toast.success(`${oQue}: copiado.`)).catch(() => toast.error("Não foi possível copiar."));

const quando = (iso: string): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const COR_DA_FAIXA: Record<Faixa, string> = { quente: "bg-primary/15 text-primary", morno: "bg-warning/15 text-warning", frio: "bg-muted text-muted-foreground" };
const COR_DO_ENVIO: Record<string, string> = { enviado: "bg-primary/15 text-primary", simulado: "bg-info/15 text-info", pendente: "bg-muted text-muted-foreground", erro: "bg-destructive/15 text-destructive" };
const caixinha = "h-4 w-4 shrink-0 accent-[hsl(var(--primary))]";

function BlocoDeCopia({ rotulo, valor, onde }: { rotulo: string; valor: string; onde?: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex min-w-0 items-center">
        <span className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>{rotulo}</span>
        <button type="button" className={botao.icone} onClick={() => copiar(valor, rotulo)} aria-label={`Copiar: ${rotulo}`} title="Copiar">
          <Copy className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <pre className="min-w-0 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-3 text-[12px] leading-5 text-foreground">{valor}</pre>
      {onde && <span className={juntar(texto.auxiliar, "mt-1 block leading-5")}>{onde}</span>}
    </div>
  );
}

/**
 * Campo de segredo: o valor salvo nunca volta do banco e nunca aparece. Com
 * segredo guardado, a tela mostra "Salvo, termina em XXXX" e o botão Trocar.
 */
function CampoSecreto({ rotulo, tem, final, valor, onMudar, ajuda, semValor, nome }: { rotulo: string; tem: boolean; final?: string | null; valor: string; onMudar: (v: string) => void; ajuda?: ReactNode; semValor?: string; nome: string }) {
  const [trocando, setTrocando] = useState(false);
  if (tem && !trocando) {
    return (
      <CampoDeFormulario rotulo={rotulo} ajuda={ajuda}>
        <div className="flex h-9 min-w-0 items-center" data-segredo={nome} data-segredo-salvo="">
          <Lock className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{linhaDoSegredo(tem, final)}</span>
          <button type="button" className={juntar(botao.secundario, "ml-2 h-8")} onClick={() => setTrocando(true)} aria-label={`Trocar: ${rotulo}`}>Trocar</button>
        </div>
      </CampoDeFormulario>
    );
  }
  const ruim = valor.trim() !== "" && !segredoPareceValido(valor);
  return (
    <CampoDeFormulario rotulo={rotulo} ajuda={ajuda} erro={ruim ? "Não parece inteiro. Copie de novo, sem espaços." : undefined} apoio={tem ? "Cole o novo. O antigo vale até você salvar." : semValor || "Fica no cofre. Ninguém vê de novo, nem você."}>
      <input className={campo} type="password" value={valor} onChange={(e) => onMudar(e.target.value)} maxLength={600} autoComplete="off" spellCheck={false} placeholder="Cole aqui" data-segredo={nome} />
    </CampoDeFormulario>
  );
}

function BarraDeSalvar({ mudou, salvando, onSalvar, impedimento, nome }: { mudou: boolean; salvando: boolean; onSalvar: () => void; impedimento?: string | null; nome: string }) {
  return (
    <div className="flex min-w-0 items-center">
      <button type="button" className={botao.primario} onClick={onSalvar} disabled={salvando || !mudou || !!impedimento} data-salvar={nome}>{salvando ? "Salvando..." : "Salvar"}</button>
      {impedimento && <span className={juntar(texto.auxiliar, "ml-3 min-w-0 flex-1 truncate text-destructive")} title={impedimento}>{impedimento}</span>}
    </div>
  );
}

// ------------------------------------------------------------------ visão

const NOME_DA_SITUACAO = { desligada: "Desligada", teste: "Ligada em teste", real: "Ligada de verdade" } as const;

function Visao({ i, guardar, salvando, irPara, nicho }: DaParte) {
  const qc = useQueryClient();
  const vendedores = useQuery({ queryKey: chaveDosVendedores, queryFn: lerVendedores });
  const atividade = useQuery({ queryKey: chaveDaAtividade, queryFn: () => lerAtividade(30) });
  const [confirmando, setConfirmando] = useState<{ ativo: boolean; modo: ModoDaIntegracao } | null>(null);
  const [faltando, setFaltando] = useState(false);
  const [faixa, setFaixa] = useState<Faixa>("quente");
  const [bem, setBem] = useState("");
  const [simulando, setSimulando] = useState(false);
  const itens = conferir(i, vendedores.data || null);
  const feitos = itens.filter((x) => x.feito).length;
  const bens = bensDasRegras(lerRegras(i.pontuacao, nicho));
  const situacao = situacaoDaIntegracao(i);

  const pedir = (ativo: boolean, modo: ModoDaIntegracao) => {
    if (ativo && modo === "real" && situacao !== "real") {
      if (faltaParaLigarDeVerdade(i).length) setFaltando(true);
      else setConfirmando({ ativo, modo });
      return;
    }
    void guardar({ ativo, modo }, !ativo ? (i.ativo ? "Integração desligada." : "Modo guardado. A integração continua desligada.") : "Integração ligada em modo teste.");
  };

  const simular = async () => {
    setSimulando(true);
    try {
      // O simulador precisa da conexão aberta (ela nasce desligada e em teste): abre na primeira vez.
      if (!i.existe) qc.setQueryData(chaveDaIntegracao, await salvarIntegracao({}));
      const r = await simularLead({ faixa, ...(bem ? { bem } : {}) });
      toast.success(fraseDaSimulacao(r));
      await Promise.all([qc.invalidateQueries({ queryKey: chaveDaAtividade }), qc.invalidateQueries({ queryKey: chaveDaIntegracao, exact: true })]);
    } catch (e) {
      toast.error(e instanceof Error && e.name === "ErroDoSimulador" ? e.message : fraseDoErro(e, "Não foi possível simular agora."));
    } finally {
      setSimulando(false);
    }
  };

  const a = atividade.data;
  return (
    <div className="min-w-0 space-y-8" data-parte="visao">
      <Secao
        titulo="Integração"
        recolher={false}
        ajuda="Ligada, cada pessoa que preenche o formulário da Meta entra no CRM, ganha nota, vai para o vendedor do rodízio e recebe a primeira mensagem do número da empresa. Desligada, o CRM recebe o aviso da Meta e não faz nada."
        data-chave-geral={situacao}
      >
        <div className="flex min-w-0 items-center">
          <Switch
            className="h-8 w-[60px] [&>span]:h-7 [&>span]:w-7 [&[data-state=checked]>span]:translate-x-7"
            data-compacto=""
            checked={i.ativo}
            disabled={salvando}
            onCheckedChange={(v) => pedir(v, i.modo)}
            aria-label={i.ativo ? "Desligar a integração" : "Ligar a integração"}
          />
          <span className="ml-4 min-w-0 flex-1">
            <span className={juntar(texto.tituloSecao, "block truncate")}>{NOME_DA_SITUACAO[situacao]}</span>
            <span className={juntar(texto.auxiliar, "block leading-5")}>{LINHA_DO_MODO[i.modo]}</span>
          </span>
        </div>
        <div className="mt-4 flex min-w-0 items-center">
          <span className={juntar(texto.rotulo, "mr-3 shrink-0")}>Modo</span>
          <SeletorCompacto
            rotulo="Modo da integração"
            opcoes={[{ valor: "teste", rotulo: "Teste" }, { valor: "real", rotulo: "De verdade" }]}
            valor={i.modo}
            onEscolher={(m) => m !== i.modo && pedir(i.ativo, m as ModoDaIntegracao)}
          />
        </div>
        {i.ultimo_erro && <span className={juntar(texto.auxiliar, "mt-3 block leading-5 text-destructive")} role="alert" data-ultimo-erro="">Último erro: {i.ultimo_erro}</span>}
      </Secao>

      <FaixaDeNumeros
        rotulo="Números da integração"
        colunas={5}
        data-numeros-da-integracao=""
        itens={[
          { rotulo: "Leads em 7 dias", valor: i.numeros.leads_7_dias },
          { rotulo: "Na fila", valor: i.numeros.na_fila, apoio: "esperando vendedor" },
          { rotulo: "Em nutrição", valor: i.numeros.em_nutricao },
          { rotulo: "Envios pendentes", valor: i.numeros.envios_pendentes },
          { rotulo: "Envios com erro", valor: i.numeros.envios_com_erro, corDoValor: i.numeros.envios_com_erro > 0 ? "text-destructive" : undefined, apoio: "em 7 dias" },
        ]}
      />

      <div className="grid min-w-0 grid-cols-1 items-start gap-x-10 gap-y-8 xl:grid-cols-2">
        <Secao titulo="O que falta conectar" descricao={`${feitos} de ${itens.length}`} ajuda="Os três primeiros são obrigatórios para ligar de verdade. Os outros fazem o WhatsApp falar com o lead e avisar o vendedor. Em modo teste dá para simular sem nenhum deles." data-conferencia="">
          <ul className={lista.aberta}>
            {itens.map((x) => (
              <li key={x.chave}>
                <button type="button" className={juntar(lista.linha, foco, "w-full text-left")} onClick={() => irPara(x.parte)} data-item-da-conferencia={x.chave} data-feito={x.feito ? "sim" : "nao"}>
                  {x.feito ? <Check className="mr-2.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <Circle className="mr-2.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate", x.feito && "text-muted-foreground")}>{x.rotulo}</span>
                  <span className={juntar(texto.auxiliar, "ml-2 shrink-0")}>{x.feito ? "Pronto" : x.obrigatorio ? "Falta" : "Recomendado"}</span>
                </button>
              </li>
            ))}
          </ul>
        </Secao>

        <Secao titulo="Simular um lead" ajuda="Cria um lead de teste pelo mesmo caminho do lead de verdade: nota, rodízio, fila ou nutrição e as mensagens, marcadas como simuladas. Nada sai para a Meta nem para o WhatsApp. O negócio de teste aparece no funil e pode ser apagado depois." data-simulador-de-lead="">
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <CampoDeFormulario rotulo="Como ele chega">
              <select className={campo} value={faixa} onChange={(e) => setFaixa(e.target.value as Faixa)} data-faixa-da-simulacao="">
                <option value="quente">Quente</option>
                <option value="morno">Morno</option>
                <option value="frio">Frio</option>
              </select>
            </CampoDeFormulario>
            {bens.length > 0 && (
              <CampoDeFormulario rotulo="Tipo de bem">
                <select className={campo} value={bem} onChange={(e) => setBem(e.target.value)}>
                  <option value="">Qualquer um</option>
                  {bens.map((b) => (
                    <option key={b} value={b}>{nomeDaOpcao(b)}</option>
                  ))}
                </select>
              </CampoDeFormulario>
            )}
          </div>
          <button type="button" className={juntar(botao.secundario, "mt-3")} onClick={() => void simular()} disabled={simulando} data-simular-lead="">
            <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {simulando ? "Simulando..." : "Simular um lead"}
          </button>
        </Secao>
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-x-10 gap-y-8 xl:grid-cols-2" data-atividade-recente="">
        <Secao titulo="Leads que entraram" descricao={a ? `${a.leads.length} mais recentes` : undefined}>
          {atividade.isLoading ? (
            <Carregando linhas={3} rotulo="Carregando os leads" />
          ) : atividade.isError ? (
            <EstadoDeErro acao={<button type="button" className={botao.secundario} onClick={() => void atividade.refetch()}>Tentar de novo</button>} />
          ) : !a || a.leads.length === 0 ? (
            <EstadoVazio compacto icone={<Webhook className="h-5 w-5" aria-hidden="true" />} titulo="Nenhum lead ainda." descricao="Simule um para ver o caminho." />
          ) : (
            <ul className={juntar(lista.aberta, lista.divisoria)}>
              {a.leads.map((l) => (
                <li key={l.id} className={lista.linha} data-lead-da-meta={l.situacao}>
                  <span className="min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate font-medium")}>{l.nome || "Lead da Meta"}</span>
                    <span className={juntar(texto.auxiliar, "block truncate", l.situacao === "erro" && "text-destructive")} title={l.erro || undefined}>
                      {quando(l.criado_em)} · {destinoDoLead(l)}
                      {l.campanha ? ` · ${l.campanha}` : ""}
                    </span>
                  </span>
                  {l.de_teste && <span className={juntar(etiqueta, "ml-2 bg-muted text-muted-foreground")}>Teste</span>}
                  {l.faixa && <span className={juntar(etiqueta, "ml-2", COR_DA_FAIXA[l.faixa])}>{NOME_DA_FAIXA[l.faixa]}{l.nota !== null ? ` ${l.nota}` : ""}</span>}
                </li>
              ))}
            </ul>
          )}
        </Secao>
        <Secao titulo="Mensagens" descricao={a ? `${a.envios.length} mais recentes` : undefined}>
          {atividade.isLoading ? (
            <Carregando linhas={3} rotulo="Carregando as mensagens" />
          ) : atividade.isError ? (
            <EstadoDeErro />
          ) : !a || a.envios.length === 0 ? (
            <EstadoVazio compacto icone={<MessageCircle className="h-5 w-5" aria-hidden="true" />} titulo="Nenhuma mensagem ainda." />
          ) : (
            <ul className={juntar(lista.aberta, lista.divisoria)}>
              {a.envios.map((e) => (
                <li key={e.id} className={lista.linha} data-envio={e.situacao}>
                  <span className="min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate")}>{e.destino === "vendedor" ? "Para o vendedor" : "Para o lead"}{e.resumo ? ` · ${e.resumo}` : ""}</span>
                    <span className={juntar(texto.auxiliar, "block truncate", e.situacao === "erro" && "text-destructive")} title={e.erro || undefined}>
                      {quando(e.criado_em)}
                      {e.erro ? ` · ${e.erro}` : ""}
                    </span>
                  </span>
                  <span className={juntar(etiqueta, "ml-2", COR_DO_ENVIO[e.situacao])}>{NOME_DO_ENVIO[e.situacao]}</span>
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </div>

      <JanelaCentral
        aberta={!!confirmando}
        onFechar={() => setConfirmando(null)}
        largura="sm"
        titulo="Ligar de verdade?"
        rodape={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setConfirmando(null)}>Continuar em teste</button>
            <button
              type="button"
              className={botao.primario}
              data-confirmar-de-verdade=""
              onClick={() => {
                const c = confirmando;
                setConfirmando(null);
                if (c) void guardar(c, "Integração ligada de verdade.");
              }}
            >
              Ligar de verdade
            </button>
          </>
        }
      >
        <span className={juntar(texto.corpo, "block")}>A partir de agora, quem preencher o formulário da Meta recebe mensagem do número da empresa e os vendedores são avisados no WhatsApp deles.</span>
      </JanelaCentral>

      <JanelaCentral
        aberta={faltando}
        onFechar={() => setFaltando(false)}
        largura="sm"
        titulo="Ainda falta conectar a Meta"
        rodape={
          <button
            type="button"
            className={botao.primario}
            onClick={() => {
              setFaltando(false);
              irPara("meta");
            }}
          >
            Conectar a Meta
          </button>
        }
      >
        <span className={juntar(texto.corpo, "block")}>Para ligar de verdade, falta:</span>
        <ul className="mt-2 min-w-0 space-y-1" data-falta-para-ligar="">
          {faltaParaLigarDeVerdade(i).map((x) => (
            <li key={x.chave} className={juntar(texto.corpo, "flex min-w-0 items-center")}>
              <Circle className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              {x.rotulo}
            </li>
          ))}
        </ul>
      </JanelaCentral>
    </div>
  );
}

// ------------------------------------------------------------------ Meta

function ParteMeta({ i, guardar, salvando }: DaParte) {
  const [pagina, setPagina] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [segredo, setSegredo] = useState("");
  const [formularios, setFormularios] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const paginaAtual = pagina !== null ? pagina : i.pagina_id || "";
  const formulariosAtuais = formularios !== null ? formularios : i.formularios.join("\n");
  const aceitos = lerFormularios(formulariosAtuais);
  const endereco = enderecoDoWebhook(i.webhook_chave);
  const mudou = pagina !== null || formularios !== null || token.trim() !== "" || segredo.trim() !== "";
  const impedimento = !idDaMetaValido(paginaAtual)
    ? "O ID da Página tem só números."
    : (token.trim() && !segredoPareceValido(token)) || (segredo.trim() && !segredoPareceValido(segredo))
      ? "Confira o que foi colado."
      : null;

  const salvar = async () => {
    const ok = await guardar(
      { pagina_id: paginaAtual.trim(), formularios: aceitos, ...(token.trim() ? { token: token.trim() } : {}), ...(segredo.trim() ? { app_secret: segredo.trim() } : {}) },
      "Conexão com a Meta salva.",
    );
    if (!ok) return;
    setPagina(null);
    setFormularios(null);
    setToken("");
    setSegredo("");
    setVersao((v) => v + 1);
  };

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]" data-parte="meta">
      <Secao
        titulo="Passo a passo"
        recolher={false}
        ajuda="É o modo manual: a sua empresa cria o próprio app na Meta e cola os dados aqui. Leva uns 15 minutos e não depende de aprovação da Meta, porque o app só lê os leads da sua própria Página."
      >
        <ol className="min-w-0 space-y-2.5" data-passos-da-meta="">
          {PASSOS_DA_META.map((p, n) => (
            <li key={p} className="flex min-w-0 items-start">
              <span className="mr-2.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{n + 1}</span>
              <span className={juntar(texto.corpo, "min-w-0")}>{p}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5 min-w-0 space-y-4" data-webhook-da-empresa="">
          {endereco && i.verify_token ? (
            <>
              <BlocoDeCopia rotulo="Endereço do webhook" valor={endereco} onde="No passo 2, no campo URL de retorno de chamada." />
              <BlocoDeCopia rotulo="Token de verificação" valor={i.verify_token} onde="No passo 2, no campo Verificar token." />
            </>
          ) : (
            <div className="flex min-w-0 items-center">
              <button type="button" className={botao.secundario} onClick={() => void guardar({}, "Endereço criado.")} disabled={salvando} data-gerar-endereco="">Gerar o endereço do webhook</button>
              <span className={juntar(texto.auxiliar, "ml-3 min-w-0 flex-1 truncate")}>Cada empresa tem o seu.</span>
            </div>
          )}
        </div>
      </Secao>

      <Secao titulo="Dados da Meta" recolher={false} descricao={faltaParaLigarDeVerdade(i).length === 0 ? "Conectada" : `Faltam ${faltaParaLigarDeVerdade(i).length} de 3`}>
        <div className="min-w-0 space-y-3">
          <CampoDeFormulario rotulo="ID da Página" apoio="Só números. Fica em Sobre, na Página do Facebook." erro={!idDaMetaValido(paginaAtual) ? "Esse ID tem só números. Copie de novo na Meta." : undefined}>
            <input className={campo} value={paginaAtual} onChange={(e) => setPagina(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" maxLength={25} autoComplete="off" data-id-da-pagina="" />
          </CampoDeFormulario>
          <CampoSecreto key={`t${versao}`} nome="token" rotulo="Token do usuário do sistema" tem={i.tem_token} final={i.token_final} valor={token} onMudar={setToken} />
          <CampoSecreto key={`s${versao}`} nome="app_secret" rotulo="Segredo do app" tem={i.tem_app_secret} valor={segredo} onMudar={setSegredo} ajuda="Com ele o CRM confere que cada aviso veio mesmo da Meta. Aviso sem a assinatura certa é recusado." />
          <CampoDeFormulario
            rotulo="Formulários aceitos"
            apoio={aceitos.length === 0 ? "Vazio: todos os formulários da Página entram." : `${aceitos.length} ${aceitos.length === 1 ? "formulário aceito" : "formulários aceitos"}.`}
            ajuda="Cole o ID de cada formulário de cadastro, um por linha. O ID aparece na Central de Anúncios, em Formulários instantâneos. Com a lista vazia, qualquer formulário da Página vira lead no CRM."
          >
            <textarea className={juntar(campo, "h-auto min-h-[72px] py-2 leading-5")} value={formulariosAtuais} onChange={(e) => setFormularios(e.target.value.replace(/[^0-9\s,;]/g, ""))} rows={3} inputMode="numeric" autoComplete="off" data-formularios-aceitos="" />
          </CampoDeFormulario>
          <BarraDeSalvar nome="meta" mudou={mudou} salvando={salvando} onSalvar={() => void salvar()} impedimento={impedimento} />
        </div>
      </Secao>
    </div>
  );
}

// ------------------------------------------------------------------ WhatsApp

const IDIOMAS = [
  { valor: "pt_BR", rotulo: "Português (Brasil)" },
  { valor: "pt_PT", rotulo: "Português (Portugal)" },
  { valor: "es", rotulo: "Espanhol" },
  { valor: "en_US", rotulo: "Inglês" },
];
const NOME_DO_PRAZO = ["Primeiro lembrete", "Segundo lembrete", "Terceiro lembrete"];

function ParteWhatsapp({ i, guardar, salvando }: DaParte) {
  const [telefoneId, setTelefoneId] = useState<string | null>(null);
  const [contaId, setContaId] = useState<string | null>(null);
  const [numero, setNumero] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [idioma, setIdioma] = useState<string | null>(null);
  const [nomes, setNomes] = useState<NomesDosTemplates | null>(null);
  const [prazos, setPrazos] = useState<string[] | null>(null);
  const [versao, setVersao] = useState(0);
  const telefoneAtual = telefoneId !== null ? telefoneId : i.wa_phone_id || "";
  const contaAtual = contaId !== null ? contaId : i.wa_waba_id || "";
  const numeroAtual = numero !== null ? numero : i.wa_numero || "";
  const nomesAtuais = nomes !== null ? nomes : i.templates;
  const prazosAtuais = prazos !== null ? prazos : [0, 1, 2].map((n) => (i.followup_horas[n] ? String(i.followup_horas[n]) : ""));
  const horas = lerPrazos(prazosAtuais);
  const mudou = telefoneId !== null || contaId !== null || numero !== null || idioma !== null || nomes !== null || prazos !== null || token.trim() !== "";
  const nomeRuim = TEMPLATES_SUGERIDOS.some((t) => !nomeDeTemplateValido(nomesAtuais[t.chave] || ""));
  const impedimento = !idDaMetaValido(telefoneAtual) || !idDaMetaValido(contaAtual)
    ? "Os IDs têm só números."
    : token.trim() && !segredoPareceValido(token)
      ? "Confira o token colado."
      : nomeRuim
        ? "Nome de template: minúsculas, números e sublinhado."
        : prazosAtuais.some((p) => p.trim() !== "" && lerPrazos([p]).length === 0)
          ? "Prazo de 1 a 240 horas."
          : null;

  const salvar = async () => {
    const templates: NomesDosTemplates = {};
    TEMPLATES_SUGERIDOS.forEach((t) => {
      const v = (nomesAtuais[t.chave] || "").trim();
      if (v) templates[t.chave] = v;
    });
    const ok = await guardar(
      { wa_phone_id: telefoneAtual.trim(), wa_waba_id: contaAtual.trim(), wa_numero: numeroAtual.trim(), idioma: idioma || i.idioma, templates, followup_horas: horas, ...(token.trim() ? { wa_token: token.trim() } : {}) },
      "WhatsApp salvo.",
    );
    if (!ok) return;
    setTelefoneId(null);
    setContaId(null);
    setNumero(null);
    setIdioma(null);
    setNomes(null);
    setPrazos(null);
    setToken("");
    setVersao((v) => v + 1);
  };

  const mudarNome = (chave: ChaveDoTemplate, v: string) => setNomes({ ...nomesAtuais, [chave]: v.toLowerCase().replace(/[^a-z0-9_]/g, "") });

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-x-10 gap-y-8 xl:grid-cols-2" data-parte="whatsapp">
      <div className="min-w-0 space-y-8">
        <Secao
          titulo="Número da empresa"
          recolher={false}
          ajuda="É o número oficial da empresa na API do WhatsApp (Cloud API). Os dois IDs ficam no Gerenciador do WhatsApp, em Configuração da API. Esse número faz as perguntas ao lead e manda os avisos aos vendedores."
        >
          <GrupoDeCampos>
            <CampoDeFormulario rotulo="ID do número de telefone" erro={!idDaMetaValido(telefoneAtual) ? "Só números." : undefined}>
              <input className={campo} value={telefoneAtual} onChange={(e) => setTelefoneId(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" maxLength={25} autoComplete="off" data-id-do-numero="" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="ID da conta do WhatsApp" erro={!idDaMetaValido(contaAtual) ? "Só números." : undefined}>
              <input className={campo} value={contaAtual} onChange={(e) => setContaId(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" maxLength={25} autoComplete="off" data-id-da-conta-do-whatsapp="" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Número (para a equipe reconhecer)" apoio={numeroAtual ? whatsappLegivel(limparWhatsapp(numeroAtual)) : "Com DDD, como 41 99999-0000."}>
              <input className={campo} value={numeroAtual} onChange={(e) => setNumero(e.target.value.replace(/[^0-9 ()+-]/g, ""))} inputMode="tel" maxLength={24} autoComplete="off" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Idioma dos templates">
              <select className={campo} value={idioma || i.idioma} onChange={(e) => setIdioma(e.target.value)}>
                {IDIOMAS.concat(IDIOMAS.some((x) => x.valor === i.idioma) ? [] : [{ valor: i.idioma, rotulo: i.idioma }]).map((x) => (
                  <option key={x.valor} value={x.valor}>{x.rotulo}</option>
                ))}
              </select>
            </CampoDeFormulario>
          </GrupoDeCampos>
          <div className="mt-3 min-w-0">
            <CampoSecreto
              key={`w${versao}`}
              nome="wa_token"
              rotulo="Token do WhatsApp"
              tem={i.tem_wa_token}
              final={i.wa_token_final}
              valor={token}
              onMudar={setToken}
              semValor={i.tem_token ? "Vazio: usa o mesmo token da Meta." : "Vazio: usa o token da Meta, quando ele for salvo."}
              ajuda="Pode ser o mesmo token do usuário do sistema, desde que ele tenha também whatsapp_business_messaging e whatsapp_business_management e acesso à conta do WhatsApp. Cole outro aqui só se a empresa usa tokens separados."
            />
          </div>
        </Secao>

        <Secao titulo="Templates e lembretes" recolher={false} ajuda="Fora da janela de 24 horas, o WhatsApp só deixa mandar template aprovado. Crie cada um no Gerenciador do WhatsApp com o texto ao lado, espere a aprovação e escreva aqui o nome exato. Sem o nome, aquela mensagem não é enviada.">
          <GrupoDeCampos>
            {TEMPLATES_SUGERIDOS.map((t) => (
              <CampoDeFormulario key={t.chave} rotulo={t.rotulo} erro={!nomeDeTemplateValido(nomesAtuais[t.chave] || "") ? "Minúsculas, números e sublinhado." : undefined}>
                <input className={campo} value={nomesAtuais[t.chave] || ""} onChange={(e) => mudarNome(t.chave, e.target.value)} maxLength={120} autoComplete="off" spellCheck={false} placeholder={t.nome} data-nome-do-template={t.chave} />
              </CampoDeFormulario>
            ))}
          </GrupoDeCampos>
          <GrupoDeCampos colunas={3} className="mt-4">
            {NOME_DO_PRAZO.map((nome, n) => (
              <CampoDeFormulario key={nome} rotulo={`${nome} (horas)`} apoio={lerPrazos([prazosAtuais[n]]).length ? `${prazoLegivel(lerPrazos([prazosAtuais[n]])[0])} sem resposta` : "Vazio: não manda"}>
                <input className={campo} value={prazosAtuais[n]} onChange={(e) => setPrazos(prazosAtuais.map((p, k) => (k === n ? e.target.value.replace(/[^0-9]/g, "").slice(0, 3) : p)))} inputMode="numeric" autoComplete="off" data-prazo-de-followup={n} />
              </CampoDeFormulario>
            ))}
          </GrupoDeCampos>
          <div className="mt-4">
            <BarraDeSalvar nome="whatsapp" mudou={mudou} salvando={salvando} onSalvar={() => void salvar()} impedimento={impedimento} />
          </div>
        </Secao>
      </div>

      {/* A lista é a do servidor (templatesNecessarios em supabase/functions/_shared/whatsapp-do-crm.ts), lida por
          TEMPLATES_SUGERIDOS em src/lib/produto/integracoes.ts: mudar um texto é só lá. */}
      <Secao titulo="Textos para criar os templates" ajuda="Copie cada texto para um template novo no Gerenciador do WhatsApp, com o mesmo nome, a mesma categoria e os botões de resposta rápida na ordem indicada. Os números entre chaves são preenchidos pelo CRM na hora de enviar." data-templates-sugeridos="">
        <div className="min-w-0 space-y-6">
          {TEMPLATES_SUGERIDOS.map((t) => (
            <div key={t.chave} className="min-w-0" data-template-sugerido={t.chave}>
              <div className="mb-1 flex min-w-0 items-center">
                <span className={juntar(texto.corpo, "min-w-0 truncate font-medium")}>{t.rotulo}</span>
                <span className={juntar(etiqueta, "ml-2", t.obrigatorio ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>{t.obrigatorio ? "Necessário" : "Opcional"}</span>
              </div>
              <BlocoDeCopia rotulo={`Nome: ${t.nome} · ${t.categoria}`} valor={t.texto} onde={t.variaveis.map((v, n) => `{{${n + 1}}} ${v}`).join(" · ")} />
              {t.botoes.length > 0 && <span className={juntar(texto.auxiliar, "mt-1 block leading-5")} data-botoes-do-template="">Botões, nesta ordem: {t.botoes.join(" · ")}</span>}
              {t.observacao && <span className={juntar(texto.auxiliar, "mt-1 block leading-5")}>{t.observacao}</span>}
            </div>
          ))}
        </div>
      </Secao>
    </div>
  );
}

// ------------------------------------------------------------------ pontuação

const numeroDoCampo = (v: string, max: number): number => Math.max(0, Math.min(max, Math.round(Number(v.replace(/[^0-9]/g, "")) || 0)));
const campoCurto = juntar(campo, "w-20 shrink-0 text-right tabular-nums");

function EditorDeCriterio({ criterio, onMudar, onTirar }: { criterio: Criterio; onMudar: (c: Criterio) => void; onTirar: () => void }) {
  const [nova, setNova] = useState("");
  const chaveNova = chaveDoTexto(nova);
  return (
    <li className="min-w-0 py-4 first:pt-0" data-criterio={criterio.campo}>
      <div className="mb-2 flex min-w-0 items-center">
        <input className={juntar(campo, "min-w-0 flex-1 font-medium")} value={criterio.rotulo} onChange={(e) => onMudar({ ...criterio, rotulo: e.target.value.slice(0, 40) })} aria-label={`Nome do critério ${criterio.rotulo}`} />
        <span className={juntar(texto.auxiliar, "ml-3 hidden shrink-0 sm:block")}>{criterio.tipo === "faixa" ? "Por valor" : "Por opção"}</span>
        <button type="button" className={juntar(botao.icone, "ml-1")} onClick={onTirar} aria-label={`Tirar o critério ${criterio.rotulo}`} title="Tirar o critério">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {criterio.tipo === "opcao" ? (
        <>
          <ul className="min-w-0 space-y-1.5">
            {Object.keys(criterio.pontos).map((k) => {
              const naNutricao = !!criterio.nutricao && criterio.nutricao.indexOf(k) >= 0;
              return (
                <li key={k} className="flex min-w-0 items-center" data-opcao={k}>
                  <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{nomeDaOpcao(k)}</span>
                  <label className={juntar(texto.auxiliar, "ml-2 flex shrink-0 items-center")} title="Quem responde isto vai para a nutrição, qualquer que seja a nota">
                    <input
                      type="checkbox"
                      className={juntar(caixinha, "mr-1.5")}
                      checked={naNutricao}
                      onChange={(e) => {
                        const marcadas = (criterio.nutricao || []).filter((x) => x !== k).concat(e.target.checked ? [k] : []);
                        const { nutricao: _fora, ...resto } = criterio;
                        onMudar(marcadas.length ? { ...resto, nutricao: marcadas } : resto);
                      }}
                      data-manda-para-nutricao={k}
                    />
                    Nutrição
                  </label>
                  <input className={juntar(campoCurto, "ml-3")} value={String(criterio.pontos[k])} onChange={(e) => onMudar({ ...criterio, pontos: { ...criterio.pontos, [k]: numeroDoCampo(e.target.value, 100) } })} inputMode="numeric" aria-label={`Pontos de ${nomeDaOpcao(k)}`} data-pontos={k} />
                  <button
                    type="button"
                    className={juntar(botao.icone, "ml-1")}
                    onClick={() => {
                      const pontos = { ...criterio.pontos };
                      delete pontos[k];
                      const { nutricao, ...resto } = criterio;
                      const sobra = (nutricao || []).filter((x) => x !== k);
                      onMudar({ ...resto, pontos, ...(sobra.length ? { nutricao: sobra } : {}) });
                    }}
                    aria-label={`Tirar a opção ${nomeDaOpcao(k)}`}
                    title="Tirar"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex min-w-0 items-center">
            <input className={juntar(campo, "min-w-0 flex-1")} value={nova} onChange={(e) => setNova(e.target.value.slice(0, 40))} placeholder="Nova opção" aria-label={`Nova opção de ${criterio.rotulo}`} />
            <button
              type="button"
              className={juntar(botao.discreto, "ml-1 h-8")}
              disabled={!chaveNova || chaveNova in criterio.pontos || Object.keys(criterio.pontos).length >= 16}
              onClick={() => {
                onMudar({ ...criterio, pontos: { ...criterio.pontos, [chaveNova]: 0 } });
                setNova("");
              }}
            >
              Adicionar
            </button>
          </div>
        </>
      ) : (
        <>
          <ul className="min-w-0 space-y-1.5">
            {criterio.faixas.map((f, n) => (
              <li key={n} className="flex min-w-0 items-center" data-faixa-de-valor={n}>
                {f.ate === undefined ? (
                  <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{nomeDaFaixaDeValor(criterio.faixas, n)}</span>
                ) : (
                  <span className="flex min-w-0 flex-1 items-center">
                    <span className={juntar(texto.corpo, "mr-2 shrink-0")}>Até</span>
                    <input
                      className={juntar(campo, "w-32 min-w-0 text-right tabular-nums")}
                      value={String(f.ate)}
                      onChange={(e) => onMudar({ ...criterio, faixas: criterio.faixas.map((x, k) => (k === n ? { ...x, ate: numeroDoCampo(e.target.value, 999999999) } : x)) })}
                      inputMode="numeric"
                      aria-label={`Limite da faixa ${n + 1} de ${criterio.rotulo}`}
                    />
                  </span>
                )}
                <input className={juntar(campoCurto, "ml-3")} value={String(f.pontos)} onChange={(e) => onMudar({ ...criterio, faixas: criterio.faixas.map((x, k) => (k === n ? { ...x, pontos: numeroDoCampo(e.target.value, 100) } : x)) })} inputMode="numeric" aria-label={`Pontos de ${nomeDaFaixaDeValor(criterio.faixas, n)}`} />
                <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => onMudar({ ...criterio, faixas: criterio.faixas.filter((_, k) => k !== n) })} disabled={criterio.faixas.length <= 1} aria-label={`Tirar a faixa ${nomeDaFaixaDeValor(criterio.faixas, n)}`} title="Tirar">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={juntar(botao.discreto, "relative -left-2 mt-1 h-8")}
            disabled={criterio.faixas.length >= 8}
            onClick={() => {
              const comLimite = criterio.faixas.filter((f) => f.ate !== undefined);
              const aberta = criterio.faixas.filter((f) => f.ate === undefined);
              const ultimo = comLimite.length ? (comLimite[comLimite.length - 1].ate as number) : 0;
              onMudar({ ...criterio, faixas: comLimite.concat([{ ate: ultimo > 0 ? ultimo * 2 : 1000, pontos: 0 }]).concat(aberta.length ? aberta : [{ pontos: 0 }]) });
            }}
          >
            Adicionar faixa
          </button>
        </>
      )}
    </li>
  );
}

function PartePontuacao({ i, guardar, salvando, nicho }: DaParte) {
  const salvas = useMemo(() => lerRegras(i.pontuacao, nicho), [i.pontuacao, nicho]);
  const [rascunho, setRascunho] = useState<RegrasDePontuacao | null>(null);
  const [respostas, setRespostas] = useState<Record<string, string | number>>({});
  const [novo, setNovo] = useState<{ rotulo: string; tipo: "opcao" | "faixa" } | null>(null);
  const regras = rascunho || salvas;
  const mudou = rascunho !== null && JSON.stringify(rascunho) !== JSON.stringify(salvas);
  const impedimento = erroDasRegras(regras);
  const nota = simularNota(respostas, regras);
  const noPadrao = ehOPadrao(regras, nicho);
  const campoNovo = novo ? chaveDoTexto(novo.rotulo) : "";
  const novoRepetido = !!campoNovo && regras.criterios.some((c) => c.campo === campoNovo);

  const mudarCriterio = (n: number, c: Criterio | null) => setRascunho({ ...regras, criterios: c ? regras.criterios.map((x, k) => (k === n ? c : x)) : regras.criterios.filter((_, k) => k !== n) });
  const mudarCorte = (qual: "quente" | "morno", v: number) => setRascunho({ ...regras, cortes: ajustarCortes({ ...regras.cortes, [qual]: v }, qual) });

  const salvar = async () => {
    if (impedimento) return;
    const limpas = lerRegras(regras, nicho);
    const ok = await guardar({ pontuacao: ehOPadrao(limpas, nicho) ? {} : limpas }, "Pontuação salva. Vale para os próximos leads.");
    if (ok) setRascunho(null);
  };

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]" data-parte="pontuacao">
      <div className="min-w-0 space-y-8">
        <Secao
          titulo="Critérios"
          recolher={false}
          descricao={`Soma máxima: ${nota.maximo} pontos`}
          ajuda="Cada resposta do lead vale pontos. A nota final vai de 0 a 100 e é proporcional à soma máxima, então dá para mexer nos pontos sem refazer os cortes. Resposta que falta não soma nem tira: o WhatsApp pergunta depois. Marcada como Nutrição, a resposta manda o lead para a nutrição com qualquer nota."
          acao={
            <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => setRascunho(regrasDoRamo(nicho))} disabled={noPadrao} data-voltar-ao-padrao="">
              Voltar ao padrão do ramo
            </button>
          }
        >
          <ul className="min-w-0 divide-y divide-border/50" data-editor-de-criterios="">
            {regras.criterios.map((c, n) => (
              <EditorDeCriterio key={c.campo} criterio={c} onMudar={(x) => mudarCriterio(n, x)} onTirar={() => mudarCriterio(n, null)} />
            ))}
          </ul>
          {novo ? (
            <div className="mt-3 flex min-w-0 flex-wrap items-center" data-criterio-novo="">
              <input className={juntar(campo, "mb-2 mr-2 w-full min-w-0 sm:mb-0 sm:w-auto sm:flex-1")} value={novo.rotulo} onChange={(e) => setNovo({ ...novo, rotulo: e.target.value.slice(0, 40) })} placeholder="Nome do critério, como Renda" aria-label="Nome do critério novo" autoFocus />
              <select className={juntar(campo, "mr-2 w-auto")} value={novo.tipo} onChange={(e) => setNovo({ ...novo, tipo: e.target.value === "faixa" ? "faixa" : "opcao" })} aria-label="Tipo do critério novo">
                <option value="opcao">Por opção</option>
                <option value="faixa">Por valor</option>
              </select>
              <button
                type="button"
                className={botao.secundario}
                disabled={campoNovo.length < 2 || novoRepetido || regras.criterios.length >= 12}
                onClick={() => {
                  const c: Criterio = novo.tipo === "faixa" ? { tipo: "faixa", campo: campoNovo, rotulo: novo.rotulo.trim(), faixas: [{ ate: 1000, pontos: 0 }, { pontos: 10 }] } : { tipo: "opcao", campo: campoNovo, rotulo: novo.rotulo.trim(), pontos: { sim: 10, nao: 0 } };
                  setRascunho({ ...regras, criterios: regras.criterios.concat([c]) });
                  setNovo(null);
                }}
              >
                Criar
              </button>
              <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => setNovo(null)} aria-label="Desistir do critério novo">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button type="button" className={juntar(botao.discreto, "relative -left-2 mt-2 h-8")} onClick={() => setNovo({ rotulo: "", tipo: "opcao" })} disabled={regras.criterios.length >= 12} data-novo-criterio="">
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Novo critério
            </button>
          )}
        </Secao>

        <Secao titulo="Cortes" recolher={false} descricao={`Quente de ${regras.cortes.quente} · Morno de ${regras.cortes.morno} · Frio abaixo`} ajuda="Quente e morno vão para o vendedor do rodízio. Frio vai para a nutrição e não ocupa vendedor.">
          <div className="flex h-2 min-w-0 overflow-hidden rounded-full bg-muted" aria-hidden="true" data-regua-dos-cortes="">
            <span className="h-full bg-muted-foreground/40" style={{ width: `${regras.cortes.morno}%` }} />
            <span className="h-full bg-warning" style={{ width: `${regras.cortes.quente - regras.cortes.morno}%` }} />
            <span className="h-full flex-1 bg-primary" />
          </div>
          <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <CampoDeFormulario rotulo={`Quente a partir de ${regras.cortes.quente}`}>
              <input type="range" className="block h-9 w-full min-w-0 accent-[hsl(var(--primary))]" min={1} max={100} value={regras.cortes.quente} onChange={(e) => mudarCorte("quente", Number(e.target.value))} data-corte="quente" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo={`Morno a partir de ${regras.cortes.morno}`}>
              <input type="range" className="block h-9 w-full min-w-0 accent-[hsl(var(--primary))]" min={0} max={99} value={regras.cortes.morno} onChange={(e) => mudarCorte("morno", Number(e.target.value))} data-corte="morno" />
            </CampoDeFormulario>
          </div>
          <div className="mt-4">
            <BarraDeSalvar nome="pontuacao" mudou={mudou} salvando={salvando} onSalvar={() => void salvar()} impedimento={mudou ? impedimento : null} />
          </div>
        </Secao>
      </div>

      <Secao
        titulo="Simulador"
        recolher={false}
        ajuda="Escolha as respostas e veja a nota com as regras que estão na tela, mesmo antes de salvar. Não cria lead nenhum."
        acao={
          <SeletorCompacto
            rotulo="Preencher com um exemplo"
            modo="lista"
            opcoes={[{ valor: "", rotulo: "Exemplo" }, { valor: "quente", rotulo: "Quente" }, { valor: "morno", rotulo: "Morno" }, { valor: "frio", rotulo: "Frio" }]}
            valor=""
            onEscolher={(v) => v && setRespostas(respostasDeExemplo(regras, v as Faixa))}
          />
        }
        data-simulador-de-nota=""
      >
        <div className="flex min-w-0 items-center" data-nota-simulada={nota.nota} data-faixa-simulada={nota.faixa}>
          <span className={texto.numero}>{nota.nota}</span>
          <span className={juntar(texto.auxiliar, "ml-1.5")}>de 100</span>
          <span className={juntar(etiqueta, "ml-3", COR_DA_FAIXA[nota.faixa])}>{NOME_DA_FAIXA[nota.faixa]}</span>
          <span className={juntar(texto.auxiliar, "ml-3 min-w-0 flex-1 truncate")}>{nota.faixa === "frio" ? "Vai para a nutrição" : "Vai para o vendedor"}</span>
        </div>
        <div className="mt-4 min-w-0 space-y-3">
          {regras.criterios.map((c) => (
            <CampoDeFormulario key={c.campo} rotulo={c.rotulo}>
              {c.tipo === "opcao" ? (
                <select className={campo} value={String(respostas[c.campo] === undefined ? "" : respostas[c.campo])} onChange={(e) => setRespostas({ ...respostas, [c.campo]: e.target.value })} data-resposta={c.campo}>
                  <option value="">Não respondeu</option>
                  {Object.keys(c.pontos).map((k) => (
                    <option key={k} value={k}>{nomeDaOpcao(k)}</option>
                  ))}
                </select>
              ) : (
                <input className={campo} value={String(respostas[c.campo] === undefined ? "" : respostas[c.campo])} onChange={(e) => setRespostas({ ...respostas, [c.campo]: e.target.value.replace(/[^0-9]/g, "") })} inputMode="numeric" placeholder="Não respondeu" data-resposta={c.campo} />
              )}
            </CampoDeFormulario>
          ))}
        </div>
        <ul className="mt-4 min-w-0 space-y-1 border-t border-border pt-3" data-motivos-da-nota="">
          {nota.motivos.length === 0 ? (
            <li className={texto.auxiliar}>Sem respostas ainda.</li>
          ) : (
            nota.motivos.map((m) => (
              <li key={m} className={juntar(texto.corpo, "flex min-w-0 items-center")}>
                <Check className="mr-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 truncate">{m}</span>
              </li>
            ))
          )}
        </ul>
      </Secao>
    </div>
  );
}

// ------------------------------------------------------------------ vendedores

interface RascunhoDoVendedor {
  bens: string[];
  sempre: boolean;
  dias: number[];
  inicio: string;
  fim: string;
  whatsapp: string;
}

const chip = (ligado: boolean) =>
  juntar("toque-compacto mb-1.5 mr-1.5 inline-flex h-8 items-center rounded-md border px-2.5 text-[12px] font-medium transition-colors", foco, ligado ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted");

function ParteVendedores({ i, nicho }: DaParte) {
  const qc = useQueryClient();
  const vendedores = useQuery({ queryKey: chaveDosVendedores, queryFn: lerVendedores });
  const [editando, setEditando] = useState<{ pessoa: Vendedor; r: RascunhoDoVendedor } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const bensDoRamo = bensDasRegras(lerRegras(i.pontuacao, nicho));
  const pessoas = vendedores.data || [];
  const recebendo = pessoas.filter((v) => v.estado === "ativo" && v.recebe_leads).length;
  const reler = () => qc.invalidateQueries({ queryKey: chaveDosVendedores });

  const gravar = async (pessoa: Vendedor, dados: Parameters<typeof salvarVendedor>[1], aviso: string): Promise<boolean> => {
    setOcupado(pessoa.membro_id);
    try {
      await salvarVendedor(pessoa.membro_id, dados);
      await reler();
      toast.success(aviso);
      return true;
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar."));
      return false;
    } finally {
      setOcupado(null);
    }
  };

  const abrir = (v: Vendedor) =>
    setEditando({
      pessoa: v,
      r: { bens: v.bens.slice(), sempre: !v.expediente.inicio, dias: v.expediente.dias && v.expediente.dias.length ? v.expediente.dias.slice() : [1, 2, 3, 4, 5], inicio: v.expediente.inicio || "09:00", fim: v.expediente.fim || "18:00", whatsapp: v.whatsapp || "" },
    });
  const mudar = (parte: Partial<RascunhoDoVendedor>) => setEditando((e) => (e ? { ...e, r: { ...e.r, ...parte } } : e));
  const alternar = (itens: Array<string | number>, item: string | number) => (itens.indexOf(item) >= 0 ? itens.filter((x) => x !== item) : itens.concat([item]));

  const r = editando ? editando.r : null;
  const expedienteDoRascunho: Expediente = r && !r.sempre ? { dias: r.dias.slice().sort((a, b) => a - b), inicio: r.inicio, fim: r.fim } : {};
  const erro = r ? erroDoExpediente(expedienteDoRascunho) || (!whatsappValido(r.whatsapp) ? "O WhatsApp precisa de DDD, só números." : null) : null;

  const salvar = async () => {
    if (!editando || !r || erro) return;
    const ok = await gravar(editando.pessoa, { bens: r.bens, expediente: expedienteDoRascunho, whatsapp: limparWhatsapp(r.whatsapp) }, "Vendedor salvo.");
    if (ok) setEditando(null);
  };

  return (
    <Secao
      titulo="Vendedores"
      recolher={false}
      descricao={vendedores.data ? `${recebendo} recebendo leads` : undefined}
      ajuda="O lead quente ou morno vai para quem atende aquele tipo de bem e está no expediente, começando por quem tem menos negócios abertos. Sem ninguém no expediente, ele espera na fila e entra para o primeiro que chegar. Gerente e administrador só recebem quando a empresa não tem nenhum vendedor. Para convidar gente nova, use a Equipe."
      data-parte="vendedores"
    >
      {vendedores.isLoading ? (
        <Carregando linhas={4} rotulo="Carregando os vendedores" />
      ) : vendedores.isError ? (
        <EstadoDeErro acao={<button type="button" className={botao.secundario} onClick={() => void vendedores.refetch()}>Tentar de novo</button>} />
      ) : pessoas.length === 0 ? (
        <EstadoVazio compacto icone={<Users className="h-5 w-5" aria-hidden="true" />} titulo="Ninguém na equipe ainda." descricao="Convide os vendedores na Equipe." />
      ) : (
        <ul className={juntar(lista.aberta, lista.divisoria)}>
          {pessoas.map((v) => {
            const convidado = v.estado !== "ativo" || !v.user_id;
            return (
              <li key={v.membro_id} className={lista.linha} data-vendedor={v.membro_id}>
                <Foto nome={v.nome} tamanho="m" apagada={convidado || !v.recebe_leads} className="mr-3" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center">
                    <span className={juntar(texto.corpo, "min-w-0 truncate font-medium", !v.recebe_leads && "text-muted-foreground")}>{v.nome}</span>
                    {convidado ? (
                      <span className={juntar(etiqueta, "ml-2 bg-muted text-muted-foreground")}>Convite pendente</span>
                    ) : v.recebe_leads ? (
                      <span className={juntar(etiqueta, "ml-2", v.no_expediente ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")} data-no-expediente={v.no_expediente ? "sim" : "nao"}>{v.no_expediente ? "No expediente" : "Fora do expediente"}</span>
                    ) : null}
                  </span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>
                    {v.cargo || ROTULO_DO_PAPEL[v.papel]} · {v.bens.length ? v.bens.map(nomeDaOpcao).join(", ") : "Todos os bens"} · {formatarExpediente(v.expediente)}
                  </span>
                  <span className={juntar(texto.auxiliar, "block truncate", !v.whatsapp && v.recebe_leads && "text-warning")}>{v.whatsapp ? `Avisos no ${whatsappLegivel(v.whatsapp)}` : "Sem WhatsApp para os avisos"}</span>
                </span>
                <Switch
                  className="ml-3"
                  data-compacto=""
                  checked={v.recebe_leads}
                  disabled={ocupado === v.membro_id}
                  onCheckedChange={(x) => void gravar(v, { recebe_leads: x }, x ? `${v.nome} voltou a receber leads.` : `${v.nome} parou de receber leads.`)}
                  aria-label={`${v.recebe_leads ? "Parar de mandar" : "Mandar"} leads para ${v.nome}`}
                />
                <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => abrir(v)} aria-label={`Editar ${v.nome}`} title="Editar">
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <JanelaCentral
        aberta={!!editando}
        onFechar={() => setEditando(null)}
        largura="md"
        titulo={editando ? editando.pessoa.nome : "Vendedor"}
        rodape={
          <>
            {erro && <span className={juntar(texto.auxiliar, "mr-3 min-w-0 flex-1 truncate text-destructive")} role="alert">{erro}</span>}
            <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={!!erro || (!!editando && ocupado === editando.pessoa.membro_id)} data-salvar="vendedor">Salvar</button>
          </>
        }
      >
        {r && (
          <div className="min-w-0 space-y-5" data-editor-de-vendedor="">
            <div className="min-w-0">
              <span className={juntar(texto.rotulo, "mb-1.5 block")}>Bens que atende</span>
              {bensDoRamo.concat(r.bens.filter((b) => bensDoRamo.indexOf(b) < 0)).length === 0 ? (
                <span className={juntar(texto.auxiliar, "block leading-5")}>A pontuação não separa por tipo de bem: todos atendem tudo.</span>
              ) : (
                <div className="flex min-w-0 flex-wrap">
                  {bensDoRamo.concat(r.bens.filter((b) => bensDoRamo.indexOf(b) < 0)).map((b) => (
                    <button key={b} type="button" className={chip(r.bens.indexOf(b) >= 0)} aria-pressed={r.bens.indexOf(b) >= 0} onClick={() => mudar({ bens: alternar(r.bens, b) as string[] })} data-bem={b}>
                      {nomeDaOpcao(b)}
                    </button>
                  ))}
                </div>
              )}
              <span className={juntar(texto.auxiliar, "block")}>{r.bens.length === 0 ? "Nenhum marcado: atende qualquer bem." : `Atende ${r.bens.length} ${r.bens.length === 1 ? "tipo" : "tipos"}.`}</span>
            </div>

            <div className="min-w-0">
              <span className={juntar(texto.rotulo, "mb-1.5 block")}>Expediente</span>
              <label className={juntar(texto.corpo, "flex min-w-0 items-center py-1")}>
                <input type="checkbox" className={juntar(caixinha, "mr-2")} checked={r.sempre} onChange={(e) => mudar({ sempre: e.target.checked })} data-sempre="" />
                Sempre, a qualquer hora
              </label>
              {!r.sempre && (
                <>
                  <div className="mt-1 flex min-w-0 flex-wrap">
                    {DIAS_DA_SEMANA.map((d) => (
                      <button key={d.dia} type="button" className={chip(r.dias.indexOf(d.dia) >= 0)} aria-pressed={r.dias.indexOf(d.dia) >= 0} aria-label={d.nome} onClick={() => mudar({ dias: alternar(r.dias, d.dia) as number[] })} data-dia={d.dia}>
                        {d.curto}
                      </button>
                    ))}
                  </div>
                  <GrupoDeCampos className="mt-1">
                    <CampoDeFormulario rotulo="Começa">
                      <input className={campo} type="time" value={r.inicio} onChange={(e) => mudar({ inicio: e.target.value })} data-inicio="" />
                    </CampoDeFormulario>
                    <CampoDeFormulario rotulo="Termina">
                      <input className={campo} type="time" value={r.fim} onChange={(e) => mudar({ fim: e.target.value })} data-fim="" />
                    </CampoDeFormulario>
                  </GrupoDeCampos>
                  <span className={juntar(texto.auxiliar, "mt-1.5 block")}>{erroDoExpediente(expedienteDoRascunho) ? "" : `${formatarExpediente(expedienteDoRascunho)}, horário de Brasília.`}</span>
                </>
              )}
            </div>

            <CampoDeFormulario rotulo="WhatsApp onde recebe os avisos" apoio={r.whatsapp && whatsappValido(r.whatsapp) ? whatsappLegivel(limparWhatsapp(r.whatsapp)) : "Com DDD, como 41 99999-0000."} ajuda="É o WhatsApp pessoal ou de trabalho do vendedor. O número da empresa manda o aviso de lead novo para cá, com os botões para marcar o andamento. A conversa com o lead acontece no WhatsApp do próprio vendedor.">
              <input className={campo} value={r.whatsapp} onChange={(e) => mudar({ whatsapp: e.target.value.replace(/[^0-9 ()+-]/g, "") })} inputMode="tel" maxLength={24} autoComplete="off" data-whatsapp-do-vendedor="" />
            </CampoDeFormulario>
          </div>
        )}
      </JanelaCentral>
    </Secao>
  );
}

// ------------------------------------------------------------------ a tela

const PARTES: Array<{ valor: ParteDaIntegracao; rotulo: string; icone: ReactNode }> = [
  { valor: "visao", rotulo: "Visão", icone: <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" /> },
  { valor: "meta", rotulo: "Meta", icone: <Webhook className="h-3.5 w-3.5" aria-hidden="true" /> },
  { valor: "whatsapp", rotulo: "WhatsApp", icone: <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" /> },
  { valor: "pontuacao", rotulo: "Pontuação", icone: <Gauge className="h-3.5 w-3.5" aria-hidden="true" /> },
  { valor: "vendedores", rotulo: "Vendedores", icone: <Users className="h-3.5 w-3.5" aria-hidden="true" /> },
];

function TelaDoGestor({ estado }: { estado: EstadoDoProduto }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useSearchParams();
  const integracao = useQuery({ queryKey: chaveDaIntegracao, queryFn: lerIntegracao });
  const [salvando, setSalvando] = useState(false);
  const pedida = busca.get("parte") || "";
  const parte: ParteDaIntegracao = PARTES.some((p) => p.valor === pedida) ? (pedida as ParteDaIntegracao) : "visao";
  const irPara = (p: string) => {
    const nova = new URLSearchParams(busca);
    nova.set("parte", p);
    setBusca(nova, { replace: true });
  };
  const nicho = estado.conta ? estado.conta.perfil.nicho : undefined;
  const i = integracao.data || null;

  const guardar: Guardar = async (dados, aviso) => {
    setSalvando(true);
    try {
      qc.setQueryData(chaveDaIntegracao, await salvarIntegracao(dados));
      toast.success(aviso);
      return true;
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar. Tente de novo."));
      return false;
    } finally {
      setSalvando(false);
    }
  };

  const daParte: DaParte | null = i ? { i, guardar, salvando, irPara, nicho } : null;
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1320px]" data-integracoes-da-conta="gestor">
      <CabecalhoDePagina
        titulo="Leads da Meta e WhatsApp"
        descricao={i ? NOME_DA_SITUACAO[situacaoDaIntegracao(i)] : undefined}
        ajuda="O lead preenche o formulário da Meta, entra sozinho no CRM, ganha nota, vai para o vendedor certo e conversa com o WhatsApp da empresa. Tudo nasce desligado e em modo teste."
        // No celular as partes ficam num seletor; do tablet para cima, na coluna da esquerda.
        acoes={<div className="md:hidden"><SeletorCompacto rotulo="Partes da integração" opcoes={PARTES} valor={parte} onEscolher={irPara} modo="lista" /></div>}
      />
      <div className="mt-5 grid min-w-0 grid-cols-1 gap-x-10 gap-y-5 md:grid-cols-[170px_minmax(0,1fr)]">
        <nav className="hidden min-w-0 md:block" aria-label="Partes da integração" data-partes-da-integracao="">
          <ul className="space-y-0.5">
            {PARTES.map((p) => (
              <li key={p.valor}>
                <button
                  type="button"
                  onClick={() => irPara(p.valor)}
                  aria-current={parte === p.valor ? "page" : undefined}
                  className={juntar(
                    "toque-compacto flex h-9 w-full min-w-0 items-center rounded-md px-2.5 text-left text-[13px] font-medium transition-colors",
                    foco,
                    parte === p.valor ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                  data-ir-para-parte={p.valor}
                >
                  <span className="mr-2 shrink-0">{p.icone}</span>
                  <span className="min-w-0 truncate">{p.rotulo}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div key={parte} className="produto-entra min-w-0">
          {integracao.isLoading ? (
            <Carregando forma="aba" rotulo="Carregando a integração" />
          ) : integracao.isError || !daParte ? (
            <EstadoDeErro titulo="Não foi possível abrir a integração." acao={<button type="button" className={botao.secundario} onClick={() => void integracao.refetch()}>Tentar de novo</button>} />
          ) : parte === "meta" ? (
            <ParteMeta {...daParte} />
          ) : parte === "whatsapp" ? (
            <ParteWhatsapp {...daParte} />
          ) : parte === "pontuacao" ? (
            <PartePontuacao {...daParte} />
          ) : parte === "vendedores" ? (
            <ParteVendedores {...daParte} />
          ) : (
            <Visao {...daParte} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Leads da Meta e WhatsApp (14/11/2026, rodada 3): a empresa conecta a Meta e
 * o WhatsApp dela (modo manual), ajusta a pontuação e diz quem recebe os
 * leads. Só o gestor (administrador e gerente) usa; o vendedor recebe os leads
 * no funil e no WhatsApp dele.
 */
export default function IntegracoesDaConta({ estado }: { estado: EstadoDoProduto }) {
  if (!ehGestor(estado.eu ? estado.eu.papel : null)) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1320px]" data-integracoes-da-conta="vendedor">
        <EstadoVazio
          icone={<Lock className="h-5 w-5" aria-hidden="true" />}
          titulo="Isto é com o seu gerente."
          descricao="Quem gerencia a empresa liga a Meta e o WhatsApp. Os leads chegam para você no funil."
        />
      </div>
    );
  }
  return <TelaDoGestor estado={estado} />;
}
