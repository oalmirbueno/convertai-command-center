import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Circle, CircleDashed, FileText, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { chamarFuncao, dataEHora, padraoDoContexto, TAMANHOS, textoDoErro } from "@/lib/mesa/api";
import { AvisoDeErro, BotaoComCusto, avisarCustoReal } from "./Custo";
import CartaoMarca, { ChipsDaPaleta } from "./ContextoCartaoMarca";
import FotosDoCliente from "./ContextoFotos";
import GaleriaDeReferencias from "./ContextoGaleriaDeReferencias";
import { useMesa } from "./MesaContexto";
import type { ParteDoContexto } from "./AbaContexto";
import {
  chaveDasReferencias,
  chaveDoAcervo,
  temTexto,
  useAcervo,
  useFontesDoCliente,
  useInvalidarContexto,
  useKitDoCliente,
  useLeituraDoContexto,
  useReferenciasDoCliente,
  type KitDoContexto,
  type RespostaDoMontar,
  type SugestoesDoContexto,
} from "./contextoDoCliente";

// ------------------------------------------------------------------ checklist

export type SituacaoDoItem = "feito" | "parcial" | "falta" | "carregando";

/** Âncoras das seções da aba (o chip do checklist rola até a seção). */
export type SecaoDoContexto = "ctx-marca" | "ctx-referencias" | "ctx-fotos" | "ctx-consolidado" | "ctx-documentos";

export interface ItemDoChecklist {
  chave: string;
  rotulo: string;
  situacao: SituacaoDoItem;
  detalhe: string;
  secao: SecaoDoContexto;
}

export interface EntradaDoChecklist {
  kit: KitDoContexto | null | undefined;
  /** null: ainda lendo. */
  fontes: { papel: string; nome: string }[] | null;
  referencias: { total: number; semLeitura: number } | null;
  acervo: { ativas: number; semDescricao: number } | null;
  documentos: { total: number; identidade: number } | null;
}

/**
 * O que o contexto do cliente já tem e o que falta, em oito itens curtos.
 * Cada item diz de onde vem (a seção da aba); o que ainda está lendo aparece
 * como "carregando" em vez de "falta".
 */
