import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BarChart3, Copy, ExternalLink, FileText, Link2, Pencil, Plus, Power, RefreshCw, Trash2, Unplug, X } from "lucide-react";
import { diaLegivel, ehGestor, fraseDoErro, reais, type EstadoDoProduto } from "@/lib/produto/api";
import { nomesDasEtapas } from "@/lib/produto/nichos";
import {
  CAMPOS_OPCIONAIS,
  ETAPAS_DE_ENTRADA,
  FORMULARIO_NOVO,
  LIMITE_DE_FORMULARIOS,
  NOME_DO_EVENTO,
  PERIODOS,
  agruparOrigens,
  apagarFormulario,
  baseDoLink,
  chaveDaPergunta,
  datasDoPeriodo,
  estadoDaConexao,
  lerOrigens,
  lerRastreamento,
  ligarFormulario,
  linksDoFormulario,
  listarConversoes,
  listarFormularios,
  montarLink,
  nomeDaOrigem,
  reenviarConversoes,
  salvarFormulario,
  salvarRastreamento,
  taxaDeGanho,
  type CampoOpcional,
  type EtapaDeEntrada,
  type EventoDaMeta,
  type Formulario,
  type PedidoDoCampo,
  type RascunhoDoFormulario,
} from "@/lib/produto/captacao";
import { CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, GrupoDeCampos, JanelaCentral, MenuMais, Secao, SeletorCompacto, botao, campo, campoTexto, etiqueta, juntar, lista, texto, useEstadoDaTela } from "@/components/sistema";

const copiar = (valor: string, oQue: string) => void navigator.clipboard.writeText(valor).then(() => toast.success(`${oQue} copiado.`)).catch(() => toast.error("Não foi possível copiar."));

const NOME_DO_CAMPO: Record<CampoOpcional, string> = { whatsapp: "WhatsApp", email: "E-mail", empresa: "Empresa", mensagem: "Mensagem" };
const PEDIDOS: Array<{ valor: PedidoDoCampo; rotulo: string }> = [
  { valor: "nao", rotulo: "Não pedir" },
  { valor: "opcional", rotulo: "Opcional" },
  { valor: "obrigatorio", rotulo: "Obrigatório" },
];

