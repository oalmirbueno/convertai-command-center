import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { PreencherComIA, type CampoParaPreencher } from "@/components/sistema";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { Carregando } from "@/components/sistema/Estados";
import BotaoComIcone from "@/components/sistema/BotaoComIcone";
import { campo, campoTexto, espaco, juntar, texto } from "@/components/sistema/estilos";
import { CAMPOS_DO_BRIEFING, type BriefingDaIdentidade, type CampoDoBriefing } from "../../../supabase/functions/mesa-identidade/modulos/briefing-da-identidade";
import { CRITERIOS_PADRAO } from "../../../supabase/functions/mesa-identidade/modulos/naming";
import { faltaNaEtapa } from "../../../supabase/functions/_shared/identidade-etapas";
import { chamarIdentidade } from "./identidadeApi";
import { CabecalhoDaEtapa, contextoParaPreencher, Pastilha, useProjetoDaMesa } from "./Comuns";
import { useGravacaoAgendada, useGravacoesDaMesa } from "./gravacao";

const ROTULO_DA_FONTE: Record<string, string> = { briefing: "do briefing", contexto: "do painel", equipe: "da equipe" };

const paraTexto = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));
const paraLista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v == null ? "" : v).split(/[,;\n]+/)).map((x) => x.trim()).filter(Boolean);

const CRITERIOS = "criterios_do_nome";

/**
 * O que a tela manda ao servidor (UXS 30/09, IDV-01): a mesma normalização do
 * Salvar (lista separada por vírgula, até 10 itens; texto até 1.500 letras,
 * sem espaço nas pontas). Campo vazio vai como null (apagar passa a valer para
 * o que a equipe ou a IA salvaram). Os critérios só entram com a seção à vista.
 * Serve para três coisas: o que o Salvar envia, o que falta pela tela e saber
 * se há mudança sem salvar.
 */
export function valorParaSalvar(valores: Record<string, string>, criterios: string, comCriterios: boolean): Record<string, unknown> {
  const valor: Record<string, unknown> = {};
  for (const c of CAMPOS_DO_BRIEFING) {
    const v = String(valores[c.campo] || "").trim();
    if (!v) {
      valor[c.campo] = null;
      continue;
    }
    if (c.lista) {
      const l = v.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
      valor[c.campo] = l.length ? l : null;
    } else valor[c.campo] = v.slice(0, 1500);
  }
  if (comCriterios) {
    const crit = criterios.split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 8);
    valor[CRITERIOS] = crit.length ? crit : null;
  }
  return valor;
}

/** O briefing salvo na mesma forma (para comparar com a tela). */
function salvoNormalizado(salvo: Record<string, unknown>, comCriterios: boolean): Record<string, unknown> {
  const t: Record<string, string> = {};
  for (const c of CAMPOS_DO_BRIEFING) t[c.campo] = paraTexto(salvo[c.campo]);
  return valorParaSalvar(t, Array.isArray(salvo[CRITERIOS]) ? (salvo[CRITERIOS] as string[]).join("\n") : "", comCriterios);
}

/**
 * Etapa 2, Briefing: lê o briefing que o cliente respondeu (frente BRF, ou o
 * questionário antigo) e o contexto da marca; o que falta vira pergunta aqui.
 * UXS 30/09: o cabeçalho lê o que está na tela (o "Falta" e o "Completo" não se
 * contradizem mais); com mudança na tela o botão vira "Salvar e concluir"; o
 * campo que a pessoa mexe grava sozinho ao sair dele (e 800 ms depois de parar
 * de digitar), só ele, para os outros continuarem "do briefing" e "do painel".
 */
