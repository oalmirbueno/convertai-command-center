import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Loader2, Plus, Save, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import BotaoComIcone from "@/components/sistema/BotaoComIcone";
import { PreencherComIA, type CampoParaPreencher } from "@/components/sistema";
import { botao, campo, campoTexto, espaco, foco, juntar, lista, texto } from "@/components/sistema/estilos";
import {
  aplicarNaEstrategia,
  ARQUETIPOS,
  camposDaEstrategia,
  declaracaoDePosicionamento,
  diferencasDaEstrategia,
  EIXOS_DE_PERSONALIDADE,
  type Estrategia,
  juntarProposta,
  normalizarEstrategia,
  progressoDaEstrategia,
  secaoFeita,
  SECOES_DA_ESTRATEGIA,
  type SecaoDaEstrategia,
  textoDoEixo,
  vazio,
} from "../../../supabase/functions/_shared/estrategia-de-marca";
import { chamarIdentidade, type ProjetoDeIdentidade } from "./identidadeApi";
import { CabecalhoDaEtapa, contextoParaPreencher, Pastilha, partesDoCusto, SeletorDoModelo, useModeloDaAcao, useProjetoDaMesa } from "./Comuns";
import { useGravacoesDaMesa, useValorSalvo } from "./gravacao";

const linhas = (v: string) => v.split(/\n+/).map((x) => x.trim()).filter(Boolean);
const juntarLinhas = (l: string[]) => l.join("\n");
const textoDosValores = (l: Estrategia["valores"]) => juntarLinhas(l.map((v) => (v.descricao ? `${v.nome}: ${v.descricao}` : v.nome)));

/** O que vai ao servidor: a estratégia normalizada, sem a data (a data vai à parte, só quando grava). */
function paraSalvar(x: Estrategia): Record<string, unknown> {
  const n = normalizarEstrategia(x) as unknown as Record<string, unknown>;
  delete n.atualizado_em;
  return n;
}

type Proposta = { proposta: Estrategia; fontes: string[]; avisos: string[]; modelo_id: string; custo_usd: number; projeto?: ProjetoDeIdentidade | null };

/** Valor para ler na prévia (lista vira linhas; objeto vira "chave: valor"). */
function paraLer(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? Object.values(x as Record<string, unknown>).filter(Boolean).join(" / ") : String(x))).join("\n");
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).map((k) => `${k}: ${paraLer((v as Record<string, unknown>)[k])}`).filter((l) => !/:\s*$/.test(l)).join("\n");
  return String(v);
}

/**
 * Etapa Estratégia (IDV2): a plataforma da marca antes do visual. Propósito,
 * missão, visão, valores, arquétipo (os 12), personalidade (eixos),
 * posicionamento, proposta de valor, público e persona, e tom de voz com
 * "fala assim / não fala assim".
 *
 * "Preencher a estratégia inteira" (modelo escolhido na hora, custo antes)
 * traz uma PROPOSTA: a prévia mostra antes x depois e a equipe aplica os
 * campos marcados, com Desfazer. Cada seção e cada campo têm o "Preencher com
 * IA" da peça comum.
 *
 * UXS 30/09: grava sozinha (ao sair do campo e 800 ms depois de parar de
 * digitar), só as chaves que mudaram, sem substituir a estratégia inteira (o
 * que o diretor ou outra pessoa gravou em outra chave fica). A releitura
 * ignora o próprio eco e não passa por cima do que está sendo digitado.
 */
