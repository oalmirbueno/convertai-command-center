import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Hammer, Loader2, PenLine } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import { SeletorDoModeloDoEscopo, useModeloDoEscopo } from "@/components/mesa/ModeloDaCopyDoConteudo";
import Secao from "@/components/sistema/Secao";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, espaco, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { nomeDoModelo, usd } from "@/lib/mesa/api";
import { ehAberto, ROTULO_DO_TIPO, type TrabalhoDoMotor } from "../../../supabase/functions/_shared/motor-codigo";
import { mapaDoSite, secoesDoMapa, tipoDoUid } from "../../../supabase/functions/_shared/site-biblioteca";
import { rotuloDaSecao, SECOES_PADRAO, type OpcaoDeCopy } from "../../../supabase/functions/_shared/site-metodo";
import {
  camposPreenchidos,
  type ContextoDoCliente,
  MODOS_DA_REFERENCIA,
  type MotorDeCodigo,
  MOTORES_DE_CODIGO,
  objetivoDoSite,
  papelDaSecao,
  type PartidaDoSite,
  ROTULO_DO_MOTOR,
  ROTULO_DO_PAPEL,
} from "../../../supabase/functions/mesa-site/modulos/jornada-do-site";
import { TAMANHO_DA_COPY_DA_PAGINA } from "../../../supabase/functions/mesa-site/modulos/copy-da-pagina";
import { CHAVES, chamarMotor, type LinhaDoSite, secoesConstruidas, useEventos, useSalvarSite, useTrabalhos } from "./siteApi";
import { jornadaDoSite, useContextoDoCliente } from "./jornadaApi";
import SeletorDoMotor from "./SeletorDoMotor";
import EstadoDoMotor, { useEstadoDoMotor } from "./EstadoDoMotor";
import FasesDoTrabalho from "./FasesDoTrabalho";
import { useBarraDaEtapa } from "./BarraDaEtapa";

/**
 * O pedido de construção da jornada (contrato com o motor, frente do worker):
 * construir as seções que faltam com objetivo, partida, motor?, modelo_id? e
 * o contexto do cliente conferido.
 */
export function pedidoDaJornada(p: {
  clientId: string;
  siteId: string;
  secoes: string[];
  tetoUsd: number;
  objetivo: string;
  partida: PartidaDoSite;
  contexto: ContextoDoCliente | null;
  motor: MotorDeCodigo | "";
  modeloId: string;
}): Record<string, unknown> {
  return {
    client_id: p.clientId,
    site_id: p.siteId,
    tipo: "construir",
    secoes: p.secoes,
    teto_usd: p.tetoUsd,
    objetivo: p.objetivo,
    partida: p.partida,
    ...(p.motor ? { motor: p.motor } : {}),
    ...(p.modeloId ? { modelo_id: p.modeloId } : {}),
    contexto_do_cliente: p.contexto || {},
  };
}

/** Qual versão da seção está em uso (0 ou 1), comparando com a copy escolhida. */
function versaoEmUso(copy: OpcaoDeCopy | null, uid: string, opcoes: Array<{ titulo: string; texto: string }>): number {
  const s = copy ? copy.secoes.find((x) => x.id === uid) : null;
  if (!s) return 0;
  const i = opcoes.findIndex((o) => o.titulo === s.titulo && o.texto === s.texto);
  return i < 0 ? -1 : i;
}

/**
 * Passo 4: construir. Primeiro a copy da página no motor de copy da casa
 * (2 versões por seção, o Jev escolhe, troca num clique); depois o motor de
 * código constrói com o contrato da jornada. Motor e modelo ficam em
 * "Avançado" (vazio = o padrão do motor).
 */