export default function EtapaBriefing() {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, salvarParte } = useProjetoDaMesa();
  const gravacoes = useGravacoesDaMesa();
  const marcaId = projeto.marca_id || (marca && !marca.principal ? marca.id : null);
  const avisarErro = useAvisarErro();
  const montado = useQuery({
    queryKey: ["mesa-identidade", "briefing", projeto.id],
    queryFn: () => chamarIdentidade<{ briefing: BriefingDaIdentidade }>("briefing_montar", { projeto_id: projeto.id }).then((r) => r.briefing),
    staleTime: 5 * 60_000,
  });
  const salvo = (projeto.dados.briefing || {}) as Record<string, unknown>;
  const comCriterios = projeto.modo === "zero" || !!projeto.com_naming;
  const [valores, setValores] = useState<Record<string, string>>(() => {
    const base: Record<string, string> = {};
    for (const c of CAMPOS_DO_BRIEFING) base[c.campo] = paraTexto(salvo[c.campo]);
    return base;
  });
  const [criterios, setCriterios] = useState<string>(() => (Array.isArray(salvo[CRITERIOS]) ? (salvo[CRITERIOS] as string[]).join("\n") : ""));
  const [salvando, setSalvando] = useState(false);

  // O mais novo de tudo, para a gravação (que roda depois do render).
  const valoresRef = useRef(valores);
  const criteriosRef = useRef(criterios);
  const salvoRef = useRef(salvo);
  salvoRef.current = salvo;
  const montadoRef = useRef(montado.data);
  montadoRef.current = montado.data;
  /** Campos mexidos e ainda não gravados; `tudo` = o Salvar da pessoa (todos os campos com diferença). */
  const editados = useRef<Set<string>>(new Set());
  const tudo = useRef(false);
  /** Campos que a pessoa já mexeu nesta visita: a releitura do briefing não passa por cima deles. */
  const mexidos = useRef<Set<string>>(new Set());

  // Começa pelo que a equipe salvou; o resto vem do briefing e do painel.
  useEffect(() => {
    const base: Record<string, string> = {};
    for (const c of CAMPOS_DO_BRIEFING) {
      if (mexidos.current.has(c.campo)) {
        base[c.campo] = valoresRef.current[c.campo] || "";
        continue;
      }
      const daEquipe = paraTexto(salvoRef.current[c.campo]);
      const doMontado = montado.data && montado.data.campos[c.campo] ? paraTexto(montado.data.campos[c.campo]!.valor) : "";
      base[c.campo] = daEquipe || doMontado;
    }
    valoresRef.current = base;
    setValores(base);
    if (!mexidos.current.has(CRITERIOS)) {
      const c = Array.isArray(salvoRef.current[CRITERIOS]) ? (salvoRef.current[CRITERIOS] as string[]).join("\n") : "";
      criteriosRef.current = c;
      setCriterios(c);
    }
    // Não relê quando o projeto salva: a tela é a fonte do que a pessoa digitou (IDV-01).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [montado.data, projeto.id]);

  const gravacao = useGravacaoAgendada("briefing", async () => {
    const todos = tudo.current;
    tudo.current = false;
    const chaves = todos ? CAMPOS_DO_BRIEFING.map((c) => c.campo as string).concat(comCriterios ? [CRITERIOS] : []) : Array.from(editados.current);
    editados.current = new Set();
    const naTela = valorParaSalvar(valoresRef.current, criteriosRef.current, comCriterios);
    const noBanco = salvoNormalizado(salvoRef.current, comCriterios);
    // Só vai o que ainda é diferente do banco.
    const valor: Record<string, unknown> = {};
    for (const k of chaves) {
      if (!Object.prototype.hasOwnProperty.call(naTela, k)) continue;
      if (JSON.stringify(naTela[k]) !== JSON.stringify(noBanco[k])) valor[k] = naTela[k];
    }
    if (!Object.keys(valor).length) return;
    const m = montadoRef.current;
    if (m && m.origem.briefing_id) valor.briefing_id = m.origem.briefing_id;
    try {
      const novo = await salvarParte("briefing", valor);
      // A próxima rodada (sair do campo e logo clicar em Concluir) compara com o que acabou de gravar, não com o render velho.
      if (novo && novo.dados && novo.dados.briefing && typeof novo.dados.briefing === "object") salvoRef.current = novo.dados.briefing as Record<string, unknown>;
    } catch (e) {
      chaves.forEach((k) => editados.current.add(k));
      if (todos) tudo.current = true;
      throw e;
    }
  });

  const naTela = useMemo(() => valorParaSalvar(valores, criterios, comCriterios), [valores, criterios, comCriterios]);
  const noBanco = useMemo(() => salvoNormalizado(salvo, comCriterios), [salvo, comCriterios]);
  const pendente = JSON.stringify(naTela) !== JSON.stringify(noBanco);
  const falta = faltaNaEtapa("briefing", { ...projeto.dados, briefing: naTela });

  const mexer = (chave: string, v: string) => {
    mexidos.current.add(chave);
    editados.current.add(chave);
    if (chave === CRITERIOS) {
      criteriosRef.current = v;
      setCriterios(v);
    } else {
      const novos = { ...valoresRef.current, [chave]: v };
      valoresRef.current = novos;
      setValores(novos);
    }
    gravacao.agendar();
  };

  const fonteDe = (c: CampoDoBriefing) => {
    if (!String(valores[c] || "").trim()) return null;
    if (paraTexto(salvo[c]).trim()) return "equipe";
    const m = montado.data && montado.data.campos[c];
    return m ? m.fonte : null;
  };

  const faltando = useMemo(() => CAMPOS_DO_BRIEFING.filter((c) => !String(valores[c.campo] || "").trim()), [valores]);

  /** O Salvar da pessoa: todos os campos com diferença (inclusive os que vieram do briefing e do painel). */
  const salvar = async (frase: string | null = "Briefing salvo") => {
    setSalvando(true);
    try {
      tudo.current = true;
      await gravacao.agora(true);
      if (frase) toast.success(frase);
    } catch (e) {
      avisarErro(e, "O briefing não foi salvo");
      throw e;
    } finally {
      setSalvando(false);
    }
  };

  // "Preencher com IA" (peça comum): cada campo e a seção inteira. O valor entra no campo e é salvo; o Desfazer volta o anterior.
  const campoDaIa = (c: (typeof CAMPOS_DO_BRIEFING)[number]): CampoParaPreencher => ({
    chave: c.campo,
    rotulo: c.rotulo,
    tipo: c.lista ? "lista" : c.campo === "negocio" || c.campo === "publico" || c.campo === "proposito" ? "texto_longo" : "texto",
    valorAtual: c.lista ? paraLista(valores[c.campo]) : valores[c.campo] || "",
    dica: c.pergunta,
    maximo: c.lista ? 8 : 600,
  });
  const aplicarIa = async (v: Record<string, unknown>) => {
    const novos = { ...valoresRef.current };
    for (const k of Object.keys(v)) {
      mexidos.current.add(k);
      editados.current.add(k);
      if (k === CRITERIOS) criteriosRef.current = paraLista(v[k]).join("\n");
      else novos[k] = Array.isArray(v[k]) ? (v[k] as unknown[]).map(String).join(", ") : v[k] == null ? "" : String(v[k]);
    }
    valoresRef.current = novos;
    setValores(novos);
    setCriterios(criteriosRef.current);
    await gravacao.agora(true);
  };
  const preencher = (campos: CampoParaPreencher[], rotulo?: string, compacto = false) => (
    <PreencherComIA papel="identidade" clientId={clientId} marcaId={marcaId} campos={campos} contexto={contextoParaPreencher(projeto)} rotulo={rotulo} compacto={compacto} revelar={compacto} onAplicar={(v) => aplicarIa(v)} onDesfazer={(a) => aplicarIa(a)} />
  );

  return (
    <div
      className={espaco.pagina}
      data-etapa-briefing=""
      onBlur={() => {
        // Saiu do campo: grava o que mudou (só ele).
        if (gravacoes && gravacoes.temPendente()) void gravacoes.salvarTudo().catch(() => undefined);
      }}
    >
      <CabecalhoDaEtapa
        etapa="briefing"
        ajuda="O briefing respondido pelo cliente entra sozinho; o que o painel já sabe (kit e contexto da marca) completa. Campo vazio é pergunta para o cliente: nada é inventado. O campo que você mexe grava sozinho; o Salvar grava tudo o que está na tela."
        falta={falta}
        pendente={pendente}
        antesDeConcluir={async () => {
          tudo.current = true;
          await gravacao.agora(true);
        }}
        acoes={
          <BotaoComIcone
            variante="secundario"
            className="m-1 h-8"
            icone={salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            rotulo="Salvar"
            aria-label="Salvar o briefing"
            onClick={() => void salvar().catch(() => undefined)}
            disabled={salvando}
          />
        }
      />
      {montado.isLoading && <Carregando forma="lista" linhas={4} rotulo="Lendo o briefing" />}
      {montado.isError && (
        <p className={juntar(texto.auxiliar, "text-warning")} role="alert">
          O briefing do cliente não foi lido. Dá para preencher aqui mesmo.
        </p>
      )}
      {montado.data && !montado.data.origem.respondido && (
        <p className={texto.auxiliar}>
          Sem briefing respondido. <Link className="text-primary underline-offset-2 hover:underline" to={`/briefings?client=${clientId}`}>Enviar o link do briefing</Link>
        </p>
      )}
      <Secao titulo="A marca" descricao={faltando.length ? `${faltando.length} em aberto` : "Completo"} recolher={`mesa-identidade:${projeto.id}:briefing:marca`} acao={preencher(CAMPOS_DO_BRIEFING.map(campoDaIa), "Preencher tudo")} data-bloco-da-etapa="marca">
        <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
          {CAMPOS_DO_BRIEFING.map((c) => {
            const fonte = fonteDe(c.campo);
            const longo = c.campo === "negocio" || c.campo === "publico" || c.campo === "proposito";
            return (
              <CampoDeFormulario
                key={c.campo}
                className="group"
                rotulo={
                  <span className="inline-flex min-w-0 max-w-full items-center align-middle">
                    <span className="mr-1.5 truncate">{c.rotulo}</span>
                    {fonte && <Pastilha tom={fonte === "equipe" ? "bom" : "neutro"}>{ROTULO_DA_FONTE[fonte]}</Pastilha>}
                    {preencher([campoDaIa(c)], `Preencher ${c.rotulo.toLowerCase()} com IA`, true)}
                  </span>
                }
                apoio={c.lista ? "Separe por vírgula" : undefined}
                obrigatorio={c.essencial}
                largo={longo}
              >
                {longo ? (
                  <textarea className={juntar(campoTexto, "min-h-[72px]")} value={valores[c.campo] || ""} maxLength={1500} placeholder={c.pergunta} onChange={(e) => mexer(c.campo, e.target.value)} data-campo={c.campo} />
                ) : (
                  <input className={campo} value={valores[c.campo] || ""} maxLength={600} placeholder={c.pergunta} onChange={(e) => mexer(c.campo, e.target.value)} data-campo={c.campo} />
                )}
              </CampoDeFormulario>
            );
          })}
        </div>
      </Secao>
      {comCriterios && (
        <Secao
          titulo="Critérios do nome"
          descricao="Um por linha"
          divisoria
          recolher={`mesa-identidade:${projeto.id}:briefing:criterios`}
          acao={preencher([{ chave: CRITERIOS, rotulo: "Critérios do nome", tipo: "lista", valorAtual: paraLista(criterios), dica: "Critérios para julgar os nomes (som, sentido, diferença, idioma).", maximo: 6 }], "Preencher com IA")}
          data-bloco-da-etapa="criterios"
        >
          <textarea className={juntar(campoTexto, "min-h-[96px]")} value={criterios} maxLength={1200} placeholder={CRITERIOS_PADRAO.join("\n")} onChange={(e) => mexer(CRITERIOS, e.target.value)} aria-label="Critérios do nome" data-campo="criterios" />
        </Secao>
      )}
    </div>
  );
}