export default function EtapaEstrategia() {
  const mesa = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, salvarParte, guardar } = useProjetoDaMesa();
  const avisarErro = useAvisarErro();
  const gravacoes = useGravacoesDaMesa();
  const [modeloId, setModeloId] = useModeloDaAcao("identidade");
  const [salvando, setSalvando] = useState(false);
  const [comWeb, setComWeb] = useState(false);
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const salva = useMemo(() => normalizarEstrategia(projeto.dados.estrategia), [projeto.dados.estrategia]);
  const parte = useValorSalvo<Estrategia, Record<string, unknown>>({
    id: "estrategia",
    servidor: salva,
    paraSalvar,
    gravar: (novo: Record<string, unknown>, anterior: Record<string, unknown>) => {
      // Só as chaves que ela mexeu: nunca a estratégia inteira por cima (o que falta no banco a leitura completa com o padrão).
      const mudou: Record<string, unknown> = {};
      for (const k of Object.keys(novo)) {
        if (JSON.stringify(novo[k]) !== JSON.stringify(anterior ? anterior[k] : undefined)) mudou[k] = novo[k];
      }
      if (!Object.keys(mudou).length) return Promise.resolve();
      mudou.atualizado_em = new Date().toISOString();
      return salvarParte("estrategia", mudou);
    },
  });
  const e = parte.valor;
  const mudou = parte.pendente;
  const marcaId = projeto.marca_id || (marca && !marca.principal ? marca.id : null);
  const nomeDaMarca = (projeto.dados.naming && projeto.dados.naming.nome) || (marca && !marca.principal ? marca.nome : mesa.clientName);

  // Valores: campo controlado com o texto da tela (a linha em edição não some); a lista vem do texto.
  const [valoresTexto, setValoresTexto] = useState(() => textoDosValores(e.valores));
  const valoresEmJson = JSON.stringify(e.valores);
  useEffect(() => {
    if (JSON.stringify(aplicarNaEstrategia(e, { valores: linhas(valoresTexto) }).valores) !== valoresEmJson) setValoresTexto(textoDosValores(e.valores));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valoresEmJson]);

  /** Troca e grava já (IA, proposta, Desfazer). O aviso de erro sai aqui; lança para quem chamou. */
  const gravar = async (nova: Estrategia, frase?: string, anterior?: Estrategia) => {
    setSalvando(true);
    try {
      await parte.trocarESalvar(JSON.parse(JSON.stringify(nova)) as Estrategia);
      if (frase && anterior) {
        toast.success(frase, {
          duration: 10_000,
          action: { label: "Desfazer", onClick: () => void gravar(anterior).catch(() => undefined) },
        });
      } else if (frase) toast.success(frase);
    } catch (err) {
      avisarErro(err, "A estratégia não foi salva");
      throw err;
    } finally {
      setSalvando(false);
    }
  };

  /** O que veio do "Preencher com IA" (por chave) entra e é gravado; o Desfazer da peça volta os anteriores. */
  const aplicarValores = async (valores: Record<string, unknown>) => {
    const nova = aplicarNaEstrategia(normalizarEstrategia(e), valores);
    if (!nova.posicionamento.declaracao && (valores["posicionamento.publico"] || valores["posicionamento.diferencial"])) nova.posicionamento.declaracao = declaracaoDePosicionamento(nova.posicionamento, nomeDaMarca);
    await gravar(nova);
  };

  const contexto = contextoParaPreencher(projeto);
  const preencher = (campos: CampoParaPreencher[], rotulo?: string, compacto = false) => (
    <PreencherComIA
      papel="identidade"
      clientId={mesa.clientId}
      marcaId={marcaId}
      campos={campos}
      contexto={contexto}
      fontes={["contexto", "briefing", "dossie", "arquivos"]}
      rotulo={rotulo}
      compacto={compacto}
      revelar={compacto}
      onAplicar={(v) => aplicarValores(v)}
      onDesfazer={(anteriores) => aplicarValores(anteriores)}
    />
  );
  const campoDe = (chave: string): CampoParaPreencher => camposDaEstrategia(e).filter((c) => c.chave === chave)[0] as CampoParaPreencher;
  const rotuloComIA = (rotulo: string, chave: string): ReactNode => (
    <span className="flex min-w-0 items-center">
      <span className="mr-1 min-w-0 truncate">{rotulo}</span>
      {preencher([campoDe(chave)], `Preencher ${rotulo.toLowerCase()} com IA`, true)}
    </span>
  );
  const acaoDaSecao = (secao: SecaoDaEstrategia) => preencher(camposDaEstrategia(e, secao) as CampoParaPreencher[], "Preencher tudo");
  const estado = (secao: SecaoDaEstrategia) => (secaoFeita(secao, normalizarEstrategia(e)) ? "Feita" : "Em aberto");
  // Editar não normaliza (linha vazia em edição não some); só o que vai ao servidor é normalizado.
  const mexer = (fn: (x: Estrategia) => Estrategia) => parte.mudar((x) => fn(JSON.parse(JSON.stringify(x)) as Estrategia));
  const andamento = progressoDaEstrategia(normalizarEstrategia(e));
  const tirarExemplo = (i: number) => {
    const antes = e;
    const ex = e.tom.exemplos[i];
    const nova = JSON.parse(JSON.stringify(e)) as Estrategia;
    nova.tom.exemplos = nova.tom.exemplos.filter((_, k) => k !== i);
    const temTexto = !!ex && !!(ex.situacao || ex.certo || ex.errado);
    parte
      .trocarESalvar(nova)
      .then(() => {
        if (temTexto) toast.success("Exemplo tirado", { duration: 10_000, action: { label: "Desfazer", onClick: () => void gravar(antes).catch(() => undefined) } });
      })
      .catch((err) => avisarErro(err, "A estratégia não foi salva"));
  };

  return (
    <div
      className={espaco.pagina}
      data-etapa-estrategia=""
      onBlur={() => {
        if (gravacoes && gravacoes.temPendente()) void gravacoes.salvarTudo().catch(() => undefined);
      }}
    >
      <CabecalhoDaEtapa
        etapa="estrategia"
        ajuda="A estratégia vem antes do visual: é ela que decide o nome, o conceito e as cores. A IA propõe a partir do briefing, da pesquisa, do moodboard e do contexto da marca; nada é gravado sem você ver. Campo sem base nas fontes volta vazio, com aviso."
        acoes={
          <>
            <SeletorDoModelo papel="identidade" valor={modeloId} onEscolher={setModeloId} className="max-w-[180px]" />
            <label className={juntar(texto.auxiliar, "m-1 inline-flex items-center")} title="A IA também pesquisa na web (custa um pouco mais)">
              <input type="checkbox" className="mr-1.5 h-4 w-4 accent-primary" checked={comWeb} onChange={(ev) => setComWeb(ev.target.checked)} />
              Web
            </label>
            <BotaoComCusto
              rotulo={
                <>
                  <span className="sm:hidden">Estratégia inteira</span>
                  <span className="hidden sm:inline">Preencher a estratégia inteira</span>
                </>
              }
              titulo="Estratégia de marca"
              descricao="Proposta completa; você vê a prévia antes de aplicar"
              partes={() => partesDoCusto(mesa.catalogo, "estrategia", modeloId, comWeb)}
              executar={() => chamarIdentidade<Proposta>("estrategia_propor", { projeto_id: projeto.id, modelo_id: modeloId || undefined, usar_web: comWeb || undefined })}
              aoConcluir={(d) => {
                if (!d) return;
                if (d.projeto) guardar(d.projeto);
                setProposta({ ...d, proposta: normalizarEstrategia(d.proposta) });
              }}
              className="m-1 h-8"
            />
            <BotaoComIcone
              variante="discreto"
              className="m-1 h-8"
              icone={salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              rotulo="Salvar agora"
              title="A estratégia grava sozinha; isto grava já"
              disabled={!mudou || salvando}
              onClick={() => {
                setSalvando(true);
                parte
                  .salvarAgora()
                  .catch((err) => avisarErro(err, "A estratégia não foi salva"))
                  .then(() => setSalvando(false));
              }}
              data-salvar-estrategia=""
            />
          </>
        }
      />
      <p className={texto.auxiliar} data-andamento-da-estrategia={`${andamento.feitas}/${andamento.total}`}>
        {andamento.feitas} de {andamento.total} partes feitas{e.fontes.length ? ` · fontes da última proposta: ${e.fontes.join(", ")}` : ""}
      </p>

      {proposta && (
        <PreviaDaEstrategia
          atual={e}
          proposta={proposta}
          onDescartar={() => setProposta(null)}
          onAplicar={async (chaves) => {
            const anterior = e;
            // Marcar um campo que já tem texto é trocar esse texto (UXS 30/09): substitui sempre, só nos marcados.
            const r = juntarProposta(normalizarEstrategia(e), proposta.proposta, { substituir: true, chaves });
            if (!r.mudaram.length) {
              toast.info("Nada novo para aplicar (os campos já estavam preenchidos).");
              return;
            }
            await gravar({ ...r.estrategia, fontes: proposta.fontes }, r.mudaram.length === 1 ? "1 campo aplicado" : `${r.mudaram.length} campos aplicados`, anterior);
            setProposta(null);
          }}
        />
      )}

      <Secao titulo="Propósito, missão e visão" descricao={estado("plataforma")} recolher={`mesa-identidade:${projeto.id}:estrategia:plataforma`} acao={acaoDaSecao("plataforma")} data-bloco-da-etapa="plataforma">
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
          {(["proposito", "missao", "visao"] as const).map((k) => (
            <CampoDeFormulario key={k} className="group" rotulo={rotuloComIA(k === "proposito" ? "Propósito" : k === "missao" ? "Missão" : "Visão", k)}>
              <textarea className={juntar(campoTexto, "min-h-[96px]")} value={e[k]} maxLength={600} onChange={(ev) => mexer((x) => ({ ...x, [k]: ev.target.value }))} />
            </CampoDeFormulario>
          ))}
        </div>
      </Secao>

      <Secao titulo="Valores" divisoria descricao={`${e.valores.length} valores`} recolher={`mesa-identidade:${projeto.id}:estrategia:valores`} acao={acaoDaSecao("valores")} data-bloco-da-etapa="valores">
        <CampoDeFormulario className="group" rotulo={rotuloComIA("Valores", "valores")} apoio="Um por linha, no formato Nome: como aparece no dia a dia">
          <textarea
            className={juntar(campoTexto, "min-h-[120px]")}
            value={valoresTexto}
            onChange={(ev) => {
              const t = ev.target.value;
              setValoresTexto(t);
              mexer((x) => aplicarNaEstrategia(x, { valores: linhas(t) }));
            }}
          />
        </CampoDeFormulario>
      </Secao>

      <Secao titulo="Arquétipo" divisoria descricao={e.arquetipo.principal ? ARQUETIPOS.filter((a) => a.valor === e.arquetipo.principal)[0].rotulo : "A escolher"} recolher={`mesa-identidade:${projeto.id}:estrategia:arquetipo`} acao={acaoDaSecao("arquetipo")} data-bloco-da-etapa="arquetipo" ajuda="Os 12 arquétipos de marca descrevem o papel que a marca faz na vida do cliente. Escolha um principal (o que mais explica o comportamento) e, se ajudar, um de apoio.">
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4" role="radiogroup" aria-label="Arquétipo principal">
          {ARQUETIPOS.map((a) => {
            const principal = e.arquetipo.principal === a.valor;
            const apoio = e.arquetipo.secundario === a.valor;
            return (
              <button
                key={a.valor}
                type="button"
                role="radio"
                aria-checked={principal}
                title={`Deseja: ${a.desejo}. Voz: ${a.voz}. Ex.: ${a.exemplo}.`}
                onClick={() => mexer((x) => ({ ...x, arquetipo: { ...x.arquetipo, principal: a.valor, secundario: x.arquetipo.secundario === a.valor ? "" : x.arquetipo.secundario } }))}
                className={juntar("min-w-0 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted", principal ? "border-primary bg-primary/10" : apoio ? "border-primary/50" : "border-border", foco)}
                data-arquetipo={a.valor}
              >
                <span className="flex min-w-0 items-center">
                  <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate font-medium")}>{a.rotulo}</span>
                  {principal && <Pastilha tom="bom">principal</Pastilha>}
                  {apoio && <Pastilha>apoio</Pastilha>}
                </span>
                <span className={juntar(texto.auxiliar, "block truncate")}>{a.desejo}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <CampoDeFormulario rotulo="Arquétipo de apoio">
            <select className={campo} value={e.arquetipo.secundario} onChange={(ev) => mexer((x) => ({ ...x, arquetipo: { ...x.arquetipo, secundario: ev.target.value as Estrategia["arquetipo"]["secundario"] } }))}>
              <option value="">Nenhum</option>
              {ARQUETIPOS.filter((a) => a.valor !== e.arquetipo.principal).map((a) => (
                <option key={a.valor} value={a.valor}>
                  {a.rotulo}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario className="group" rotulo={rotuloComIA("Por que este arquétipo", "arquetipo.justificativa")}>
            <textarea className={juntar(campoTexto, "min-h-[72px]")} value={e.arquetipo.justificativa} maxLength={900} onChange={(ev) => mexer((x) => ({ ...x, arquetipo: { ...x.arquetipo, justificativa: ev.target.value } }))} />
          </CampoDeFormulario>
        </div>
      </Secao>

      <Secao titulo="Personalidade" divisoria descricao={estado("personalidade")} recolher={`mesa-identidade:${projeto.id}:estrategia:personalidade`} acao={acaoDaSecao("personalidade")} data-bloco-da-etapa="personalidade" ajuda="Os eixos mostram onde a marca fica entre dois extremos. O meio é equilibrado; as pontas são escolhas fortes, que orientam cor, tipo e texto.">
        <div className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
          {EIXOS_DE_PERSONALIDADE.map((x) => (
            <label key={x.valor} className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)_88px] items-center gap-2" data-eixo={x.valor}>
              <span className={juntar(texto.auxiliar, "text-right")}>{x.esquerda}</span>
              <input type="range" min={-2} max={2} step={1} value={e.personalidade.eixos[x.valor]} aria-label={`${x.esquerda} ou ${x.direita}: ${textoDoEixo(x.valor, e.personalidade.eixos[x.valor])}`} onChange={(ev) => mexer((y) => ({ ...y, personalidade: { ...y.personalidade, eixos: { ...y.personalidade.eixos, [x.valor]: Number(ev.target.value) } } }))} />
              <span className={texto.auxiliar}>{x.direita}</span>
            </label>
          ))}
        </div>
        <CampoDeFormulario rotulo={rotuloComIA("Traços", "personalidade.tracos")} apoio="Separe por vírgula" className="group mt-4">
          <input className={campo} value={e.personalidade.tracos.join(", ")} onChange={(ev) => mexer((x) => ({ ...x, personalidade: { ...x.personalidade, tracos: ev.target.value.split(/[,;]+/).map((t) => t.trim()) } }))} />
        </CampoDeFormulario>
      </Secao>

      <Secao titulo="Posicionamento" divisoria descricao={estado("posicionamento")} recolher={`mesa-identidade:${projeto.id}:estrategia:posicionamento`} acao={acaoDaSecao("posicionamento")} data-bloco-da-etapa="posicionamento">
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          {(
            [
              ["publico", "Para quem"],
              ["categoria", "Categoria"],
              ["diferencial", "Diferencial"],
              ["prova", "Prova (por que acreditar)"],
              ["concorrentes", "Contra quem"],
            ] as const
          ).map(([k, r]) => (
            <CampoDeFormulario key={k} className="group" rotulo={rotuloComIA(r, `posicionamento.${k}`)}>
              <input className={campo} value={e.posicionamento[k]} maxLength={400} onChange={(ev) => mexer((x) => ({ ...x, posicionamento: { ...x.posicionamento, [k]: ev.target.value } }))} />
            </CampoDeFormulario>
          ))}
          <CampoDeFormulario rotulo="Frase de posicionamento" largo>
            <textarea className={juntar(campoTexto, "min-h-[60px]")} value={e.posicionamento.declaracao} maxLength={600} onChange={(ev) => mexer((x) => ({ ...x, posicionamento: { ...x.posicionamento, declaracao: ev.target.value } }))} />
          </CampoDeFormulario>
        </div>
        <button type="button" className={juntar(botao.discreto, "mt-2")} disabled={!declaracaoDePosicionamento(e.posicionamento, nomeDaMarca)} onClick={() => mexer((x) => ({ ...x, posicionamento: { ...x.posicionamento, declaracao: declaracaoDePosicionamento(x.posicionamento, nomeDaMarca) } }))}>
          Montar a frase pelas partes
        </button>
      </Secao>

      <Secao titulo="Proposta de valor" divisoria descricao={estado("proposta")} recolher={`mesa-identidade:${projeto.id}:estrategia:proposta`} acao={acaoDaSecao("proposta")} data-bloco-da-etapa="proposta">
        <CampoDeFormulario className="group" rotulo={rotuloComIA("Promessa", "proposta_de_valor.promessa")}>
          <input className={campo} value={e.proposta_de_valor.promessa} maxLength={400} onChange={(ev) => mexer((x) => ({ ...x, proposta_de_valor: { ...x.proposta_de_valor, promessa: ev.target.value } }))} />
        </CampoDeFormulario>
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
          {(
            [
              ["dores", "Dores do cliente"],
              ["ganhos", "Ganhos"],
              ["alivios", "Como a marca alivia"],
            ] as const
          ).map(([k, r]) => (
            <CampoDeFormulario key={k} className="group" rotulo={rotuloComIA(r, `proposta_de_valor.${k}`)} apoio="Um por linha">
              <textarea className={juntar(campoTexto, "min-h-[96px]")} value={juntarLinhas(e.proposta_de_valor[k])} onChange={(ev) => mexer((x) => ({ ...x, proposta_de_valor: { ...x.proposta_de_valor, [k]: linhas(ev.target.value) } }))} />
            </CampoDeFormulario>
          ))}
        </div>
      </Secao>

      <Secao titulo="Público e persona" divisoria descricao={estado("publico")} recolher={`mesa-identidade:${projeto.id}:estrategia:publico`} acao={acaoDaSecao("publico")} data-bloco-da-etapa="publico" ajuda="A persona é um modelo do cliente ideal, não uma pessoa real: nome fictício e idade em faixa.">
        <CampoDeFormulario className="group" rotulo={rotuloComIA("Público", "publico.resumo")}>
          <textarea className={juntar(campoTexto, "min-h-[72px]")} value={e.publico.resumo} maxLength={900} onChange={(ev) => mexer((x) => ({ ...x, publico: { ...x.publico, resumo: ev.target.value } }))} />
        </CampoDeFormulario>
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
          {(
            [
              ["nome", "Nome da persona"],
              ["idade", "Idade"],
              ["ocupacao", "Ocupação"],
            ] as const
          ).map(([k, r]) => (
            <CampoDeFormulario key={k} rotulo={r}>
              <input className={campo} value={e.publico.persona[k]} maxLength={k === "ocupacao" ? 120 : 60} onChange={(ev) => mexer((x) => ({ ...x, publico: { ...x.publico, persona: { ...x.publico.persona, [k]: ev.target.value } } }))} />
            </CampoDeFormulario>
          ))}
          <CampoDeFormulario rotulo="Rotina" largo className="md:col-span-3">
            <textarea className={juntar(campoTexto, "min-h-[60px]")} value={e.publico.persona.rotina} maxLength={600} onChange={(ev) => mexer((x) => ({ ...x, publico: { ...x.publico, persona: { ...x.publico.persona, rotina: ev.target.value } } }))} />
          </CampoDeFormulario>
          {(
            [
              ["dores", "Dores"],
              ["desejos", "Desejos"],
              ["objecoes", "Objeções"],
            ] as const
          ).map(([k, r]) => (
            <CampoDeFormulario key={k} rotulo={r} apoio="Um por linha">
              <textarea className={juntar(campoTexto, "min-h-[88px]")} value={juntarLinhas(e.publico.persona[k])} onChange={(ev) => mexer((x) => ({ ...x, publico: { ...x.publico, persona: { ...x.publico.persona, [k]: linhas(ev.target.value) } } }))} />
            </CampoDeFormulario>
          ))}
          <CampoDeFormulario rotulo="Onde está" apoio="Separe por vírgula">
            <input className={campo} value={e.publico.persona.onde_esta.join(", ")} onChange={(ev) => mexer((x) => ({ ...x, publico: { ...x.publico, persona: { ...x.publico.persona, onde_esta: ev.target.value.split(/[,;]+/).map((t) => t.trim()) } } }))} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Uma frase dela" largo className="md:col-span-2">
            <input className={campo} value={e.publico.persona.frase} maxLength={200} onChange={(ev) => mexer((x) => ({ ...x, publico: { ...x.publico, persona: { ...x.publico.persona, frase: ev.target.value } } }))} />
          </CampoDeFormulario>
        </div>
      </Secao>

      <Secao titulo="Tom de voz" divisoria descricao={estado("tom")} recolher={`mesa-identidade:${projeto.id}:estrategia:tom`} acao={acaoDaSecao("tom")} data-bloco-da-etapa="tom">
        <CampoDeFormulario className="group" rotulo={rotuloComIA("Atributos da voz", "tom.atributos")} apoio="Separe por vírgula">
          <input className={campo} value={e.tom.atributos.join(", ")} onChange={(ev) => mexer((x) => ({ ...x, tom: { ...x.tom, atributos: ev.target.value.split(/[,;]+/).map((t) => t.trim()) } }))} />
        </CampoDeFormulario>
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          <CampoDeFormulario className="group" rotulo={rotuloComIA("Fala assim", "tom.fala_assim")} apoio="Uma frase por linha">
            <textarea className={juntar(campoTexto, "min-h-[110px]")} value={juntarLinhas(e.tom.fala_assim)} onChange={(ev) => mexer((x) => ({ ...x, tom: { ...x.tom, fala_assim: linhas(ev.target.value) } }))} />
          </CampoDeFormulario>
          <CampoDeFormulario className="group" rotulo={rotuloComIA("Não fala assim", "tom.nao_fala_assim")} apoio="Uma frase por linha">
            <textarea className={juntar(campoTexto, "min-h-[110px]")} value={juntarLinhas(e.tom.nao_fala_assim)} onChange={(ev) => mexer((x) => ({ ...x, tom: { ...x.tom, nao_fala_assim: linhas(ev.target.value) } }))} />
          </CampoDeFormulario>
        </div>
        <div className="mt-4 min-w-0">
          <div className="group mb-2 flex min-w-0 items-center">
            <h3 className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>Exemplos por situação</h3>
            {preencher([campoDe("tom.exemplos")], "Preencher exemplos com IA", true)}
          </div>
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Exemplos de tom">
            {e.tom.exemplos.map((x, i) => (
              <li key={i} className={juntar(lista.linha, "grid grid-cols-1 items-start gap-2 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_auto]")}>
                <input className={campo} value={x.situacao} placeholder="Situação" aria-label="Situação" onChange={(ev) => mexer((y) => ({ ...y, tom: { ...y.tom, exemplos: y.tom.exemplos.map((z, k) => (k === i ? { ...z, situacao: ev.target.value } : z)) } }))} />
                <input className={campo} value={x.certo} placeholder="Fala assim" aria-label="Fala assim" onChange={(ev) => mexer((y) => ({ ...y, tom: { ...y.tom, exemplos: y.tom.exemplos.map((z, k) => (k === i ? { ...z, certo: ev.target.value } : z)) } }))} />
                <input className={campo} value={x.errado} placeholder="Não fala assim" aria-label="Não fala assim" onChange={(ev) => mexer((y) => ({ ...y, tom: { ...y.tom, exemplos: y.tom.exemplos.map((z, k) => (k === i ? { ...z, errado: ev.target.value } : z)) } }))} />
                <button type="button" className={botao.icone} aria-label="Tirar o exemplo" onClick={() => tirarExemplo(i)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={juntar(botao.discreto, "mt-2")} disabled={e.tom.exemplos.length >= 6} onClick={() => mexer((x) => ({ ...x, tom: { ...x.tom, exemplos: x.tom.exemplos.concat([{ situacao: "", certo: "", errado: "" }]) } }))}>
            <Plus className="mr-1.5 h-4 w-4" /> Exemplo
          </button>
        </div>
      </Secao>
    </div>
  );
}

/**
 * A prévia da proposta inteira: antes x depois por campo. Os campos vazios
 * hoje já vêm marcados; marcar um campo que já tem texto troca esse texto
 * (a linha avisa "troca o atual"). Um botão só, "Aplicar (n)"; os atalhos
 * "Marcar todos" e "Só os vazios" ficam em cima da lista. Nada muda sem
 * Aplicar; o Desfazer vem no aviso. (UXS 30/09: antes eram três controles
 * para a mesma decisão, com uma regra diferente em cada botão.)
 */
function PreviaDaEstrategia({ atual, proposta, onAplicar, onDescartar }: { atual: Estrategia; proposta: Proposta; onAplicar: (chaves: string[]) => Promise<void>; onDescartar: () => void }) {
  const difs = useMemo(() => diferencasDaEstrategia(atual, proposta.proposta).filter((d) => !vazio(d.depois)), [atual, proposta]);
  const soVazios = useMemo(() => difs.filter((d) => vazio(d.antes)).map((d) => d.chave), [difs]);
  const [marcadas, setMarcadas] = useState<string[]>(() => soVazios);
  const [aplicando, setAplicando] = useState(false);
  const todasMarcadas = difs.length > 0 && marcadas.length === difs.length;
  const rodar = async (chaves: string[]) => {
    setAplicando(true);
    try {
      await onAplicar(chaves);
    } catch {
      /* o aviso já apareceu (gravar) */
    } finally {
      setAplicando(false);
    }
  };
  return (
    <Secao
      titulo="Proposta da IA"
      descricao={`${difs.length} campos propostos · ${marcadas.length} marcados`}
      recolher={false}
      ajuda="Os campos vazios já vêm marcados. Marcar um campo que já tem texto troca esse texto. Nada muda sem Aplicar."
      acao={
        <>
          <button type="button" className={juntar(botao.primario, "m-1 h-8")} disabled={aplicando || !marcadas.length} onClick={() => void rodar(marcadas)} data-aplicar-proposta="">
            {aplicando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Aplicar ({marcadas.length})
          </button>
          <button type="button" className={juntar(botao.discreto, "m-1 h-8")} onClick={onDescartar}>
            <X className="mr-1.5 h-3.5 w-3.5" /> Descartar
          </button>
        </>
      }
    >
      {(proposta.fontes.length > 0 || proposta.avisos.length > 0) && (
        <div className="mb-3 min-w-0">
          {proposta.fontes.length > 0 && <p className={texto.auxiliar}>Fontes: {proposta.fontes.join(", ")}</p>}
          {proposta.avisos.map((a) => (
            <p key={a} className={juntar(texto.auxiliar, "text-warning")}>
              {a}
            </p>
          ))}
        </div>
      )}
      {difs.length > 0 && (
        <div className="-m-1 mb-1 flex min-w-0 flex-wrap items-center">
          <button type="button" className={juntar(botao.discreto, "m-1 h-8")} onClick={() => setMarcadas(todasMarcadas ? soVazios : difs.map((d) => d.chave))} data-alternar-marcados="">
            {todasMarcadas ? "Só os vazios" : "Marcar todos"}
          </button>
        </div>
      )}
      <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Campos propostos">
        {difs.map((d) => {
          const on = marcadas.indexOf(d.chave) >= 0;
          const troca = on && !vazio(d.antes);
          return (
            <li key={d.chave} className={juntar(lista.linha, "items-start", on && lista.destaque)} data-campo-proposto={d.chave}>
              <input type="checkbox" className="mr-3 mt-1 h-4 w-4 shrink-0 accent-primary" checked={on} aria-label={`Aplicar ${d.rotulo}`} onChange={() => setMarcadas((m) => (on ? m.filter((x) => x !== d.chave) : m.concat([d.chave])))} />
              <span className="min-w-0 flex-1">
                <span className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)]">
                  <span className="min-w-0">
                    <span className={juntar(texto.rotulo, "block truncate")}>{d.rotulo}</span>
                    {troca && (
                      <span className="mt-0.5 block" data-troca-o-atual="">
                        <Pastilha tom="alerta">troca o atual</Pastilha>
                      </span>
                    )}
                  </span>
                  <span className={juntar(texto.auxiliar, "whitespace-pre-line line-through decoration-muted-foreground/40")}>{paraLer(d.antes) || "vazio"}</span>
                  <span className={juntar(texto.corpo, "whitespace-pre-line")}>{paraLer(d.depois)}</span>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {!difs.length && (
        <p className={texto.auxiliar}>
          <Undo2 className="mr-1 inline h-3.5 w-3.5" /> A proposta não trouxe nada diferente do que já está salvo.
        </p>
      )}
    </Secao>
  );
}