export function montarChecklist(e: EntradaDoChecklist): ItemDoChecklist[] {
  const kit = e.kit || null;
  const paleta = kit && Array.isArray(kit.paleta) ? kit.paleta : [];
  const temLogo = !!(kit && (kit.logo_path || kit.logo_file_id));
  const temAlt = !!(kit && (kit.logo_alt_path || kit.logo_alt_file_id));
  const fontes = e.fontes;
  const temTitulo = !!fontes && fontes.some((f) => f.papel === "titulo");
  const temTextoFonte = !!fontes && fontes.some((f) => f.papel === "texto");
  const refs = e.referencias;
  const acervo = e.acervo;
  const docs = e.documentos;
  return [
    {
      chave: "logo",
      rotulo: "Logo",
      situacao: temLogo ? (temAlt ? "feito" : "parcial") : "falta",
      detalhe: temLogo ? (temAlt ? "Principal e alternativa definidas." : "Falta a logo alternativa.") : "Escolha a logo em qualquer pasta.",
      secao: "ctx-marca",
    },
    {
      chave: "paleta",
      rotulo: "Paleta",
      situacao: paleta.length >= 2 ? "feito" : paleta.length === 1 ? "parcial" : "falta",
      detalhe: paleta.length ? `${paleta.length} ${paleta.length === 1 ? "cor" : "cores"}.` : "Nenhuma cor definida.",
      secao: "ctx-marca",
    },
    {
      chave: "fontes",
      rotulo: "Fontes",
      situacao: !fontes ? "carregando" : temTitulo && temTextoFonte ? "feito" : fontes.length ? "parcial" : "falta",
      detalhe: !fontes
        ? "Lendo as fontes..."
        : fontes.length
          ? `${fontes.map((f) => f.nome).join(", ")}.${temTitulo && temTextoFonte ? "" : temTitulo ? " Falta a de texto." : " Falta a de título."}`
          : "Sem fonte de título e de texto.",
      secao: "ctx-marca",
    },
    {
      chave: "estilo",
      rotulo: "Estilo",
      situacao: temTexto(kit?.estilo) ? "feito" : "falta",
      detalhe: temTexto(kit?.estilo) ? "Estilo visual descrito." : "Como a marca se parece.",
      secao: "ctx-consolidado",
    },
    {
      chave: "regras",
      rotulo: "Regras",
      situacao: temTexto(kit?.regras) ? "feito" : "falta",
      detalhe: temTexto(kit?.regras) ? "Regras definidas." : "O que fazer e o que nunca fazer.",
      secao: "ctx-consolidado",
    },
    {
      chave: "referencias",
      rotulo: "Referências",
      situacao: !refs ? "carregando" : refs.total === 0 ? "falta" : refs.semLeitura === 0 ? "feito" : "parcial",
      detalhe: !refs ? "Lendo as referências..." : refs.total === 0 ? "Nenhuma referência ativa." : `${refs.total - refs.semLeitura} de ${refs.total} lidas.`,
      secao: "ctx-referencias",
    },
    {
      chave: "imagens",
      rotulo: "Fotos reais",
      situacao: !acervo ? "carregando" : acervo.ativas === 0 ? "falta" : acervo.semDescricao === 0 ? "feito" : "parcial",
      detalhe: !acervo
        ? "Lendo o acervo..."
        : acervo.ativas === 0
          ? "Traga as fotos reais do cliente."
          : acervo.semDescricao
            ? `${acervo.ativas} fotos, ${acervo.semDescricao} sem descrição.`
            : `${acervo.ativas} fotos organizadas.`,
      secao: "ctx-fotos",
    },
    {
      chave: "documentos",
      rotulo: "Documentos",
      situacao: !docs ? "carregando" : docs.total === 0 ? "falta" : docs.identidade > 0 ? "feito" : "parcial",
      detalhe: !docs ? "Lendo os documentos..." : docs.total === 0 ? "Envie a identidade em Arquivos." : `${docs.total} lido(s), ${docs.identidade} de identidade.`,
      secao: "ctx-documentos",
    },
  ];
}

export function completude(itens: ItemDoChecklist[]): number {
  if (!itens.length) return 0;
  const pontos = itens.reduce((t, i) => t + (i.situacao === "feito" ? 1 : i.situacao === "parcial" ? 0.5 : 0), 0);
  return Math.round((pontos / itens.length) * 100);
}

function IconeDaSituacao({ situacao }: { situacao: SituacaoDoItem }) {
  if (situacao === "carregando") return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
  if (situacao === "feito") {
    return (
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-success text-white">
        <Check className="h-2.5 w-2.5" />
      </span>
    );
  }
  if (situacao === "parcial") return <CircleDashed className="h-3.5 w-3.5 text-primary" />;
  return <Circle className="h-3.5 w-3.5 text-muted-foreground" />;
}

const NOME_DA_SITUACAO: Record<SituacaoDoItem, string> = { feito: "completo", parcial: "em parte", falta: "falta", carregando: "lendo" };