function BlocoDeCopia({ rotulo, onde, valor }: { rotulo: string; onde?: string; valor: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex min-w-0 items-center">
        <span className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>{rotulo}</span>
        <button type="button" className={botao.icone} onClick={() => copiar(valor, rotulo)} aria-label={`Copiar: ${rotulo}`} title="Copiar">
          <Copy className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <pre className="min-w-0 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-3 text-[12px] leading-5 text-foreground">{valor}</pre>
      {onde && <p className={juntar(texto.auxiliar, "mt-1 leading-5")}>{onde}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ formulários

function Formularios({ estado }: { estado: EstadoDoProduto }) {
  const qc = useQueryClient();
  const formularios = useQuery({ queryKey: ["produto", "formularios"], queryFn: listarFormularios });
  const [editando, setEditando] = useState<{ id?: string; rascunho: RascunhoDoFormulario } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [link, setLink] = useState<Formulario | null>(null);
  const [saindo, setSaindo] = useState<Formulario | null>(null);
  const reler = () => qc.invalidateQueries({ queryKey: ["produto", "formularios"] });
  const etapas = nomesDasEtapas(estado.conta ? estado.conta.perfil : {});
  const pessoas = estado.equipe.filter((m) => m.estado === "ativo" && m.user_id);
  const dados = formularios.data || [];

  const mudar = (parte: Partial<RascunhoDoFormulario>) => setEditando((e) => (e ? { ...e, rascunho: { ...e.rascunho, ...parte } } : e));
  const mudarPergunta = (i: number, rotulo: string | null, obrigatoria?: boolean) =>
    setEditando((e) => {
      if (!e) return e;
      const perguntas = e.rascunho.perguntas.slice();
      if (rotulo === null && obrigatoria === undefined) perguntas.splice(i, 1);
      else perguntas[i] = { ...perguntas[i], ...(rotulo !== null ? { rotulo, chave: chaveDaPergunta(rotulo) } : {}), ...(obrigatoria !== undefined ? { obrigatoria } : {}) };
      return { ...e, rascunho: { ...e.rascunho, perguntas } };
    });

  const r = editando ? editando.rascunho : null;
  const perguntaRuim = !!r && r.perguntas.some((p, i) => p.chave.length < 2 || r.perguntas.findIndex((q) => q.chave === p.chave) !== i);
  const podeSalvar = !!r && r.nome.trim().length >= 2 && !perguntaRuim;

  const salvar = async () => {
    if (!editando || !podeSalvar) return;
    setSalvando(true);
    try {
      const f = await salvarFormulario(editando.rascunho, editando.id);
      await reler();
      const novo = !editando.id;
      setEditando(null);
      toast.success(novo ? "Formulário criado." : "Formulário salvo.");
      if (novo) setLink(f);
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar o formulário."));
    } finally {
      setSalvando(false);
    }
  };

  const alternar = async (f: Formulario) => {
    try {
      await ligarFormulario(f.id, !f.ativo);
      await reler();
      toast.success(f.ativo ? "Formulário desligado. O link parou de receber." : "Formulário ligado.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível mudar o formulário."));
    }
  };

  const apagar = async (f: Formulario) => {
    try {
      await apagarFormulario(f.id);
      await reler();
      toast.success("Formulário apagado. Os negócios que vieram dele continuam no funil.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível apagar."));
    }
  };

  return (
    <Secao
      titulo="Formulários"
      descricao={`${dados.length} de ${LIMITE_DE_FORMULARIOS}`}
      ajuda="Cada formulário tem um link próprio para pôr no anúncio, na bio ou no site. Quem preenche vira negócio no funil, com a origem do clique guardada. A mesma pessoa em aberto não é duplicada."
      acao={
        <button type="button" className={botao.icone} onClick={() => setEditando({ rascunho: { ...FORMULARIO_NOVO } })} disabled={dados.length >= LIMITE_DE_FORMULARIOS} aria-label="Novo formulário" title="Novo formulário" data-novo-formulario="">
          <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
        </button>
      }
      data-formularios-da-conta=""
    >
      {formularios.isLoading ? (
        <Carregando linhas={3} rotulo="Carregando os formulários" />
      ) : formularios.isError ? (
        <EstadoDeErro acao={<button type="button" className={botao.secundario} onClick={() => void formularios.refetch()}>Tentar de novo</button>} />
      ) : dados.length === 0 ? (
        <EstadoVazio
          compacto
          icone={<FileText className="h-5 w-5" aria-hidden="true" />}
          titulo="Nenhum formulário ainda."
          descricao="Crie o primeiro e cole o link no anúncio."
          acao={<button type="button" className={botao.primario} onClick={() => setEditando({ rascunho: { ...FORMULARIO_NOVO } })}>Criar formulário</button>}
        />
      ) : (
        <ul className={juntar(lista.aberta, lista.divisoria)}>
          {dados.map((f) => (
            <li key={f.id} className={lista.linha} data-formulario={f.id}>
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.corpo, "block truncate font-medium", !f.ativo && "text-muted-foreground")}>{f.nome}</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>
                  {f.envios} {f.envios === 1 ? "envio" : "envios"}
                  {f.ultimo_envio_em ? ` · último em ${diaLegivel(f.ultimo_envio_em)}` : ""} · entra em {etapas[f.etapa_entrada]}
                </span>
              </span>
              {!f.ativo && <span className={juntar(etiqueta, "ml-2 bg-muted text-muted-foreground")}>Desligado</span>}
              <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => setLink(f)} aria-label={`Link do formulário ${f.nome}`} title="Link">
                <Link2 className="h-4 w-4" aria-hidden="true" />
              </button>
              <MenuMais
                rotulo={`Mais ações de ${f.nome}`}
                itens={[
                  { rotulo: "Editar", icone: <Pencil className="h-4 w-4" aria-hidden="true" />, aoEscolher: () => setEditando({ id: f.id, rascunho: { nome: f.nome, titulo: f.titulo, descricao: f.descricao, texto_botao: f.texto_botao, agradecimento: f.agradecimento, campos: { ...f.campos }, perguntas: f.perguntas.map((p) => ({ ...p })), etapa_entrada: f.etapa_entrada, responsavel_id: f.responsavel_id } }) },
                  { rotulo: "Abrir a página", icone: <ExternalLink className="h-4 w-4" aria-hidden="true" />, aoEscolher: () => void window.open(montarLink(baseDoLink(), f.token), "_blank", "noopener") },
                  { rotulo: f.ativo ? "Desligar" : "Ligar", icone: <Power className="h-4 w-4" aria-hidden="true" />, aoEscolher: () => void alternar(f) },
                  { rotulo: "Apagar", icone: <Trash2 className="h-4 w-4" aria-hidden="true" />, perigo: true, aoEscolher: () => setSaindo(f) },
                ]}
              />
            </li>
          ))}
        </ul>
      )}

      <JanelaCentral
        aberta={!!editando}
        onFechar={() => setEditando(null)}
        largura="lg"
        titulo={editando && editando.id ? "Editar formulário" : "Novo formulário"}
        ajuda="O nome é só para a equipe. O título, a descrição e o botão aparecem para quem abre o link, com o logo e a cor da empresa."
        rodape={<button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando || !podeSalvar} data-salvar-formulario="">{salvando ? "Salvando..." : "Salvar"}</button>}
      >
        {r && (
          <div className="min-w-0 space-y-5" data-editor-de-formulario="">
            <GrupoDeCampos>
              <CampoDeFormulario rotulo="Nome (só a equipe vê)" obrigatorio>
                <input className={campo} value={r.nome} onChange={(e) => mudar({ nome: e.target.value })} maxLength={80} placeholder="Anúncio de novembro" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Título da página">
                <input className={campo} value={r.titulo} onChange={(e) => mudar({ titulo: e.target.value })} maxLength={120} placeholder="Peça o seu orçamento" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Descrição" largo>
                <textarea className={campoTexto} value={r.descricao} onChange={(e) => mudar({ descricao: e.target.value })} maxLength={600} rows={2} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Texto do botão">
                <input className={campo} value={r.texto_botao} onChange={(e) => mudar({ texto_botao: e.target.value })} maxLength={40} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Mensagem de agradecimento">
                <input className={campo} value={r.agradecimento} onChange={(e) => mudar({ agradecimento: e.target.value })} maxLength={400} />
              </CampoDeFormulario>
            </GrupoDeCampos>

            <GrupoDeCampos titulo="O que o formulário pede" descricao="O nome é sempre pedido">
              {CAMPOS_OPCIONAIS.map((c) => (
                <CampoDeFormulario key={c} rotulo={NOME_DO_CAMPO[c]}>
                  <select className={campo} value={r.campos[c]} onChange={(e) => mudar({ campos: { ...r.campos, [c]: e.target.value as PedidoDoCampo } })} data-pedido-do-campo={c}>
                    {PEDIDOS.map((p) => (
                      <option key={p.valor} value={p.valor}>{p.rotulo}</option>
                    ))}
                  </select>
                </CampoDeFormulario>
              ))}
            </GrupoDeCampos>

            <div className="min-w-0">
              <div className="mb-2 flex min-w-0 items-center">
                <span className={juntar(texto.tituloSecao, "min-w-0 flex-1 truncate")}>Perguntas próprias</span>
                <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => mudar({ perguntas: r.perguntas.concat([{ chave: "", rotulo: "", obrigatoria: false }]) })} disabled={r.perguntas.length >= 3} data-nova-pergunta="">
                  Adicionar ({r.perguntas.length} de 3)
                </button>
              </div>
              {r.perguntas.map((p, i) => (
                <div key={i} className="mb-2 flex min-w-0 items-center" data-pergunta={i}>
                  <input className={juntar(campo, "flex-1")} value={p.rotulo} onChange={(e) => mudarPergunta(i, e.target.value)} maxLength={80} placeholder="Qual a sua cidade?" aria-label={`Pergunta ${i + 1}`} />
                  <label className={juntar(texto.auxiliar, "ml-3 flex shrink-0 items-center")}>
                    <input type="checkbox" className="mr-1.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={p.obrigatoria} onChange={(e) => mudarPergunta(i, null, e.target.checked)} />
                    Obrigatória
                  </label>
                  <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => mudarPergunta(i, null)} aria-label={`Tirar a pergunta ${i + 1}`} title="Tirar">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
              {perguntaRuim && <p className={juntar(texto.auxiliar, "text-destructive")}>Escreva perguntas diferentes, com pelo menos duas letras.</p>}
            </div>

            <GrupoDeCampos titulo="No funil">
              <CampoDeFormulario rotulo="Etapa de entrada">
                <select className={campo} value={r.etapa_entrada} onChange={(e) => mudar({ etapa_entrada: e.target.value as EtapaDeEntrada })}>
                  {ETAPAS_DE_ENTRADA.map((id) => (
                    <option key={id} value={id}>{etapas[id]}</option>
                  ))}
                </select>
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Responsável" ajuda="Sem responsável fixo, o negócio entra sem dono e as automações da empresa (como o rodízio) distribuem.">
                <select className={campo} value={r.responsavel_id || ""} onChange={(e) => mudar({ responsavel_id: e.target.value || null })}>
                  <option value="">Sem responsável fixo</option>
                  {pessoas.map((m) => (
                    <option key={m.id} value={m.user_id || ""}>{m.nome || m.email || "Pessoa"}</option>
                  ))}
                </select>
              </CampoDeFormulario>
            </GrupoDeCampos>
          </div>
        )}
      </JanelaCentral>

      <JanelaCentral
        aberta={!!link}
        onFechar={() => setLink(null)}
        largura="lg"
        titulo={link ? link.nome : "Link"}
        descricao={link && !link.ativo ? "Desligado: o link não recebe" : undefined}
        ajuda="O que vem depois do ponto de interrogação no link diz de onde a pessoa veio (utm_source, utm_campaign). É isso que alimenta o relatório de origem. Troque os valores à vontade para cada lugar em que o link for usado."
        rodape={<button type="button" className={botao.primario} onClick={() => setLink(null)}>Fechar</button>}
      >
        {link && (
          <div className="min-w-0 space-y-4" data-links-do-formulario="">
            {linksDoFormulario(baseDoLink(), link.token).map((l) => (
              <BlocoDeCopia key={l.rotulo} rotulo={l.rotulo} onde={l.onde} valor={l.valor} />
            ))}
          </div>
        )}
      </JanelaCentral>

      <JanelaCentral
        aberta={!!saindo}
        onFechar={() => setSaindo(null)}
        largura="sm"
        titulo={saindo ? `Apagar o formulário ${saindo.nome}?` : "Apagar"}
        rodape={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setSaindo(null)}>Manter</button>
            <button
              type="button"
              className={botao.perigo}
              onClick={() => {
                const f = saindo;
                setSaindo(null);
                if (f) void apagar(f);
              }}
            >
              Apagar
            </button>
          </>
        }
      >
        <p className={texto.corpo}>O link para de funcionar. Os negócios que já entraram continuam no funil.</p>
      </JanelaCentral>
    </Secao>
  );
}