export default function PassoConstruir({ site, onIrPara }: { site: LinhaDoSite; onIrPara: (etapa: string) => void }) {
  const { clientId, atualizarCusto } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const salvar = useSalvarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const j = jornadaDoSite(site);
  const objetivo = objetivoDoSite(j.objetivo);
  const contextoQ = useContextoDoCliente(site.id);
  const trabalhosQ = useTrabalhos(clientId, site.id);
  const trabalhos = useMemo(() => (trabalhosQ.data ? trabalhosQ.data.trabalhos : []), [trabalhosQ.data]);
  const feitas = secoesConstruidas(trabalhos);
  const mapa = useMemo(() => mapaDoSite(site), [site]);
  const secoesDoSite: string[] = site.mapa && Array.isArray((site.mapa as any).paginas) && (site.mapa as any).paginas.length ? secoesDoMapa(mapa) : Array.isArray(site.direcao.secoes) && site.direcao.secoes.length ? site.direcao.secoes : SECOES_PADRAO.slice();
  const faltando = secoesDoSite.filter((s) => feitas.indexOf(s) < 0);
  const emCurso = trabalhos.find((t) => ehAberto(t.estado)) || null;
  const vivo = trabalhosQ.data ? trabalhosQ.data.vivo : false;
  const eventos = useEventos(emCurso, vivo);
  const estadoDoMotor = useEstadoDoMotor(trabalhosQ.data ? trabalhosQ.data.executor : null, trabalhos);

  const [motor, setMotor] = useEstadoDaTela<MotorDeCodigo | "">(`mesa-site:jornada:motor:${site.id}`, "", { validar: (v): v is MotorDeCodigo | "" => v === "" || MOTORES_DE_CODIGO.some((m) => m === v) });
  const [modelo, setModelo] = useState<string>(site.modelo || "");
  const [avancadoRecolhido, setAvancadoRecolhido] = useRecolhido("mesa-site:jornada:avancado", true);
  const [modeloDaCopyRecolhido, setModeloDaCopyRecolhido] = useRecolhido("mesa-site:jornada:modelo-da-copy", true);
  const [ocupado, setOcupado] = useState<string | null>(null);
  useEffect(() => setModelo(site.modelo || ""), [site.id, site.modelo]);

  const estimativa = useQuery({
    queryKey: ["mesa-site", "estimativa", site.id, modelo, faltando.join(",")],
    enabled: faltando.length > 0,
    queryFn: () => chamarMotor<{ estimativa_usd: number; teto_sugerido_usd: number; livre_usd: number }>("estimar", { client_id: clientId, tipo: "construir", secoes: faltando, modelo_id: modelo || undefined }),
  });
  const tetoUsd = estimativa.data ? estimativa.data.teto_sugerido_usd : 0;

  // Copy da página.
  const modeloDaCopy = useModeloDoEscopo("site");
  const opcoes: OpcaoDeCopy[] = Array.isArray(site.conteudo.opcoes) ? site.conteudo.opcoes : [];
  const iCopy = typeof site.conteudo.escolhida === "number" ? site.conteudo.escolhida : null;
  const copy = iCopy !== null && opcoes[iCopy] ? opcoes[iCopy] : null;
  const porSecao = (site.conteudo.por_secao || {}) as Record<string, { opcoes?: Array<{ titulo: string; texto: string; itens: string[] }> }>;
  const doMotorDeCopy = site.conteudo.motor === "copy_da_pagina";

  const partida = j.partida;
  const contexto = contextoQ.data ? contextoQ.data.contexto : null;
  const motivo = !objetivo ? "Falta o objetivo" : !partida ? "Falta a partida" : null;
  useBarraDaEtapa({ estado: emCurso ? "Construindo" : `${secoesDoSite.length - faltando.length} de ${secoesDoSite.length} seções prontas`, motivo, pendente: faltando.length > 0 });

  const rodar = async (rotulo: string, fn: () => Promise<void>) => {
    setOcupado(rotulo);
    try {
      await fn();
    } catch (e) {
      avisarErro(e, rotulo);
    } finally {
      setOcupado(null);
    }
  };

  const escreverCopy = () =>
    rodar("A copy da página não saiu", async () => {
      await salvar("copy_da_pagina_gerar", { site_id: site.id, ...modeloDaCopy.corpo });
      atualizarCusto();
    });

  const usarOutra = (uid: string, v: { titulo: string; texto: string; itens: string[] }) =>
    rodar("A versão não entrou", async () => {
      await salvar("conteudo_editar", { site_id: site.id, secao: uid, campos: { titulo: v.titulo, texto: v.texto, itens: v.itens } });
    });

  const construir = () =>
    rodar("A construção não entrou na fila", async () => {
      if (!objetivo || !partida) return;
      await chamarMotor("pedir", pedidoDaJornada({ clientId, siteId: site.id, secoes: faltando, tetoUsd, objetivo: objetivo.id, partida, contexto, motor, modeloId: modelo }));
      await qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
      atualizarCusto();
      onIrPara("ajustar");
    });

  const trocarModelo = async (id: string) => {
    const antes = modelo;
    setModelo(id);
    try {
      await salvar("site_salvar", { site_id: site.id, modelo: id });
    } catch (e) {
      setModelo(antes);
      avisarErro(e, "O modelo não foi salvo");
    }
  };

  const contagem = contexto ? camposPreenchidos(contexto) : null;
  const modoDaReferencia = partida && partida.tipo === "referencia" ? MODOS_DA_REFERENCIA.find((m) => m.id === partida.modo) : null;
  const resumoDaPartida = !partida ? "sem partida" : partida.tipo === "zero" ? "do zero" : partida.tipo === "referencia" ? `referência ${modoDaReferencia ? modoDaReferencia.rotulo : ""}`.trim() : `site pronto ${partida.modelo_id}`;
  const secoesComTexto = secoesDoSite.filter((uid) => {
    const t = tipoDoUid(mapa, uid);
    return t !== "topo" && t !== "rodape";
  });

  return (
    <div className={espaco.pagina} data-passo-construir="">
      <p className={juntar(texto.auxiliar, "flex min-w-0 flex-wrap items-center")} data-resumo-da-jornada="">
        <button type="button" className="mr-3 underline-offset-2 hover:underline" onClick={() => onIrPara("objetivo")}>
          {objetivo ? objetivo.rotulo : "Sem objetivo"}
        </button>
        <button type="button" className="mr-3 underline-offset-2 hover:underline" onClick={() => onIrPara("partida")}>
          {resumoDaPartida}
        </button>
        <button type="button" className="underline-offset-2 hover:underline" onClick={() => onIrPara("conferir")}>
          {contagem ? `cliente ${contagem.feitos} de ${contagem.total}` : "lendo o cliente"}
        </button>
      </p>

      {/* 25/10: no desktop largo, a copy (a lista longa) e o Construir ficam lado a lado, sem coluna estreita. */}
      <div className={juntar(espaco.colunas, "desk:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]")}>
      <Secao
        titulo="Copy da página"
        descricao={copy ? (doMotorDeCopy ? `${secoesComTexto.length} seções · o Jev escolheu` : "Copy escolhida") : "Ainda sem copy"}
        ajuda="O motor de copy da casa escreve duas versões de cada seção pela estrutura que converte para o objetivo (gancho, dor, oferta, prova, objeções e chamada), com os ganchos vencedores do nicho e a voz da marca. O Jev escolhe uma por seção; o texto passa pelo humanizador e perde o que não tem fonte. A outra versão fica guardada para trocar num clique."
        acao={
          <span className="inline-flex items-center">
            {modeloDaCopy.modelo && <span className="mr-2"><EstimativaInline partes={[{ modeloId: modeloDaCopy.modelo.id, tipo: "texto", tokensEntrada: TAMANHO_DA_COPY_DA_PAGINA.entrada, tokensSaida: TAMANHO_DA_COPY_DA_PAGINA.saida }]} /></span>}
            <button type="button" className={copy ? botao.icone : juntar(botao.primario, "w-9 px-0")} aria-label={copy ? "Escrever a copy de novo" : "Escrever a copy"} title={copy ? "Escrever a copy de novo" : "Escrever a copy"} disabled={!!ocupado || !objetivo} onClick={() => void escreverCopy()} data-escrever-copy="">
              {ocupado === "A copy da página não saiu" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
            </button>
          </span>
        }
        recolher={`mesa-site:jornada:copy:${site.id}`}
      >
        {copy && (
          <div className="mb-3 min-w-0" data-abertura-escolhida="">
            <p className={juntar(texto.tituloSecao, "truncate")}>{copy.headline}</p>
            <p className={juntar(texto.auxiliar, "truncate")}>{copy.subtitulo} · {copy.cta}</p>
          </div>
        )}
        {copy && (
          <ul className={juntar(lista.aberta, lista.divisoria)} data-copy-por-papel="">
            {secoesComTexto.map((uid) => {
              const papel = papelDaSecao(tipoDoUid(mapa, uid));
              const s = copy.secoes.find((x) => x.id === uid);
              const versoes = porSecao[uid] && Array.isArray(porSecao[uid].opcoes) ? porSecao[uid].opcoes! : [];
              const emUso = versaoEmUso(copy, uid, versoes);
              const outra = versoes.length > 1 ? versoes[emUso === 1 ? 0 : 1] : null;
              return (
                <li key={uid} className={juntar(lista.linha, "items-start")} data-secao-da-copy={uid}>
                  <span className="mr-2 min-w-0 flex-1">
                    <span className="flex min-w-0 items-center">
                      <span className={juntar(texto.rotulo, "min-w-0 truncate")}>{rotuloDaSecao(uid)}</span>
                      {papel && <span className={juntar(etiqueta, "ml-1.5 shrink-0 bg-muted")}>{ROTULO_DO_PAPEL[papel]}</span>}
                      {versoes.length > 1 && <span className={juntar(texto.auxiliar, "ml-1.5 shrink-0")}>{emUso === 1 ? "versão B" : emUso === 0 ? "versão A" : "editada"}</span>}
                    </span>
                    <span className={juntar(texto.corpo, "block truncate font-medium")}>{s ? s.titulo || "sem título" : "sem texto ainda"}</span>
                    {s && s.texto && <span className={juntar(texto.auxiliar, "block truncate")}>{s.texto}</span>}
                  </span>
                  {outra && (
                    <button type="button" className={botao.icone} aria-label={`Trocar ${rotuloDaSecao(uid)} pela outra versão`} title={`Usar a outra versão: ${outra.titulo}`} disabled={!!ocupado} onClick={() => void usarOutra(uid, outra)} data-trocar-versao={uid}>
                      <ArrowLeftRight className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3 min-w-0" data-modelo-da-copy="">
          <TituloRecolhivel titulo="Modelo da copy" recolhido={modeloDaCopyRecolhido} onAlternar={() => setModeloDaCopyRecolhido(!modeloDaCopyRecolhido)} resumo={modeloDaCopy.modelo ? nomeDoModelo(modeloDaCopy.modelo) : "padrão"} />
          {!modeloDaCopyRecolhido && (
            <div className="mt-2 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
              <SeletorDoModeloDoEscopo estado={modeloDaCopy} />
            </div>
          )}
        </div>
      </Secao>

      <Secao
        titulo="Construir"
        descricao={<EstadoDoMotor estado={estadoDoMotor} compacto />}
        ajuda="O motor de código constrói uma seção por vez com o objetivo, a partida, o contexto conferido e a copy escolhida. O teto fica reservado na carteira enquanto roda; só o custo real sai. Depois, ajuste conversando com o diretor de site e publique."
        acao={
          <button type="button" className={faltando.length ? juntar(botao.primario, "w-9 px-0") : botao.icone} aria-label={faltando.length ? `Construir ${faltando.length} seções` : "Tudo construído"} title={motivo || (faltando.length ? `Construir ${faltando.length} seções${tetoUsd ? ` · teto ${usd(tetoUsd)}` : ""}` : "Tudo construído")} disabled={!!ocupado || !!motivo || !faltando.length || !(tetoUsd > 0) || !!emCurso} onClick={() => void construir()} data-construir-jornada="">
            {ocupado === "A construção não entrou na fila" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />}
          </button>
        }
        recolher={false}
      >
        {emCurso && (
          <div className="mb-2 min-w-0" data-fases-da-jornada={emCurso.id}>
            <span className={juntar(texto.auxiliar, "block truncate")}>{ROTULO_DO_TIPO[emCurso.tipo]}{emCurso.instrucao ? `: ${emCurso.instrucao}` : ""}</span>
            <FasesDoTrabalho trabalho={emCurso as TrabalhoDoMotor} eventos={eventos.data || []} />
          </div>
        )}
        <p className={juntar(texto.auxiliar, "truncate")} data-custo-da-jornada="">
          {!faltando.length ? "Tudo construído" : estimativa.isLoading ? "Estimando..." : estimativa.data ? `${faltando.length} seções · estimativa ${usd(estimativa.data.estimativa_usd)} · teto ${usd(tetoUsd)} · livre ${usd(estimativa.data.livre_usd)}` : estimativa.isError ? "Sem estimativa (banco ou modelo)" : ""}
        </p>
        <div className="mt-3 min-w-0" data-avancado-da-construcao="">
          <TituloRecolhivel titulo="Avançado" recolhido={avancadoRecolhido} onAlternar={() => setAvancadoRecolhido(!avancadoRecolhido)} resumo={[motor ? ROTULO_DO_MOTOR[motor] : "motor padrão", modelo ? "modelo escolhido" : "modelo padrão"].join(" · ")} />
          {!avancadoRecolhido && (
            <div className="mt-2 grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2 desk:grid-cols-1">
              <label className="block min-w-0">
                <span className={juntar(texto.rotulo, "mb-1 block")}>Motor</span>
                <select value={motor} onChange={(e) => setMotor(e.target.value as MotorDeCodigo | "")} className={campo} data-seletor-de-motor="">
                  <option value="">Padrão do motor</option>
                  {MOTORES_DE_CODIGO.map((m) => (
                    <option key={m} value={m}>
                      {ROTULO_DO_MOTOR[m]}
                    </option>
                  ))}
                </select>
              </label>
              <SeletorDoMotor valor={modelo} onChange={(id) => void trocarModelo(id)} />
            </div>
          )}
        </div>
      </Secao>
      </div>
    </div>
  );
}