function Completude({ itens, onIr }: { itens: ItemDoChecklist[]; onIr: (secao: SecaoDoContexto) => void }) {
  const pct = completude(itens);
  const feitos = itens.filter((i) => i.situacao === "feito").length;
  return (
    <section aria-label="Completude do contexto" className="min-w-0 rounded-xl border border-border bg-card px-3 py-2.5 sm:px-4">
      <div className="flex min-w-0 items-center">
        <p className="shrink-0 text-[12px] font-medium text-foreground">Completude</p>
        <div
          className="mx-3 h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={`${feitos} de ${itens.length} itens completos`}
        >
          <div className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="shrink-0 text-[12px] font-semibold tabular-nums text-foreground">{pct}%</p>
      </div>
      <ul className="mt-2 flex min-w-0 flex-wrap">
        {itens.map((i) => (
          <li key={i.chave} className="mb-1 mr-1 min-w-0">
            <button
              type="button"
              onClick={() => onIr(i.secao)}
              title={i.detalhe}
              aria-label={`${i.rotulo}: ${NOME_DA_SITUACAO[i.situacao]}. ${i.detalhe}`}
              className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11.5px] transition-colors hover:border-primary/60 ${
                i.situacao === "feito" ? "border-border bg-muted text-muted-foreground" : "border-border bg-card text-foreground"
              }`}
            >
              <span className="mr-1.5 flex shrink-0 items-center">
                <IconeDaSituacao situacao={i.situacao} />
              </span>
              <span className="truncate">{i.rotulo}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ cartões

function Cartao({
  id,
  titulo,
  meta,
  acao,
  children,
  className = "",
}: {
  id?: SecaoDoContexto;
  titulo: string;
  meta?: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`flex min-w-0 scroll-mt-36 flex-col rounded-xl border border-border bg-card p-3.5 md:scroll-mt-52 sm:p-4 ${className}`}>
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between">
        <div className="mr-2 min-w-0">
          <h3 className="text-[13px] font-semibold text-foreground">{titulo}</h3>
          {meta && <p className="text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">{meta}</p>}
        </div>
        {acao && <div className="flex shrink-0 items-center">{acao}</div>}
      </div>
      {children}
    </section>
  );
}

function CartaoRecolhivel({
  id,
  titulo,
  resumo,
  aberto,
  onAlternar,
  children,
}: {
  id?: SecaoDoContexto;
  titulo: string;
  resumo: ReactNode;
  aberto: boolean;
  onAlternar: () => void;
  children: ReactNode;
}) {
  return (
    <section id={id} className="min-w-0 scroll-mt-36 rounded-xl border border-border bg-card md:scroll-mt-52">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberto}
        className="flex w-full min-w-0 items-center px-3.5 py-3 text-left sm:px-4"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-foreground">{titulo}</span>
          <span className="block truncate text-[11.5px] text-muted-foreground">{resumo}</span>
        </span>
        <ChevronDown className={`ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && <div className="min-w-0 border-t border-border px-3.5 pb-3.5 pt-3 sm:px-4">{children}</div>}
    </section>
  );
}

function Esqueleto({ linhas = 3 }: { linhas?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className={`h-3 animate-pulse rounded bg-muted ${i === linhas - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ consolidado

interface CampoDoConsolidado {
  chave: string;
  rotulo: string;
  texto: string;
  editavel?: boolean;
}

/** Os campos do contexto consolidado na ordem da tela; vazio fica de fora. */
export function camposDoConsolidado(kit: KitDoContexto | null | undefined): { cheios: CampoDoConsolidado[]; vazios: string[] } {
  const c = (kit && kit.contexto) || null;
  const diferenciais = (c && Array.isArray(c.diferenciais) ? c.diferenciais : []).filter(temTexto);
  const tipo = (c && c.tipografia) || null;
  const tipografia = tipo
    ? [temTexto(tipo.titulo) ? `Título: ${tipo.titulo}.` : "", temTexto(tipo.texto) ? `Texto: ${tipo.texto}.` : "", temTexto(tipo.observacao) ? String(tipo.observacao) : ""]
        .filter(Boolean)
        .join(" ")
    : "";
  const todos: CampoDoConsolidado[] = [
    { chave: "negocio", rotulo: "Negócio", texto: (c && c.negocio) || "" },
    { chave: "publico", rotulo: "Público", texto: (c && c.publico) || "" },
    { chave: "oferta", rotulo: "Oferta", texto: (c && c.oferta) || "" },
    { chave: "tom_de_voz", rotulo: "Tom de voz", texto: (c && c.tom_de_voz) || "" },
    { chave: "diferenciais", rotulo: "Diferenciais", texto: diferenciais.map((d) => `• ${d}`).join("\n") },
    { chave: "tipografia", rotulo: "Tipografia", texto: tipografia },
    { chave: "logo", rotulo: "Logo", texto: (c && c.logo && c.logo.descricao) || "" },
    { chave: "estilo", rotulo: "Estilo", texto: (kit && kit.estilo) || "", editavel: true },
    { chave: "regras", rotulo: "Regras", texto: (kit && kit.regras) || "", editavel: true },
  ];
  return {
    cheios: todos.filter((t) => temTexto(t.texto)),
    vazios: todos.filter((t) => !temTexto(t.texto)).map((t) => t.rotulo),
  };
}

function CampoRecolhido({ campo, onEditar }: { campo: CampoDoConsolidado; onEditar?: () => void }) {
  const [aberto, setAberto] = useState(false);
  const longo = campo.texto.length > 110 || campo.texto.indexOf("\n") >= 0;
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background/40 p-2.5">
      <div className="mb-0.5 flex min-w-0 items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{campo.rotulo}</p>
        {campo.editavel && onEditar && (
          <button type="button" onClick={onEditar} className="text-[11px] text-muted-foreground hover:text-foreground hover:underline">
            Editar
          </button>
        )}
      </div>
      <p className={`whitespace-pre-line text-[12.5px] leading-relaxed text-foreground [overflow-wrap:anywhere] ${aberto ? "" : "line-clamp-2"}`}>{campo.texto}</p>
      {longo && (
        <button type="button" onClick={() => setAberto((v) => !v)} className="mt-0.5 text-[11.5px] font-medium text-primary hover:underline" aria-expanded={aberto}>
          {aberto ? "ver menos" : "ver mais"}
        </button>
      )}
    </div>
  );
}

function ContextoConsolidado({ kit, carregando, onEditar }: { kit: KitDoContexto | null | undefined; carregando: boolean; onEditar?: () => void }) {
  const { cheios, vazios } = camposDoConsolidado(kit);
  const fontesLidas = ((kit && kit.contexto && Array.isArray(kit.contexto.fontes_lidas) ? kit.contexto.fontes_lidas : []) as string[]).filter(temTexto);
  const [verFontes, setVerFontes] = useState(false);
  return (
    <Cartao
      id="ctx-consolidado"
      titulo="Contexto consolidado"
      meta={
        kit && kit.contexto_atualizado_em
          ? `Montado ${dataEHora(kit.contexto_atualizado_em)}${fontesLidas.length ? ` a partir de ${fontesLidas.length} ${fontesLidas.length === 1 ? "fonte" : "fontes"}` : ""}`
          : "Ainda não montado"
      }
      acao={
        fontesLidas.length ? (
          <button type="button" onClick={() => setVerFontes((v) => !v)} className="text-[11.5px] font-medium text-foreground hover:underline" aria-expanded={verFontes}>
            {verFontes ? "Esconder fontes" : "Ver fontes lidas"}
          </button>
        ) : undefined
      }
    >
      {verFontes && (
        <ul className="mb-3 flex min-w-0 flex-wrap">
          {fontesLidas.map((f) => (
            <li key={f} className="mb-1 mr-1 min-w-0 max-w-full truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" title={f}>
              {f}
            </li>
          ))}
        </ul>
      )}
      {carregando && !kit ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border p-2.5">
              <Esqueleto linhas={2} />
            </div>
          ))}
        </div>
      ) : cheios.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">Ainda não há contexto montado. Clique em "Montar contexto" ou conte ao agente o que sabe da marca.</p>
      ) : (
        <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-2">
          {cheios.map((campo) => (
            <CampoRecolhido key={campo.chave} campo={campo} onEditar={onEditar} />
          ))}
        </div>
      )}
      {cheios.length > 0 && vazios.length > 0 && (
        <p className="mt-2.5 text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">Ainda sem: {vazios.join(", ")}.</p>
      )}
    </Cartao>
  );
}

// ------------------------------------------------------------------ sugestões

/** Sugestões do montar para campos que a equipe já tinha preenchido. */
function SugestoesPendentes({
  sugestoes,
  kit,
  aplicando,
  onAplicar,
  onIgnorar,
}: {
  sugestoes: SugestoesDoContexto;
  kit: KitDoContexto | null | undefined;
  aplicando: string | null;
  onAplicar: (campo: keyof SugestoesDoContexto) => void;
  onIgnorar: (campo: keyof SugestoesDoContexto) => void;
}) {
  const campos = (["paleta", "estilo", "regras"] as (keyof SugestoesDoContexto)[]).filter((k) => sugestoes[k] !== undefined);
  if (!campos.length) return null;
  const rotulos: Record<string, string> = { paleta: "Paleta", estilo: "Estilo visual", regras: "Regras" };
  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-primary/50 bg-card p-3.5 sm:p-4">
      <div>
        <p className="flex items-center text-[13px] font-semibold"><Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" /> Sugestões do agente</p>
        <p className="text-[11.5px] text-muted-foreground">A equipe já tinha preenchido estes campos, então o agente não trocou nada. Aplique o que fizer sentido.</p>
      </div>
      <ul className="space-y-2">
        {campos.map((campo) => (
          <li key={campo} className="min-w-0 space-y-2 rounded-lg border border-border bg-muted p-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{rotulos[campo]}</p>
            {campo === "paleta" ? (
              <div className="space-y-1.5">
                <ChipsDaPaleta paleta={sugestoes.paleta || []} />
                {kit && Array.isArray(kit.paleta) && kit.paleta.length > 0 && (
                  <p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">Hoje: {kit.paleta.map((c) => c.hex).join(", ")}</p>
                )}
              </div>
            ) : (
              <div className="space-y-1">
                <p className="line-clamp-4 whitespace-pre-wrap text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{String(sugestoes[campo] || "")}</p>
                {temTexto(campo === "estilo" ? kit?.estilo : kit?.regras) && (
                  <p className="line-clamp-2 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                    Hoje: {campo === "estilo" ? kit?.estilo : kit?.regras}
                  </p>
                )}
              </div>
            )}
            <div className="flex flex-wrap justify-end">
              <Button type="button" size="sm" variant="ghost" className="mr-2 h-7 text-[11.5px]" onClick={() => onIgnorar(campo)} disabled={aplicando === campo}>
                Ignorar
              </Button>
              <Button type="button" size="sm" className="h-7 text-[11.5px]" onClick={() => onAplicar(campo)} disabled={!!aplicando}>
                {aplicando === campo && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Aplicar
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ tela

/**
 * Coluna principal da aba Contexto: topo compacto (completude e checklist em
 * chips), cartões sólidos lado a lado (Marca, Referências, Fotos reais,
 * Contexto consolidado, Documentos, Pendências). Cada cartão lê o que precisa
 * direto do banco; o "ler" do agente (documentos, candidatos a logo,
 * pendências) chega em até ~1,5 s e nunca esconde a tela inteira.
 */
export default function ContextoAutomatico({ onIrPara }: { onIrPara?: (parte: ParteDoContexto) => void } = {}) {
  const { clientId, clientName, catalogo, atualizarCusto, userId } = useMesa();
  const queryClient = useQueryClient();
  const leitura = useLeituraDoContexto(clientId);
  const kitQuery = useKitDoCliente(clientId);
  const fontes = useFontesDoCliente(clientId);
  const acervo = useAcervo(clientId);
  const referencias = useReferenciasDoCliente(clientId);
  const invalidar = useInvalidarContexto();
  const montados = useRef<Record<string, boolean>>({});
  const relidos = useRef<Record<string, boolean>>({});
  const [montandoPara, setMontandoPara] = useState<string | null>(null);
  const [erroDoMontar, setErroDoMontar] = useState<{ clientId: string; erro: unknown } | null>(null);
  const [sugestoesPorCliente, setSugestoesPorCliente] = useState<Record<string, SugestoesDoContexto>>({});
  const [aplicando, setAplicando] = useState<string | null>(null);
  const [docsAbertos, setDocsAbertos] = useState(false);
  const [pendenciasAbertas, setPendenciasAbertas] = useState(false);

  const dados = leitura.data;
  // O kit da tabela responde antes do "ler"; o do "ler" cobre enquanto isso.
  const kit: KitDoContexto | null = kitQuery.data !== undefined ? kitQuery.data : dados ? dados.kit : null;
  const carregandoKit = kitQuery.isLoading && !dados;
  const sugestoes = sugestoesPorCliente[clientId] || {};
  const montando = montandoPara === clientId;
  const temMaterial = !!dados && (dados.encontrado.documentos.length > 0 || dados.encontrado.tem_dossie || dados.encontrado.artes_aprovadas > 0);
  const contextoMontado = !!(kit && kit.contexto_atualizado_em);

  const refsAtivas = referencias.data ? referencias.data.filter((r) => r.ativa) : null;
  const acervoAtivas = acervo.data ? acervo.data.filter((i) => i.ativa) : null;
  const documentos = dados ? dados.encontrado.documentos : null;
  const itens = montarChecklist({
    kit,
    fontes: fontes.data ? fontes.data : dados ? dados.fontes : null,
    referencias: refsAtivas
      ? { total: refsAtivas.length, semLeitura: refsAtivas.filter((r) => !(r.leitura && r.leitura.trim())).length }
      : dados
        ? { total: dados.encontrado.referencias.total, semLeitura: dados.encontrado.referencias.sem_leitura }
        : referencias.isError
          ? { total: 0, semLeitura: 0 }
          : null,
    acervo: acervoAtivas
      ? { ativas: acervoAtivas.length, semDescricao: acervoAtivas.filter((i) => !(i.descricao && i.descricao.trim())).length }
      : acervo.isError
        ? { ativas: 0, semDescricao: 0 }
        : null,
    documentos: documentos ? { total: documentos.length, identidade: documentos.filter((d) => d.prioridade).length } : leitura.isError ? { total: 0, identidade: 0 } : null,
  });

  const lacunas: string[] = [];
  const todasAsLacunas = (dados ? dados.lacunas : []).concat(kit && kit.contexto && Array.isArray(kit.contexto.lacunas) ? kit.contexto.lacunas : []);
  for (const l of todasAsLacunas) {
    if (temTexto(l) && lacunas.indexOf(l) < 0) lacunas.push(l);
  }

  const depoisDeMontar = (alvo: string, data: RespostaDoMontar | null) => {
    const s = (data && data.sugestoes) || {};
    const limpas: SugestoesDoContexto = {};
    if (Array.isArray(s.paleta) && s.paleta.length) limpas.paleta = s.paleta;
    if (temTexto(s.estilo)) limpas.estilo = s.estilo;
    if (temTexto(s.regras)) limpas.regras = s.regras;
    setSugestoesPorCliente((p) => ({ ...p, [alvo]: limpas }));
    const f = data && data.fontes_escolhidas;
    if (f && temTexto(f.titulo)) {
      toast.success("Fontes escolhidas da biblioteca", {
        description: `Título: ${f.titulo}. Texto: ${f.texto}.${temTexto(f.porque) ? ` ${f.porque}` : ""}`,
      });
    }
    invalidar(alvo);
  };

  const montarSozinho = async (alvo: string) => {
    setMontandoPara(alvo);
    setErroDoMontar(null);
    try {
      const data = await chamarFuncao<RespostaDoMontar>("agente-contexto", { acao: "montar", client_id: alvo });
      avisarCustoReal("Contexto montado com o que o cliente já tem", data, atualizarCusto);
      depoisDeMontar(alvo, data);
    } catch (e) {
      setErroDoMontar({ clientId: alvo, erro: e });
    } finally {
      setMontandoPara((atual) => (atual === alvo ? null : atual));
    }
  };

  // Contexto nunca montado e há material: monta sozinho, uma vez por cliente.
  useEffect(() => {
    if (!dados || !clientId) return;
    if (dados.kit && dados.kit.contexto_atualizado_em) return;
    if (montados.current[clientId]) return;
    if (!temMaterial) return;
    montados.current[clientId] = true;
    void montarSozinho(clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados, clientId]);

  // Referências novas entraram na leitura: a galeria relê. O "ler" termina a
  // sincronização em segundo plano, então relê uma vez alguns segundos depois.
  useEffect(() => {
    if (!dados || !clientId) return;
    if (dados.encontrado.sincronizadas_agora > 0) {
      void queryClient.invalidateQueries({ queryKey: chaveDasReferencias(clientId) });
    }
    if (relidos.current[clientId]) return;
    relidos.current[clientId] = true;
    const alvo = clientId;
    const t = window.setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: chaveDasReferencias(alvo) });
      void queryClient.invalidateQueries({ queryKey: chaveDoAcervo(alvo) });
    }, 6000);
    return () => window.clearTimeout(t);
  }, [dados, clientId, queryClient]);

  const irParaSecao = (secao: SecaoDoContexto) => {
    if (secao === "ctx-documentos") setDocsAbertos(true);
    window.setTimeout(() => {
      const el = document.getElementById(secao);
      if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 30);
  };

  const tirarSugestao = (alvo: string, campo: keyof SugestoesDoContexto) =>
    setSugestoesPorCliente((p) => {
      const atual = { ...(p[alvo] || {}) };
      delete atual[campo];
      return { ...p, [alvo]: atual };
    });

  const aplicarSugestao = async (campo: keyof SugestoesDoContexto) => {
    const alvo = clientId;
    setAplicando(campo);
    try {
      const { error } = await (supabase as any)
        .from("cliente_kit_marca")
        .upsert({ client_id: alvo, [campo]: sugestoes[campo], atualizado_por: userId }, { onConflict: "client_id" });
      if (error) throw error;
      tirarSugestao(alvo, campo);
      toast.success("Sugestão aplicada");
      invalidar(alvo);
    } catch (e) {
      toast.error("Sugestão não aplicada", { description: textoDoErro(e) });
    } finally {
      setAplicando(null);
    }
  };

  const modeloDoContexto = padraoDoContexto(catalogo);
  const docs = documentos || [];
  const docsDeIdentidade = docs.filter((d) => d.prioridade).length;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between">
        <div className="mb-1 mr-3 min-w-0">
          <h2 className="truncate text-[15px] font-semibold text-foreground">Contexto{clientName ? ` de ${clientName}` : ""}</h2>
          <p className="flex items-center text-[11.5px] text-muted-foreground">
            {leitura.isFetching && <Loader2 className="mr-1.5 h-3 w-3 shrink-0 animate-spin" />}
            {leitura.isLoading
              ? "Lendo o que o painel já tem..."
              : contextoMontado
                ? `Montado ${dataEHora(kit!.contexto_atualizado_em!)}`
                : "Contexto ainda não montado"}
          </p>
        </div>
        <div className="mb-1 flex items-center">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mr-1.5 h-8 w-8 p-0"
            onClick={() => {
              void leitura.refetch();
              void kitQuery.refetch();
              void referencias.refetch();
            }}
            disabled={leitura.isFetching}
            aria-label="Ler de novo"
            title="Ler de novo (sem custo)"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${leitura.isFetching ? "animate-spin" : ""}`} />
          </Button>
          <BotaoComCusto
            rotulo={contextoMontado ? "Atualizar contexto" : "Montar contexto"}
            titulo={contextoMontado ? "Atualizar o contexto" : "Montar o contexto"}
            descricao="A montagem automática roda só na primeira vez. Aqui o agente lê de novo os documentos, o dossiê, as artes aprovadas e as referências sem leitura. O que a equipe já preencheu não é trocado: vira sugestão."
            variant="outline"
            className="h-8 text-[12px]"
            disabled={!dados || montando}
            partes={() => [
              { modeloId: modeloDoContexto?.id, tipo: "texto", tokensEntrada: TAMANHOS.montarContexto.entrada, tokensSaida: TAMANHOS.montarContexto.saida },
            ]}
            executar={() => chamarFuncao<RespostaDoMontar>("agente-contexto", { acao: "montar", client_id: clientId })}
            aoConcluir={(data) => depoisDeMontar(clientId, data)}
          />
        </div>
      </div>

      <Completude itens={itens} onIr={irParaSecao} />

      {montando && (
        <p className="flex items-center rounded-xl border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 shrink-0 animate-spin" />
          Montando o contexto a partir do que o cliente já tem...
        </p>
      )}
      {erroDoMontar && erroDoMontar.clientId === clientId && <AvisoDeErro erro={erroDoMontar.erro} />}
      {leitura.isError && (
        <div className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <AvisoDeErro erro={leitura.error} />
          </div>
          <Button type="button" size="sm" variant="outline" className="mt-2 h-8 shrink-0 text-[12px] sm:ml-3 sm:mt-0" onClick={() => void leitura.refetch()}>
            Tentar de novo
          </Button>
        </div>
      )}
      {dados && !temMaterial && !contextoMontado && (
        <p className="rounded-xl border border-dashed border-border bg-card px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
          Ainda não há documentos, dossiê nem artes aprovadas deste cliente no painel. Envie a identidade em Arquivos ou conte ao agente de contexto o que já sabe da marca.
        </p>
      )}

      <SugestoesPendentes
        sugestoes={sugestoes}
        kit={kit}
        aplicando={aplicando}
        onAplicar={(campo) => void aplicarSugestao(campo)}
        onIgnorar={(campo) => tirarSugestao(clientId, campo)}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Cartao
          id="ctx-marca"
          titulo="Marca"
          acao={
            onIrPara ? (
              <button type="button" onClick={() => onIrPara("marca")} className="text-[11.5px] font-medium text-foreground hover:underline">
                Editar marca
              </button>
            ) : undefined
          }
        >
          <CartaoMarca
            kit={kit}
            candidatos={dados ? dados.candidatos_a_logo : []}
            carregando={carregandoKit}
            onEditar={onIrPara ? () => onIrPara("marca") : undefined}
          />
        </Cartao>
        <Cartao
          id="ctx-referencias"
          titulo="Referências"
          meta={
            refsAtivas
              ? refsAtivas.length
                ? `${refsAtivas.length} em uso pelo diretor de arte`
                : "Nenhuma em uso"
              : "Lendo..."
          }
        >
          <GaleriaDeReferencias
            contextoMontado={contextoMontado}
            onGerenciar={onIrPara ? () => onIrPara("referencias") : undefined}
            aoLer={(data) => depoisDeMontar(clientId, data)}
          />
        </Cartao>
      </div>

      <Cartao id="ctx-fotos" titulo="Fotos reais">
        <FotosDoCliente onOrganizar={onIrPara ? () => onIrPara("imagens") : undefined} />
      </Cartao>

      <ContextoConsolidado kit={kit} carregando={carregandoKit} onEditar={onIrPara ? () => onIrPara("marca") : undefined} />

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <CartaoRecolhivel
          id="ctx-documentos"
          titulo="Documentos"
          resumo={
            documentos
              ? documentos.length
                ? `${documentos.length} lido(s), ${docsDeIdentidade} de identidade · dossiê ${dados!.encontrado.tem_dossie ? "sim" : "não"} · ${dados!.encontrado.artes_aprovadas} artes aprovadas`
                : "Nenhum documento em Arquivos"
              : leitura.isError
                ? "Não foi possível ler agora"
                : "Lendo..."
          }
          aberto={docsAbertos}
          onAlternar={() => setDocsAbertos((v) => !v)}
        >
          {!documentos ? (
            <Esqueleto linhas={3} />
          ) : documentos.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">Envie o manual de marca, o posicionamento ou a apresentação em Arquivos: o agente lê sozinho.</p>
          ) : (
            <ul className="space-y-1">
              {documentos.map((d) => (
                <li key={d.file_id} className="flex min-w-0 items-center text-[12.5px]">
                  <FileText className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate" title={d.nome}>{d.nome}</span>
                  {d.prioridade && <span className="ml-2 shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">identidade</span>}
                </li>
              ))}
            </ul>
          )}
        </CartaoRecolhivel>
        <CartaoRecolhivel
          titulo="Pendências do agente"
          resumo={
            dados || kit
              ? lacunas.length
                ? `${lacunas.length} ${lacunas.length === 1 ? "pendência" : "pendências"}`
                : "Nada pendente"
              : "Lendo..."
          }
          aberto={pendenciasAbertas}
          onAlternar={() => setPendenciasAbertas((v) => !v)}
        >
          {lacunas.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">O agente não aponta nada faltando.</p>
          ) : (
            <ul className="space-y-1.5">
              {lacunas.map((l) => (
                <li key={l} className="flex min-w-0 items-start text-[12.5px] leading-relaxed">
                  <Circle className="mr-2 mt-1.5 h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{l}</span>
                </li>
              ))}
            </ul>
          )}
        </CartaoRecolhivel>
      </div>
    </div>
  );
}
