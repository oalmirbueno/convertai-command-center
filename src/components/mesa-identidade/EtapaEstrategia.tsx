import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Loader2, Plus, Save, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
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

const linhas = (v: string) => v.split(/\n+/).map((x) => x.trim()).filter(Boolean);
const juntarLinhas = (l: string[]) => l.join("\n");

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
 * traz uma PROPOSTA: a prévia mostra antes x depois e a equipe aplica tudo ou
 * campo a campo, com Desfazer. Cada seção e cada campo têm o "Preencher com
 * IA" da peça comum.
 */
export default function EtapaEstrategia() {
  const mesa = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, salvarParte, guardar } = useProjetoDaMesa();
  const avisarErro = useAvisarErro();
  const [modeloId, setModeloId] = useModeloDaAcao("identidade");
  const [e, setE] = useState<Estrategia>(() => normalizarEstrategia(projeto.dados.estrategia));
  const [salvando, setSalvando] = useState(false);
  const [comWeb, setComWeb] = useState(false);
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const salva = useMemo(() => normalizarEstrategia(projeto.dados.estrategia), [projeto.dados.estrategia]);
  const mudou = JSON.stringify(normalizarEstrategia(e)) !== JSON.stringify(salva);
  const marcaId = projeto.marca_id || (marca && !marca.principal ? marca.id : null);
  const nomeDaMarca = (projeto.dados.naming && projeto.dados.naming.nome) || (marca && !marca.principal ? marca.nome : mesa.clientName);

  // Relê só quando a estratégia salva muda (a versão do projeto sobe por outras partes e pelo custo).
  const salvaEmTexto = JSON.stringify(projeto.dados.estrategia || null);
  useEffect(() => {
    setE(normalizarEstrategia(projeto.dados.estrategia));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projeto.id, salvaEmTexto]);

  const gravar = async (nova: Estrategia, frase?: string, anterior?: Estrategia) => {
    setSalvando(true);
    try {
      const completa = { ...normalizarEstrategia(nova), atualizado_em: new Date().toISOString() };
      await salvarParte("estrategia", completa as unknown as Record<string, unknown>, { substituir: true });
      setE(completa);
      if (frase && anterior) {
        toast.success(frase, {
          duration: 10_000,
          action: { label: "Desfazer", onClick: () => void gravar(anterior) },
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
  // Editar não normaliza (linha vazia em edição não some); o Salvar normaliza.
  const mexer = (fn: (x: Estrategia) => Estrategia) => setE((x) => fn(JSON.parse(JSON.stringify(x)) as Estrategia));
  const andamento = progressoDaEstrategia(normalizarEstrategia(e));

  return (
    <div className={espaco.pagina} data-etapa-estrategia="">
      <CabecalhoDaEtapa
        etapa="estrategia"
        ajuda="A estratégia vem antes do visual: é ela que decide o nome, o conceito e as cores. A IA propõe a partir do briefing, da pesquisa, do moodboard e do contexto da marca; nada é gravado sem você ver. Campo sem base nas fontes volta vazio, com aviso."
        acoes={
          <>
            <SeletorDoModelo papel="identidade" valor={modeloId} onEscolher={setModeloId} />
            <label className={juntar(texto.auxiliar, "m-1 inline-flex items-center")} title="A IA também pesquisa na web (custa um pouco mais)">
              <input type="checkbox" className="mr-1.5 h-4 w-4 accent-primary" checked={comWeb} onChange={(ev) => setComWeb(ev.target.checked)} />
              Web
            </label>
            <BotaoComCusto
              rotulo="Preencher a estratégia inteira"
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
            <button type="button" className={juntar(mudou ? botao.primario : botao.secundario, "m-1 h-8")} disabled={!mudou || salvando} onClick={() => void gravar(e, "Estratégia salva").catch(() => undefined)} data-salvar-estrategia="">
              {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />} Salvar
            </button>
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
          onAplicar={async (chaves, substituir) => {
            const anterior = e;
            const r = juntarProposta(normalizarEstrategia(e), proposta.proposta, { substituir, chaves });
            if (!r.mudaram.length) {
              toast.info("Nada novo para aplicar (os campos já estavam preenchidos).");
              return;
            }
            await gravar({ ...r.estrategia, fontes: proposta.fontes }, r.mudaram.length === 1 ? "1 campo aplicado" : `${r.mudaram.length} campos aplicados`, anterior);
            setProposta(null);
          }}
        />
      )}

      <Secao titulo="Propósito, missão e visão" descricao={estado("plataforma")} recolher={`mesa-identidade:${projeto.id}:estrategia:plataforma`} acao={acaoDaSecao("plataforma")}>
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
          {(["proposito", "missao", "visao"] as const).map((k) => (
            <CampoDeFormulario key={k} rotulo={rotuloComIA(k === "proposito" ? "Propósito" : k === "missao" ? "Missão" : "Visão", k)}>
              <textarea className={juntar(campoTexto, "min-h-[96px]")} value={e[k]} maxLength={600} onChange={(ev) => mexer((x) => ({ ...x, [k]: ev.target.value }))} />
            </CampoDeFormulario>
          ))}
        </div>
      </Secao>

      <Secao titulo="Valores" divisoria descricao={`${e.valores.length} valores`} recolher={`mesa-identidade:${projeto.id}:estrategia:valores`} acao={acaoDaSecao("valores")}>
        <CampoDeFormulario rotulo={rotuloComIA("Valores", "valores")} apoio="Um por linha, no formato Nome: como aparece no dia a dia">
          <textarea
            className={juntar(campoTexto, "min-h-[120px]")}
            defaultValue={juntarLinhas(e.valores.map((v) => (v.descricao ? `${v.nome}: ${v.descricao}` : v.nome)))}
            key={`valores-${projeto.versao}-${e.valores.length}`}
            onBlur={(ev) => mexer((x) => aplicarNaEstrategia(x, { valores: linhas(ev.target.value) }))}
          />
        </CampoDeFormulario>
      </Secao>

      <Secao titulo="Arquétipo" divisoria descricao={e.arquetipo.principal ? ARQUETIPOS.filter((a) => a.valor === e.arquetipo.principal)[0].rotulo : "A escolher"} recolher={`mesa-identidade:${projeto.id}:estrategia:arquetipo`} acao={acaoDaSecao("arquetipo")} ajuda="Os 12 arquétipos de marca descrevem o papel que a marca faz na vida do cliente. Escolha um principal (o que mais explica o comportamento) e, se ajudar, um de apoio.">
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
          <CampoDeFormulario rotulo={rotuloComIA("Por que este arquétipo", "arquetipo.justificativa")}>
            <textarea className={juntar(campoTexto, "min-h-[72px]")} value={e.arquetipo.justificativa} maxLength={900} onChange={(ev) => mexer((x) => ({ ...x, arquetipo: { ...x.arquetipo, justificativa: ev.target.value } }))} />
          </CampoDeFormulario>
        </div>
      </Secao>

      <Secao titulo="Personalidade" divisoria descricao={estado("personalidade")} recolher={`mesa-identidade:${projeto.id}:estrategia:personalidade`} acao={acaoDaSecao("personalidade")} ajuda="Os eixos mostram onde a marca fica entre dois extremos. O meio é equilibrado; as pontas são escolhas fortes, que orientam cor, tipo e texto.">
        <div className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
          {EIXOS_DE_PERSONALIDADE.map((x) => (
            <label key={x.valor} className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)_88px] items-center gap-2" data-eixo={x.valor}>
              <span className={juntar(texto.auxiliar, "text-right")}>{x.esquerda}</span>
              <input type="range" min={-2} max={2} step={1} value={e.personalidade.eixos[x.valor]} aria-label={`${x.esquerda} ou ${x.direita}: ${textoDoEixo(x.valor, e.personalidade.eixos[x.valor])}`} onChange={(ev) => mexer((y) => ({ ...y, personalidade: { ...y.personalidade, eixos: { ...y.personalidade.eixos, [x.valor]: Number(ev.target.value) } } }))} />
              <span className={texto.auxiliar}>{x.direita}</span>
            </label>
          ))}
        </div>
        <CampoDeFormulario rotulo={rotuloComIA("Traços", "personalidade.tracos")} apoio="Separe por vírgula" className="mt-4">
          <input className={campo} value={e.personalidade.tracos.join(", ")} onChange={(ev) => mexer((x) => ({ ...x, personalidade: { ...x.personalidade, tracos: ev.target.value.split(/[,;]+/).map((t) => t.trim()) } }))} />
        </CampoDeFormulario>
      </Secao>

      <Secao titulo="Posicionamento" divisoria descricao={estado("posicionamento")} recolher={`mesa-identidade:${projeto.id}:estrategia:posicionamento`} acao={acaoDaSecao("posicionamento")}>
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
            <CampoDeFormulario key={k} rotulo={rotuloComIA(r, `posicionamento.${k}`)}>
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

      <Secao titulo="Proposta de valor" divisoria descricao={estado("proposta")} recolher={`mesa-identidade:${projeto.id}:estrategia:proposta`} acao={acaoDaSecao("proposta")}>
        <CampoDeFormulario rotulo={rotuloComIA("Promessa", "proposta_de_valor.promessa")}>
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
            <CampoDeFormulario key={k} rotulo={rotuloComIA(r, `proposta_de_valor.${k}`)} apoio="Um por linha">
              <textarea className={juntar(campoTexto, "min-h-[96px]")} value={juntarLinhas(e.proposta_de_valor[k])} onChange={(ev) => mexer((x) => ({ ...x, proposta_de_valor: { ...x.proposta_de_valor, [k]: linhas(ev.target.value) } }))} />
            </CampoDeFormulario>
          ))}
        </div>
      </Secao>

      <Secao titulo="Público e persona" divisoria descricao={estado("publico")} recolher={`mesa-identidade:${projeto.id}:estrategia:publico`} acao={acaoDaSecao("publico")} ajuda="A persona é um modelo do cliente ideal, não uma pessoa real: nome fictício e idade em faixa.">
        <CampoDeFormulario rotulo={rotuloComIA("Público", "publico.resumo")}>
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

      <Secao titulo="Tom de voz" divisoria descricao={estado("tom")} recolher={`mesa-identidade:${projeto.id}:estrategia:tom`} acao={acaoDaSecao("tom")}>
        <CampoDeFormulario rotulo={rotuloComIA("Atributos da voz", "tom.atributos")} apoio="Separe por vírgula">
          <input className={campo} value={e.tom.atributos.join(", ")} onChange={(ev) => mexer((x) => ({ ...x, tom: { ...x.tom, atributos: ev.target.value.split(/[,;]+/).map((t) => t.trim()) } }))} />
        </CampoDeFormulario>
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          <CampoDeFormulario rotulo={rotuloComIA("Fala assim", "tom.fala_assim")} apoio="Uma frase por linha">
            <textarea className={juntar(campoTexto, "min-h-[110px]")} value={juntarLinhas(e.tom.fala_assim)} onChange={(ev) => mexer((x) => ({ ...x, tom: { ...x.tom, fala_assim: linhas(ev.target.value) } }))} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo={rotuloComIA("Não fala assim", "tom.nao_fala_assim")} apoio="Uma frase por linha">
            <textarea className={juntar(campoTexto, "min-h-[110px]")} value={juntarLinhas(e.tom.nao_fala_assim)} onChange={(ev) => mexer((x) => ({ ...x, tom: { ...x.tom, nao_fala_assim: linhas(ev.target.value) } }))} />
          </CampoDeFormulario>
        </div>
        <div className="mt-4 min-w-0">
          <div className="mb-2 flex min-w-0 items-center">
            <h3 className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>Exemplos por situação</h3>
            {preencher([campoDe("tom.exemplos")], "Preencher exemplos com IA", true)}
          </div>
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Exemplos de tom">
            {e.tom.exemplos.map((x, i) => (
              <li key={i} className={juntar(lista.linha, "grid grid-cols-1 items-start gap-2 md:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_auto]")}>
                <input className={campo} value={x.situacao} placeholder="Situação" aria-label="Situação" onChange={(ev) => mexer((y) => ({ ...y, tom: { ...y.tom, exemplos: y.tom.exemplos.map((z, k) => (k === i ? { ...z, situacao: ev.target.value } : z)) } }))} />
                <input className={campo} value={x.certo} placeholder="Fala assim" aria-label="Fala assim" onChange={(ev) => mexer((y) => ({ ...y, tom: { ...y.tom, exemplos: y.tom.exemplos.map((z, k) => (k === i ? { ...z, certo: ev.target.value } : z)) } }))} />
                <input className={campo} value={x.errado} placeholder="Não fala assim" aria-label="Não fala assim" onChange={(ev) => mexer((y) => ({ ...y, tom: { ...y.tom, exemplos: y.tom.exemplos.map((z, k) => (k === i ? { ...z, errado: ev.target.value } : z)) } }))} />
                <button type="button" className={botao.icone} aria-label="Tirar o exemplo" onClick={() => mexer((y) => ({ ...y, tom: { ...y.tom, exemplos: y.tom.exemplos.filter((_, k) => k !== i) } }))}>
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
 * A prévia da proposta inteira: antes x depois por campo, marcados por padrão
 * os que estão vazios hoje. "Aplicar marcados", "Aplicar tudo" (com
 * "substituir o que já tem"), "Descartar". O Desfazer vem no aviso.
 */
function PreviaDaEstrategia({ atual, proposta, onAplicar, onDescartar }: { atual: Estrategia; proposta: Proposta; onAplicar: (chaves: string[], substituir: boolean) => Promise<void>; onDescartar: () => void }) {
  const difs = useMemo(() => diferencasDaEstrategia(atual, proposta.proposta).filter((d) => !vazio(d.depois)), [atual, proposta]);
  const [marcadas, setMarcadas] = useState<string[]>(() => difs.filter((d) => vazio(d.antes)).map((d) => d.chave));
  const [substituir, setSubstituir] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const rodar = async (chaves: string[], sub: boolean) => {
    setAplicando(true);
    try {
      await onAplicar(chaves, sub);
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
      ajuda="Marcados por padrão: os campos que hoje estão vazios. Marque os que já têm texto para trocar (ou ligue substituir). Nada muda sem Aplicar."
      acao={
        <>
          <label className={juntar(texto.auxiliar, "m-1 inline-flex items-center")}>
            <input type="checkbox" className="mr-1.5 h-4 w-4 accent-primary" checked={substituir} onChange={(ev) => setSubstituir(ev.target.checked)} />
            Substituir o que já tem
          </label>
          <button type="button" className={juntar(botao.secundario, "m-1 h-8")} disabled={aplicando || !marcadas.length} onClick={() => void rodar(marcadas, true)}>
            <Check className="mr-1.5 h-3.5 w-3.5" /> Aplicar marcados
          </button>
          <button type="button" className={juntar(botao.primario, "m-1 h-8")} disabled={aplicando || !difs.length} onClick={() => void rodar(difs.map((d) => d.chave), substituir)} data-aplicar-proposta="">
            {aplicando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Aplicar tudo
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
      <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Campos propostos">
        {difs.map((d) => {
          const on = marcadas.indexOf(d.chave) >= 0;
          return (
            <li key={d.chave} className={juntar(lista.linha, "items-start", on && lista.destaque)} data-campo-proposto={d.chave}>
              <input type="checkbox" className="mr-3 mt-1 h-4 w-4 shrink-0 accent-primary" checked={on} aria-label={`Aplicar ${d.rotulo}`} onChange={() => setMarcadas((m) => (on ? m.filter((x) => x !== d.chave) : m.concat([d.chave])))} />
              <span className="min-w-0 flex-1">
                <span className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)]">
                  <span className={juntar(texto.rotulo, "truncate")}>{d.rotulo}</span>
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