// ------------------------------------------------------------------ de onde vêm os negócios

function Origens({ soOsMeus }: { soOsMeus: boolean }) {
  const [periodo, setPeriodo] = useEstadoDaTela<string>("captacao:periodo", "30", { validar: (v) => PERIODOS.some((p) => p.valor === v) });
  const datas = datasDoPeriodo(Number(periodo));
  const origens = useQuery({ queryKey: ["produto", "origens", datas.de, datas.ate], queryFn: () => lerOrigens(datas.de, datas.ate) });
  const grupos = agruparOrigens(origens.data || []);
  const maior = grupos.reduce((m, g) => Math.max(m, g.negocios), 0) || 1;
  const total = grupos.reduce((s, g) => ({ negocios: s.negocios + g.negocios, ganhos: s.ganhos + g.ganhos, valor: s.valor + g.valor_ganho }), { negocios: 0, ganhos: 0, valor: 0 });

  return (
    <Secao
      titulo="De onde vêm os negócios"
      descricao={origens.data ? `${total.negocios} ${total.negocios === 1 ? "negócio" : "negócios"} · ${total.ganhos} ${total.ganhos === 1 ? "venda" : "vendas"} · ${reais(total.valor)}` : undefined}
      ajuda={`Negócios criados no período, por origem e campanha: quantos entraram, quantos viraram venda e quanto valem (12 meses de mensalidade mais a entrada). A origem é o utm_source do link; sem link de campanha, vale a origem do cadastro.${soOsMeus ? " Você vê os negócios que pode ver no funil." : ""}`}
      acao={<SeletorCompacto rotulo="Período" opcoes={PERIODOS.map((p) => ({ valor: p.valor, rotulo: p.rotulo }))} valor={periodo} onEscolher={setPeriodo} />}
      data-origens-dos-negocios=""
    >
      {origens.isLoading ? (
        <Carregando linhas={4} rotulo="Carregando as origens" />
      ) : origens.isError ? (
        <EstadoDeErro acao={<button type="button" className={botao.secundario} onClick={() => void origens.refetch()}>Tentar de novo</button>} />
      ) : grupos.length === 0 ? (
        <EstadoVazio compacto icone={<BarChart3 className="h-5 w-5" aria-hidden="true" />} titulo="Nenhum negócio no período." descricao="Quando entrar, a origem aparece aqui." />
      ) : (
        <ul className="min-w-0 space-y-4">
          {grupos.map((g) => (
            <li key={g.origem} className="min-w-0" data-origem={g.origem}>
              <div className="flex min-w-0 items-baseline">
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>{nomeDaOrigem(g.origem)}</span>
                <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>
                  {g.negocios} {g.negocios === 1 ? "negócio" : "negócios"} · {g.ganhos} {g.ganhos === 1 ? "venda" : "vendas"} ({taxaDeGanho(g)}%)
                </span>
              </div>
              <div className="mt-1.5 h-2 min-w-0 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${g.negocios} negócios, ${g.ganhos} vendas`}>
                <div className="produto-barra-do-funil relative h-full rounded-full bg-primary/30" style={{ width: `${Math.max(3, Math.round((g.negocios / maior) * 100))}%` }}>
                  <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${g.negocios ? Math.round((g.ganhos / g.negocios) * 100) : 0}%` }} />
                </div>
              </div>
              <div className="mt-1 flex min-w-0 items-center">
                <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>{g.abertos} em aberto · {g.perdidos} {g.perdidos === 1 ? "perdido" : "perdidos"}</span>
                <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums text-foreground")}>{reais(g.valor_ganho)}</span>
              </div>
              {g.campanhas.length > 0 && (
                <ul className="mt-1.5 min-w-0 border-l border-border pl-3">
                  {g.campanhas.slice(0, 6).map((c) => (
                    <li key={c.campanha} className="flex min-w-0 items-center py-0.5" data-campanha={c.campanha}>
                      <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")} title={c.campanha}>{c.campanha}</span>
                      <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>{c.negocios} · {c.ganhos} {c.ganhos === 1 ? "venda" : "vendas"} · {reais(c.valor_ganho)}</span>
                    </li>
                  ))}
                  {g.campanhas.length > 6 && <li className={texto.auxiliar}>e mais {g.campanhas.length - 6} campanhas</li>}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

// ------------------------------------------------------------------ Meta

const PASSOS_DA_META = [
  "No Gerenciador de Eventos da Meta, abra o seu Pixel (conjunto de dados) e copie o ID.",
  "Em Configurações, vá até API de Conversões e clique em Gerar token de acesso.",
  "Cole o ID e o token aqui e salve. O token fica guardado no cofre e não aparece de novo.",
];

const COR_DA_SITUACAO: Record<string, string> = { enviado: "bg-primary/15 text-primary", pendente: "bg-muted text-muted-foreground", erro: "bg-destructive/15 text-destructive" };
const NOME_DA_SITUACAO: Record<string, string> = { enviado: "Enviado", pendente: "Na fila", erro: "Erro" };

function Meta() {
  const qc = useQueryClient();
  const rastreamento = useQuery({ queryKey: ["produto", "rastreamento"], queryFn: lerRastreamento });
  const fila = useQuery({ queryKey: ["produto", "conversoes"], queryFn: () => listarConversoes(20) });
  const [pixel, setPixel] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [codigo, setCodigo] = useState<string | null>(null);
  const [eventos, setEventos] = useState<EventoDaMeta[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [desligando, setDesligando] = useState(false);
  const r = rastreamento.data || null;
  const conexao = estadoDaConexao(r);
  const pixelAtual = pixel !== null ? pixel : (r && r.meta_pixel_id) || "";
  const codigoAtual = codigo !== null ? codigo : (r && r.codigo_de_teste) || "";
  const eventosAtuais = eventos !== null ? eventos : r ? r.eventos : (["Lead", "Purchase"] as EventoDaMeta[]);
  const mudou = pixel !== null || codigo !== null || eventos !== null || token.trim() !== "";
  const reler = () => Promise.all([qc.invalidateQueries({ queryKey: ["produto", "rastreamento"] }), qc.invalidateQueries({ queryKey: ["produto", "conversoes"] })]);

  const guardar = async (dados: Parameters<typeof salvarRastreamento>[0], aviso: string) => {
    setSalvando(true);
    try {
      qc.setQueryData(["produto", "rastreamento"], await salvarRastreamento(dados));
      setPixel(null);
      setCodigo(null);
      setEventos(null);
      setToken("");
      toast.success(aviso);
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar a conexão."));
    } finally {
      setSalvando(false);
    }
  };

  const salvar = () =>
    guardar(
      { meta_pixel_id: pixelAtual.trim(), eventos: eventosAtuais, codigo_de_teste: codigoAtual.trim(), ...(token.trim() ? { meta_token: token.trim() } : {}) },
      "Conexão com a Meta salva.",
    );

  const reenviar = async () => {
    try {
      const n = await reenviarConversoes();
      await reler();
      toast.success(n ? `${n} ${n === 1 ? "evento voltou" : "eventos voltaram"} para a fila.` : "Nada para reenviar.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível reenviar."));
    }
  };

  const alternarEvento = (e: EventoDaMeta, ligado: boolean) => setEventos(ligado ? eventosAtuais.filter((x) => x !== e).concat([e]) : eventosAtuais.filter((x) => x !== e));

  return (
    <Secao
      titulo="Meta"
      descricao={rastreamento.isLoading ? undefined : conexao.rotulo}
      ajuda="Com o Pixel, a página do formulário avisa a Meta de quem preencheu. Com o token da API de Conversões, o CRM também avisa pelo servidor: o lead do formulário e, depois, a venda com o valor quando o negócio é ganho. Assim a Meta aprende quais anúncios trazem cliente de verdade."
      acao={
        r && r.tem_token ? (
          <MenuMais rotulo="Mais ações da conexão" itens={[{ rotulo: "Desconectar o token", icone: <Unplug className="h-4 w-4" aria-hidden="true" />, perigo: true, aoEscolher: () => setDesligando(true) }]} />
        ) : undefined
      }
      data-conexao-com-a-meta={conexao.estado}
    >
      {rastreamento.isLoading ? (
        <Carregando linhas={4} rotulo="Carregando a conexão" />
      ) : rastreamento.isError ? (
        <EstadoDeErro acao={<button type="button" className={botao.secundario} onClick={() => void rastreamento.refetch()}>Tentar de novo</button>} />
      ) : (
        <div className="min-w-0 space-y-5">
          <ol className="min-w-0 space-y-1.5">
            {PASSOS_DA_META.map((p, i) => (
              <li key={p} className="flex min-w-0 items-start">
                <span className="mr-2.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{i + 1}</span>
                <span className={juntar(texto.corpo, "min-w-0")}>{p}</span>
              </li>
            ))}
          </ol>

          <div className="min-w-0 space-y-3">
            <CampoDeFormulario rotulo="ID do Pixel" apoio="Só números, como 123456789012345.">
              <input className={campo} value={pixelAtual} onChange={(e) => setPixel(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" maxLength={25} autoComplete="off" data-id-do-pixel="" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Token da API de Conversões" apoio={r && r.tem_token ? `Guardado. Termina em ${r.token_final || "****"}. Cole outro só para trocar.` : "Guardado no cofre. Ninguém vê de novo, nem você."}>
              <input className={campo} type="password" value={token} onChange={(e) => setToken(e.target.value)} maxLength={600} autoComplete="off" spellCheck={false} placeholder={r && r.tem_token ? "••••••••" : "Cole o token"} data-token-da-meta="" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Código de teste" ajuda="Opcional. Na aba Testar eventos do Gerenciador de Eventos, a Meta mostra um código como TEST12345. Com ele aqui, os eventos aparecem lá na hora, para conferir. Apague depois do teste: evento de teste não conta para os anúncios.">
              <input className={campo} value={codigoAtual} onChange={(e) => setCodigo(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} maxLength={40} autoComplete="off" placeholder="Vazio no dia a dia" />
            </CampoDeFormulario>
            <div className="min-w-0">
              <span className={juntar(texto.rotulo, "mb-1.5 block")}>O que volta para a Meta</span>
              {(["Lead", "Purchase"] as EventoDaMeta[]).map((e) => (
                <label key={e} className={juntar(texto.corpo, "flex min-w-0 items-center py-1")}>
                  <input type="checkbox" className="mr-2 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" checked={eventosAtuais.indexOf(e) >= 0} onChange={(ev) => alternarEvento(e, ev.target.checked)} data-evento-da-meta={e} />
                  <span className="min-w-0 truncate">{NOME_DO_EVENTO[e]}</span>
                </label>
              ))}
            </div>
            <div className="flex min-w-0 items-center">
              <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando || !mudou} data-salvar-conexao="">{salvando ? "Salvando..." : "Salvar"}</button>
              <span className={juntar(texto.auxiliar, "ml-3 min-w-0 flex-1 truncate", conexao.estado === "com_erro" && "text-destructive")} title={conexao.linha}>{conexao.linha}</span>
            </div>
          </div>

          <div className="min-w-0 border-t border-border pt-4" data-fila-de-conversoes="">
            <div className="mb-1 flex min-w-0 items-center">
              <span className="min-w-0 flex-1">
                <span className={juntar(texto.tituloSecao, "block truncate")}>Eventos</span>
                <span className={juntar(texto.auxiliar, "block truncate")}>
                  {r ? `${r.fila.enviados} enviados · ${r.fila.pendentes} na fila · ${r.fila.erros} com erro` : ""}
                  {r && r.ultimo_envio_em ? ` · último em ${diaLegivel(r.ultimo_envio_em)}` : ""}
                </span>
              </span>
              {r && r.fila.erros > 0 && (
                <button type="button" className={juntar(botao.secundario, "ml-2 h-8")} onClick={() => void reenviar()} data-reenviar-eventos="">
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Tentar de novo
                </button>
              )}
            </div>
            {fila.isLoading ? (
              <Carregando linhas={2} rotulo="Carregando os eventos" />
            ) : (fila.data || []).length === 0 ? (
              <p className={juntar(texto.auxiliar, "leading-5")}>Nenhum evento ainda. O primeiro sai quando alguém preencher um formulário.</p>
            ) : (
              <ul className={juntar(lista.aberta, lista.divisoria)}>
                {(fila.data || []).map((c) => (
                  <li key={c.id} className={lista.linha} data-conversao={c.situacao}>
                    <span className="min-w-0 flex-1">
                      <span className={juntar(texto.corpo, "block truncate")}>
                        {c.evento === "Purchase" ? "Compra" : "Lead"} · {c.negocio}
                        {c.evento === "Purchase" ? ` · ${reais(c.valor)}` : ""}
                      </span>
                      <span className={juntar(texto.auxiliar, "block truncate", c.situacao === "erro" && "text-destructive")} title={c.erro || undefined}>
                        {diaLegivel(c.criado_em)}
                        {c.erro ? ` · ${c.erro}` : c.tentativas > 1 ? ` · ${c.tentativas} tentativas` : ""}
                      </span>
                    </span>
                    <span className={juntar(etiqueta, "ml-2", COR_DA_SITUACAO[c.situacao])}>{NOME_DA_SITUACAO[c.situacao]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className={juntar(texto.auxiliar, "leading-5")} data-limite-do-lead-ads="">Formulário instantâneo da Meta (Lead Ads) ainda não entra: exige app aprovado na Meta.</p>
        </div>
      )}

      <JanelaCentral
        aberta={desligando}
        onFechar={() => setDesligando(false)}
        largura="sm"
        titulo="Desconectar o token da Meta?"
        rodape={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setDesligando(false)}>Manter</button>
            <button
              type="button"
              className={botao.perigo}
              onClick={() => {
                setDesligando(false);
                void guardar({ remover_token: true }, "Token removido. O CRM parou de enviar eventos pelo servidor.");
              }}
            >
              Desconectar
            </button>
          </>
        }
      >
        <p className={texto.corpo}>O token sai do cofre e o CRM para de enviar leads e vendas pelo servidor. O Pixel da página continua.</p>
      </JanelaCentral>
    </Secao>
  );
}

/**
 * Captação da empresa, numa tela só: os formulários com link público, de onde
 * vêm os negócios e as vendas, e a conexão com a Meta (Pixel e API de
 * Conversões). Gerente e administrador veem tudo; o vendedor vê só o
 * relatório, com os negócios que ele pode ver no funil.
 */
export default function CaptacaoDaConta({ estado }: { estado: EstadoDoProduto }) {
  const gestor = ehGestor(estado.eu ? estado.eu.papel : null);
  if (!gestor) {
    return (
      <div className="min-w-0" data-captacao-da-conta="vendedor">
        <Origens soOsMeus={!estado.ve_tudo} />
      </div>
    );
  }
  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]" data-captacao-da-conta="gestor">
      <div className="min-w-0 space-y-8">
        <Formularios estado={estado} />
        <Origens soOsMeus={false} />
      </div>
      <Meta />
    </div>
  );
}
