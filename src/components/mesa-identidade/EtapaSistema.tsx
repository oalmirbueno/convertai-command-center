import { useRef, useState } from "react";
import { ImagePlus, Loader2, Pipette, Plus, RefreshCcw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { PreencherComIA } from "@/components/sistema";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { botao, campo, campoTexto, espaco, foco, juntar, lista, texto } from "@/components/sistema/estilos";
import { fichaDaCor, normalizarHex, PERFIS, ROTULO_DO_PAPEL_DA_COR, textoCmyk, textoRgb, type PapelDaCor } from "../../../supabase/functions/_shared/cores-da-marca";
import { SLOTS_DE_LOGO, USOS_INCORRETOS_PADRAO, type LogoDoBrandbook, type SlotDeLogo } from "../../../supabase/functions/mesa-identidade/modulos/brandbook";
import { faltaNaEtapa } from "../../../supabase/functions/_shared/identidade-etapas";
import { enviarImagemDeApoio, enviarLogo, motivoParaRecusarLogo, paletaDaLogo } from "./arquivosDaMarca";
import { CabecalhoDaEtapa, contextoParaPreencher, ImagemInteira, Pastilha, SeletorDoModelo, useModeloDaAcao, useProjetoDaMesa } from "./Comuns";
import { useGravacoesDaMesa, useValorSalvo } from "./gravacao";
import GeradorDePaleta, { ContrasteDaPaleta } from "./PaletaDaMarca";
import { GrafismosGerados, tiposDoPar, TipografiaDaMarca, type TipoDoSistema } from "./TipoEGrafismos";
import PaletaDoSetor from "./PaletaDoSetor";
import ParesDaBase from "./ParesDaBase";

type Cor = { nome: string; papel: PapelDaCor; hex: string };
type Tipo = { familia: string; uso: "titulo" | "texto" | "apoio"; pesos: string; licenca: string; alternativa: string };
type Grafismo = { tipo: string; descricao: string; imagem: string | null; svg?: string | null };
type Logos = { principal: LogoDoBrandbook | null; secundario: LogoDoBrandbook | null; alternativas: LogoDoBrandbook[]; icone: LogoDoBrandbook[] };
type Regras = { significado_do_logo: string; protecao: string; px: string; mm: string; incorretos: string };
type Foto = { coloracao: string; composicao: string; evitar: string; ia: string };

const PAPEIS: PapelDaCor[] = ["primaria", "secundaria", "destaque", "neutra"];
const TIPOS_DE_GRAFISMO = [
  { valor: "pattern", rotulo: "Pattern" },
  { valor: "ilustracao", rotulo: "Ilustração" },
  { valor: "fotografia", rotulo: "Estilo de foto" },
  { valor: "composicao", rotulo: "Composição" },
  { valor: "icones", rotulo: "Ícones" },
  { valor: "outro", rotulo: "Outro" },
];
const MAXIMO_DO_SLOT: Record<SlotDeLogo, number> = { principal: 1, secundario: 1, alternativas: 4, icone: 3 };

// ------------------------------------------------------------------ da tela para o servidor (e de volta)

const logosDaTela = (v: unknown): Logos => {
  const l = (v && typeof v === "object" ? v : {}) as Partial<Logos>;
  return { principal: l.principal || null, secundario: l.secundario || null, alternativas: Array.isArray(l.alternativas) ? l.alternativas : [], icone: Array.isArray(l.icone) ? l.icone : [] };
};
const coresParaSalvar = (l: Cor[]) => l.filter((c) => normalizarHex(c.hex)).map((c) => ({ ...c, hex: normalizarHex(c.hex) as string }));
const tiposDaTela = (v: unknown): Tipo[] =>
  Array.isArray(v) ? v.map((t: any) => ({ familia: t.familia || "", uso: t.uso || "texto", pesos: Array.isArray(t.pesos) ? t.pesos.join(", ") : typeof t.pesos === "string" ? t.pesos : "", licenca: t.licenca || "", alternativa: t.alternativa || "" })) : [];
const tiposParaSalvar = (l: Tipo[]) => l.filter((t) => t.familia.trim()).map((t) => ({ familia: t.familia.trim(), uso: t.uso, pesos: t.pesos.split(/[,;]+/).map((x) => x.trim()).filter(Boolean), licenca: t.licenca.trim(), alternativa: t.alternativa.trim() }));
const regrasDaTela = (sistema: Record<string, any>): Regras => {
  const r = (sistema.regras || {}) as Record<string, any>;
  return {
    significado_do_logo: sistema.significado_do_logo || "",
    protecao: String(Math.round((Number(r.protecao_fator) || 0.25) * 100)),
    px: String(r.reducao_minima_px || 120),
    mm: String(r.reducao_minima_mm || 25),
    incorretos: Array.isArray(r.usos_incorretos) && r.usos_incorretos.length ? r.usos_incorretos.join("\n") : USOS_INCORRETOS_PADRAO.join("\n"),
  };
};
const regrasParaSalvar = (r: Regras) => ({
  significado_do_logo: r.significado_do_logo.trim().slice(0, 1500),
  regras: {
    protecao_fator: Math.max(5, Math.min(100, Number(r.protecao) || 25)) / 100,
    reducao_minima_px: Math.max(16, Number(r.px) || 120),
    reducao_minima_mm: Math.max(5, Number(r.mm) || 25),
    usos_incorretos: r.incorretos.split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 8),
  },
});
const fotoDaTela = (v: unknown): Foto => {
  const f = (v && typeof v === "object" ? v : {}) as Record<string, string>;
  return { coloracao: f.coloracao || "", composicao: f.composicao || "", evitar: f.evitar || "", ia: f.ia || "" };
};
const fotoParaSalvar = (f: Foto) => ({ fotografia: { coloracao: f.coloracao, composicao: f.composicao, evitar: f.evitar, ia: f.ia } });

/**
 * Etapa 6, Sistema: logo, paleta, tipografia e grafismos. A logo é arquivo
 * real (SVG ou PNG) enviado pela equipe; a prévia PNG sai do próprio arquivo
 * e a paleta sai dos pixels da logo. RGB e CMYK são calculados por código.
 *
 * UXS 30/09: cada parte grava sozinha (logos, cores, tipografia, grafismos,
 * regras e foto em separado), e a releitura só reescreve a parte sem edição
 * pendente (enviar logo, guardar padrão ou uma ação do diretor não apagam o
 * que está sendo digitado em outra parte). Os geradores (harmonia, combinações
 * e padrão) ficam num bloco recolhível, recolhido quando a parte já tem valor.
 */
export default function EtapaSistema() {
  const mesa = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, salvarParte } = useProjetoDaMesa();
  const gravacoes = useGravacoesDaMesa();
  const avisarErro = useAvisarErro();
  const [modeloId, setModeloId] = useModeloDaAcao("identidade");
  const sistema = (projeto.dados.sistema || {}) as Record<string, any>;
  const marcaId = projeto.marca_id || (marca && !marca.principal ? marca.id : null);
  const nomeDaMarca = (projeto.dados.naming && projeto.dados.naming.nome) || (marca && !marca.principal ? marca.nome : mesa.clientName);
  const conceito = (projeto.dados.conceito || {}) as { caminhos?: any[]; escolhido?: string | null };
  const caminho = (conceito.caminhos || []).filter((c) => c.id === conceito.escolhido)[0] || null;

  const pLogos = useValorSalvo<Logos>({ id: "sistema:logos", servidor: logosDaTela(sistema.logos), paraSalvar: (l) => l, gravar: (n) => salvarParte("sistema", { logos: n }) });
  const pCores = useValorSalvo<Cor[]>({ id: "sistema:cores", servidor: Array.isArray(sistema.cores) ? (sistema.cores as Cor[]) : [], paraSalvar: coresParaSalvar, gravar: (n) => salvarParte("sistema", { cores: n }) });
  const pTipos = useValorSalvo<Tipo[]>({ id: "sistema:tipografia", servidor: tiposDaTela(sistema.tipografia), paraSalvar: tiposParaSalvar, gravar: (n) => salvarParte("sistema", { tipografia: n }) });
  const pGrafismos = useValorSalvo<Grafismo[]>({ id: "sistema:grafismos", servidor: Array.isArray(sistema.grafismos) ? (sistema.grafismos as Grafismo[]) : [], paraSalvar: (l) => l, gravar: (n) => salvarParte("sistema", { grafismos: n }) });
  const pRegras = useValorSalvo<Regras, ReturnType<typeof regrasParaSalvar>>({ id: "sistema:regras", servidor: regrasDaTela(sistema), paraSalvar: regrasParaSalvar, gravar: (n) => salvarParte("sistema", n) });
  const pFoto = useValorSalvo<Foto, ReturnType<typeof fotoParaSalvar>>({ id: "sistema:foto", servidor: fotoDaTela(sistema.fotografia), paraSalvar: fotoParaSalvar, gravar: (n) => salvarParte("sistema", n) });
  const logos = pLogos.valor;
  const cores = pCores.valor;
  const tipos = pTipos.valor;
  const grafismos = pGrafismos.valor;
  const regras = pRegras.valor;
  const foto = pFoto.valor;
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [sugeridas, setSugeridas] = useState<string[]>([]);

  // O que a etapa exige, pelo que está SALVO (a descrição da seção diz "não salvo" quando a tela está na frente).
  const faltaSalva = faltaNaEtapa("sistema", projeto.dados);
  const coresSalvas = (Array.isArray(sistema.cores) ? sistema.cores : []).filter((c: any) => c && normalizarHex(c.hex)).length;
  const familiasSalvas = tiposDaTela(sistema.tipografia).map((t) => t.familia).filter(Boolean);
  const graficosSalvos = Array.isArray(sistema.grafismos) ? sistema.grafismos.length : 0;
  const naoSalvo = (pendente: boolean) => (pendente ? " · não salvo" : "");

  /** Troca uma parte na hora e oferece o Desfazer (volta o valor de antes, gravando de novo). */
  const trocarComDesfazer = async <T,>(parte: { trocarESalvar: (v: T) => Promise<void> }, novo: T, antes: T, frase: string) => {
    try {
      await parte.trocarESalvar(novo);
      toast.success(frase, {
        duration: 10_000,
        action: {
          label: "Desfazer",
          onClick: () => {
            parte.trocarESalvar(antes).catch((e) => avisarErro(e, "Não foi possível desfazer"));
          },
        },
      });
    } catch (e) {
      avisarErro(e, "Não foi salvo");
    }
  };
  /** Troca as famílias do sistema com Desfazer (pares da casa, sugestão do diretor e pares da base), pela fila de gravação. */
  const usarTipos = (novos: TipoDoSistema[], origem: string) => void trocarComDesfazer(pTipos, novos, tipos, `Tipografia trocada (${origem})`);

  // ---------------------------------------------------------------- logos

  const enviar = async (slot: SlotDeLogo, arquivo: File) => {
    const motivo = motivoParaRecusarLogo(arquivo);
    if (motivo) {
      toast.error(motivo);
      return;
    }
    setOcupado(`logo-${slot}`);
    try {
      const antes = logos;
      const rotulo = slot === "alternativas" ? `Alternativa ${logos.alternativas.length + 1}` : slot === "icone" ? `Ícone ${logos.icone.length + 1}` : "";
      const l = await enviarLogo(mesa.clientId, projeto.id, arquivo, slot, rotulo);
      const novas: Logos = { ...logos };
      if (slot === "alternativas") novas.alternativas = logos.alternativas.concat([l]).slice(0, MAXIMO_DO_SLOT.alternativas);
      else if (slot === "icone") novas.icone = logos.icone.concat([l]).slice(0, MAXIMO_DO_SLOT.icone);
      else novas[slot] = l;
      const trocou = (slot === "principal" || slot === "secundario") && !!antes[slot];
      // Trocar a principal: as cores sugeridas vinham da logo antiga.
      if (slot === "principal") setSugeridas([]);
      await pLogos.trocarESalvar(novas);
      const descricao = /svg/i.test(l.mime) ? undefined : "PNG serve, mas o vetor (SVG) é o ideal para o pacote.";
      if (trocou) {
        // O arquivo antigo continua guardado: o Desfazer volta o registro dele.
        toast.success("Logo trocada", {
          description: descricao,
          duration: 10_000,
          action: { label: "Desfazer", onClick: () => void pLogos.trocarESalvar(antes).catch((e) => avisarErro(e, "Não foi possível desfazer")) },
        });
      } else toast.success(/svg/i.test(l.mime) ? "Logo em vetor guardada" : "Logo guardada", { description: descricao });
    } catch (e) {
      avisarErro(e, "A logo não foi enviada");
    } finally {
      setOcupado(null);
    }
  };

  const tirar = async (slot: SlotDeLogo, i = 0) => {
    const novas: Logos = { ...logos };
    if (slot === "alternativas") novas.alternativas = logos.alternativas.filter((_, k) => k !== i);
    else if (slot === "icone") novas.icone = logos.icone.filter((_, k) => k !== i);
    else novas[slot] = null;
    setOcupado(`logo-${slot}`);
    try {
      await pLogos.trocarESalvar(novas);
      toast.success("Logo tirada do sistema (o arquivo continua guardado)");
    } catch (e) {
      avisarErro(e, "Não foi salvo");
    } finally {
      setOcupado(null);
    }
  };

  const tirarPaleta = async () => {
    const base = logos.principal ? logos.principal.previa_png || logos.principal.caminho : null;
    if (!base || /\.svg$/i.test(base)) {
      toast.info("Envie a logo principal primeiro.");
      return;
    }
    setOcupado("paleta-logo");
    try {
      const hexes = await paletaDaLogo(base);
      setSugeridas(hexes.filter((h) => !cores.some((c) => c.hex === h)));
      if (!hexes.length) toast.info("A logo não tem cor além de preto e branco.");
    } catch (e) {
      avisarErro(e, "A paleta não saiu da logo");
    } finally {
      setOcupado(null);
    }
  };

  const perfil = PERFIS.revestido;
  const faltaLogo = faltaSalva.some((f) => /logo principal/i.test(f));
  const faltaCores = Math.max(0, 2 - coresSalvas);

  return (
    <div
      className={espaco.pagina}
      data-etapa-sistema=""
      onBlur={() => {
        if (gravacoes && gravacoes.temPendente()) void gravacoes.salvarTudo().catch(() => undefined);
      }}
    >
      <CabecalhoDaEtapa
        etapa="sistema"
        ajuda="Logo pelo código: a logo final é o arquivo real da equipe (SVG de preferência; PNG serve). A imagem de IA do conceito é só inspiração. Vetorizar PNG dentro do painel ainda não existe (sem biblioteca leve): faça o vetor no editor e envie o SVG. Tudo aqui grava sozinho."
        acoes={<SeletorDoModelo papel="identidade" valor={modeloId} onEscolher={setModeloId} className="max-w-[180px]" />}
      />

      <Secao titulo="Logotipos" descricao={`${faltaLogo ? "Falta a principal" : "Principal enviada"}${naoSalvo(pLogos.pendente)}`} recolher={`mesa-identidade:${projeto.id}:sistema:logos`} data-bloco-da-etapa="logos">
        <div className={juntar("grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4")}>
          {SLOTS_DE_LOGO.map((s) => {
            const itens = s.valor === "alternativas" ? logos.alternativas : s.valor === "icone" ? logos.icone : logos[s.valor] ? [logos[s.valor] as LogoDoBrandbook] : [];
            return <SlotDaLogo key={s.valor} slot={s.valor} rotulo={s.rotulo} varios={s.varios} itens={itens} ocupado={ocupado === `logo-${s.valor}`} onArquivo={(f) => void enviar(s.valor, f)} onTirar={(i) => void tirar(s.valor, i)} />;
          })}
        </div>
      </Secao>

      <Secao
        titulo="Paleta"
        divisoria
        descricao={`${faltaCores ? `Falta${faltaCores === 1 ? "" : "m"} ${faltaCores} ${faltaCores === 1 ? "cor" : "cores"} para concluir` : `${coresSalvas} cores`}${naoSalvo(pCores.pendente)}`}
        recolher={`mesa-identidade:${projeto.id}:sistema:paleta`}
        ajuda={`HEX é o que a equipe define. RGB e CMYK saem por código; o CMYK usa o perfil ${perfil.nome} (limite de tinta ${perfil.limiteDeTinta}%). Para impressão, confirme a prova com a gráfica.`}
        data-bloco-da-etapa="paleta"
        acao={
          <>
            <button type="button" className={juntar(botao.discreto, "m-1 h-8")} onClick={() => void tirarPaleta()} disabled={ocupado === "paleta-logo"}>
              {ocupado === "paleta-logo" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Pipette className="mr-1.5 h-3.5 w-3.5" />} Da logo
            </button>
            {caminho && caminho.paleta && caminho.paleta.length > 0 && (
              <button
                type="button"
                className={juntar(botao.discreto, "m-1 h-8")}
                onClick={() => {
                  // Mesmo filtro do que vai ao servidor: HEX inválido do caminho não entra.
                  const novas = coresParaSalvar(caminho.paleta.map((p: any) => ({ nome: String(p.nome || ""), papel: PAPEIS.indexOf(p.papel) >= 0 ? p.papel : "secundaria", hex: String(p.hex || "") })));
                  if (!novas.length) {
                    toast.info("O caminho não tem cor válida.");
                    return;
                  }
                  void trocarComDesfazer(pCores, novas, coresParaSalvar(cores), "Paleta trocada (caminho)");
                }}
              >
                Do caminho
              </button>
            )}
          </>
        }
      >
        {sugeridas.length > 0 && (
          <div className="-m-1 mb-3 flex min-w-0 flex-wrap items-center">
            <span className={juntar(texto.auxiliar, "m-1")}>Da logo:</span>
            {sugeridas.map((h) => (
              <button
                key={h}
                type="button"
                className={juntar(botao.discreto, "m-1 h-8")}
                onClick={() => {
                  pCores.mudar(cores.concat([{ nome: h, papel: cores.length < 2 ? "primaria" : "secundaria", hex: h }]));
                  setSugeridas(sugeridas.filter((x) => x !== h));
                }}
              >
                <span className="mr-1.5 inline-block h-4 w-4 rounded border border-border" style={{ background: h }} /> {h}
              </button>
            ))}
          </div>
        )}
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Cores da paleta">
          {cores.map((c, i) => {
            const ficha = fichaDaCor(c);
            return (
              <li key={i} className={juntar(lista.linha, "flex-wrap")}>
                <span className="mr-3 h-9 w-9 shrink-0 rounded-md border border-border" style={{ background: ficha ? ficha.hex : "transparent" }} />
                <input className={juntar(campo, "mr-2 w-40")} value={c.nome} maxLength={40} aria-label="Nome da cor" onChange={(e) => pCores.mudar(cores.map((x, k) => (k === i ? { ...x, nome: e.target.value } : x)))} />
                <select className={juntar(campo, "mr-2 w-36")} value={c.papel} aria-label="Papel da cor" onChange={(e) => pCores.mudar(cores.map((x, k) => (k === i ? { ...x, papel: e.target.value as PapelDaCor } : x)))}>
                  {PAPEIS.map((p) => (
                    <option key={p} value={p}>
                      {ROTULO_DO_PAPEL_DA_COR[p]}
                    </option>
                  ))}
                </select>
                <input className={juntar(campo, "mr-3 w-28 font-mono")} value={c.hex} maxLength={7} aria-label="HEX" onChange={(e) => pCores.mudar(cores.map((x, k) => (k === i ? { ...x, hex: e.target.value } : x)))} />
                <span className={juntar(texto.auxiliar, "min-w-0 flex-1 tabular-nums")}>{ficha ? `${textoRgb(ficha.rgb)}  ·  ${textoCmyk(ficha.cmyk)}` : "HEX inválido"}</span>
                <button
                  type="button"
                  className={botao.icone}
                  aria-label={`Tirar a cor ${c.nome}`}
                  onClick={() => {
                    const novas = cores.filter((_, k) => k !== i);
                    if (normalizarHex(c.hex)) void trocarComDesfazer(pCores, novas, cores, "Cor tirada");
                    else pCores.mudar(novas);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className={juntar(botao.discreto, "mt-2")} disabled={cores.length >= 8} onClick={() => pCores.mudar(cores.concat([{ nome: "", papel: cores.length ? "secundaria" : "primaria", hex: "#" }]))}>
          <Plus className="mr-1.5 h-4 w-4" /> Cor
        </button>
        <ContrasteDaPaleta cores={cores} />
        <Secao
          titulo="Gerar paleta"
          nivel={3}
          divisoria
          className="mt-6"
          recolher={`mesa-identidade:${projeto.id}:sistema:paleta:gerador`}
          recolhidaDeInicio={coresSalvas >= 2}
          resumo={Array.isArray(sistema.propostas_de_paleta) && sistema.propostas_de_paleta.length ? `${sistema.propostas_de_paleta.length} propostas do diretor` : "Harmonia e paletas com IA"}
        >
          <GeradorDePaleta cores={cores} onUsar={(novas, origem) => void trocarComDesfazer(pCores, novas, coresParaSalvar(cores), `Paleta trocada (${origem})`)} />
        </Secao>
        <PaletaDoSetor cores={cores} />
      </Secao>

      <Secao
        titulo="Tipografia"
        divisoria
        descricao={`${familiasSalvas.length ? familiasSalvas.join(", ") : "Falta a fonte dos títulos"}${naoSalvo(pTipos.pendente)}`}
        recolher={`mesa-identidade:${projeto.id}:sistema:tipografia`}
        ajuda="Família, uso e licença. O painel não adivinha a fonte de uma imagem: escreva o nome exato (de preferência do Google Fonts). Arquivos de fonte enviados em Contexto > Fontes entram no pacote da marca."
        data-bloco-da-etapa="tipografia"
        acao={
          caminho && caminho.tipografia ? (
            <button
              type="button"
              className={juntar(botao.discreto, "m-1 h-8")}
              onClick={() => {
                // A mesma montagem do "Usar" das combinações: licença pelo catálogo e a família de apoio fica.
                const novos = tiposDoPar(String(caminho.tipografia.titulo || ""), String(caminho.tipografia.texto || ""), tipos);
                if (!novos.length) return;
                void trocarComDesfazer(pTipos, novos, tipos, "Tipografia trocada (caminho)");
              }}
            >
              Do caminho
            </button>
          ) : undefined
        }
      >
        {tipos.map((t, i) => (
          <div key={i} className="mb-3 grid min-w-0 grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,1fr)_120px_140px_minmax(0,1fr)_auto]">
            <CampoDeFormulario rotulo="Família">
              <input className={campo} value={t.familia} maxLength={60} onChange={(e) => pTipos.mudar(tipos.map((x, k) => (k === i ? { ...x, familia: e.target.value } : x)))} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Uso">
              <select className={campo} value={t.uso} onChange={(e) => pTipos.mudar(tipos.map((x, k) => (k === i ? { ...x, uso: e.target.value as Tipo["uso"] } : x)))}>
                <option value="titulo">Títulos</option>
                <option value="texto">Texto</option>
                <option value="apoio">Apoio</option>
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Pesos">
              <input className={campo} value={t.pesos} maxLength={60} placeholder="400, 700" onChange={(e) => pTipos.mudar(tipos.map((x, k) => (k === i ? { ...x, pesos: e.target.value } : x)))} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Licença">
              <input className={campo} value={t.licenca} maxLength={120} placeholder="Google Fonts (OFL)" onChange={(e) => pTipos.mudar(tipos.map((x, k) => (k === i ? { ...x, licenca: e.target.value } : x)))} />
            </CampoDeFormulario>
            <button
              type="button"
              className={botao.icone}
              aria-label="Tirar a família"
              onClick={() => {
                const novos = tipos.filter((_, k) => k !== i);
                if (t.familia.trim()) void trocarComDesfazer(pTipos, novos, tipos, "Família tirada");
                else pTipos.mudar(novos);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button type="button" className={botao.discreto} disabled={tipos.length >= 4} onClick={() => pTipos.mudar(tipos.concat([{ familia: "", uso: tipos.length ? "texto" : "titulo", pesos: "", licenca: "", alternativa: "" }]))}>
          <Plus className="mr-1.5 h-4 w-4" /> Família
        </button>
        <TipografiaDaMarca tipos={tipos} geradorRecolhido={familiasSalvas.length > 0} onUsar={usarTipos} />
        <ParesDaBase tipos={tipos} onUsar={usarTipos} />
      </Secao>

      <Secao
        titulo="Grafismos e ativos"
        divisoria
        descricao={`${grafismos.length} ativos${naoSalvo(pGrafismos.pendente)}`}
        recolher={`mesa-identidade:${projeto.id}:sistema:grafismos`}
        data-bloco-da-etapa="grafismos"
        acao={
          <EnviarArquivo
            rotulo="Enviar ativo"
            aceitar=".png,.jpg,.jpeg,.webp"
            ocupado={ocupado === "grafismo"}
            onArquivo={(f) =>
              void (async () => {
                setOcupado("grafismo");
                try {
                  const caminhoDoAtivo = await enviarImagemDeApoio(mesa.clientId, projeto.id, f, "grafismos");
                  await pGrafismos.trocarESalvar(grafismos.concat([{ tipo: "pattern", descricao: "", imagem: caminhoDoAtivo }]).slice(0, 6));
                } catch (e) {
                  avisarErro(e, "O ativo não foi enviado");
                } finally {
                  setOcupado(null);
                }
              })()
            }
          />
        }
      >
        <div className={juntar(espaco.grade, "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3")}>
          {grafismos.map((g, i) => (
            <div key={i} className="min-w-0">
              <ImagemInteira caminho={g.imagem} alt={g.descricao || "Ativo da marca"} className="h-32 bg-muted" />
              <div className="mt-2 grid min-w-0 grid-cols-[120px_minmax(0,1fr)_auto] items-center gap-2">
                <select className={campo} value={g.tipo} aria-label="Tipo do ativo" onChange={(e) => pGrafismos.mudar(grafismos.map((x, k) => (k === i ? { ...x, tipo: e.target.value } : x)))}>
                  {TIPOS_DE_GRAFISMO.map((t) => (
                    <option key={t.valor} value={t.valor}>
                      {t.rotulo}
                    </option>
                  ))}
                </select>
                <input className={campo} value={g.descricao} maxLength={300} placeholder="Como usar" aria-label="Descrição do ativo" onChange={(e) => pGrafismos.mudar(grafismos.map((x, k) => (k === i ? { ...x, descricao: e.target.value } : x)))} />
                <button type="button" className={botao.icone} aria-label="Tirar o ativo" onClick={() => void trocarComDesfazer(pGrafismos, grafismos.filter((_, k) => k !== i), grafismos, "Ativo tirado")}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
        {!grafismos.length && <p className={texto.auxiliar}>Pattern, estilo de foto, ilustração e ícones da marca.</p>}
        <Secao titulo="Gerar padrão" nivel={3} divisoria className="mt-6" recolher={`mesa-identidade:${projeto.id}:sistema:grafismos:gerador`} recolhidaDeInicio={graficosSalvos > 0} resumo="Padrões com as cores da marca">
          <GrafismosGerados
            cores={cores.map((c) => c.hex)}
            familia={(tipos.filter((t) => t.uso === "titulo")[0] || tipos[0] || { familia: "Helvetica" }).familia}
            nome={String(nomeDaMarca || "")}
            onGuardar={async (g) => {
              await pGrafismos.trocarESalvar(grafismos.concat([g]).slice(-6));
              toast.success("Padrão guardado nos ativos");
            }}
          />
        </Secao>
      </Secao>

      <Secao
        titulo="Regras de uso e conceito do logo"
        divisoria
        descricao={pRegras.pendente || pFoto.pendente ? "Não salvo" : undefined}
        recolher={`mesa-identidade:${projeto.id}:sistema:regras`}
        data-bloco-da-etapa="regras"
        acao={
          <PreencherComIA
            papel="identidade"
            clientId={mesa.clientId}
            marcaId={marcaId}
            campos={[
              { chave: "significado_do_logo", rotulo: "Significado do logo", tipo: "texto_longo", valorAtual: regras.significado_do_logo, dica: "O conceito da logo ligado à estratégia e ao caminho escolhido; sem inventar história.", maximo: 1500 },
              { chave: "fotografia.coloracao", rotulo: "Fotografia: coloração e composição", tipo: "texto_longo", valorAtual: foto.coloracao, maximo: 600 },
              { chave: "fotografia.evitar", rotulo: "Fotografia: o que evitar", tipo: "texto", valorAtual: foto.evitar, maximo: 600 },
              { chave: "fotografia.ia", rotulo: "Imagem gerada por IA", tipo: "texto", valorAtual: foto.ia, dica: "Regra de uso de imagem de IA na marca.", maximo: 600 },
            ]}
            contexto={contextoParaPreencher(projeto, caminho ? `Caminho escolhido: ${caminho.nome}. ${caminho.ideia || ""}` : undefined)}
            onAplicar={async (v) => {
              const r2 = { ...regras, significado_do_logo: v.significado_do_logo != null ? String(v.significado_do_logo).slice(0, 1500) : regras.significado_do_logo };
              const f2 = { ...foto, coloracao: v["fotografia.coloracao"] != null ? String(v["fotografia.coloracao"]) : foto.coloracao, evitar: v["fotografia.evitar"] != null ? String(v["fotografia.evitar"]) : foto.evitar, ia: v["fotografia.ia"] != null ? String(v["fotografia.ia"]) : foto.ia };
              await Promise.all([pRegras.trocarESalvar(r2), pFoto.trocarESalvar(f2)]);
            }}
            onDesfazer={async (a) => {
              const r2 = { ...regras, significado_do_logo: String(a.significado_do_logo || "") };
              const f2 = { ...foto, coloracao: String(a["fotografia.coloracao"] || ""), evitar: String(a["fotografia.evitar"] || ""), ia: String(a["fotografia.ia"] || "") };
              await Promise.all([pRegras.trocarESalvar(r2), pFoto.trocarESalvar(f2)]);
            }}
          />
        }
      >
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          <CampoDeFormulario rotulo="Significado do logo" largo>
            <textarea className={juntar(campoTexto, "min-h-[72px]")} value={regras.significado_do_logo} maxLength={1500} onChange={(e) => pRegras.mudar({ ...regras, significado_do_logo: e.target.value })} />
          </CampoDeFormulario>
          <div className="grid min-w-0 grid-cols-3 gap-3">
            <CampoDeFormulario rotulo="Proteção (%)">
              <input className={campo} inputMode="numeric" value={regras.protecao} onChange={(e) => pRegras.mudar({ ...regras, protecao: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) })} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Mínimo (px)">
              <input className={campo} inputMode="numeric" value={regras.px} onChange={(e) => pRegras.mudar({ ...regras, px: e.target.value.replace(/[^0-9]/g, "").slice(0, 4) })} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Mínimo (mm)">
              <input className={campo} inputMode="numeric" value={regras.mm} onChange={(e) => pRegras.mudar({ ...regras, mm: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) })} />
            </CampoDeFormulario>
          </div>
          <CampoDeFormulario rotulo="Usos incorretos" apoio="Um por linha">
            <textarea className={juntar(campoTexto, "min-h-[120px]")} value={regras.incorretos} maxLength={1200} onChange={(e) => pRegras.mudar({ ...regras, incorretos: e.target.value })} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Fotografia: coloração e composição">
            <textarea className={juntar(campoTexto, "min-h-[120px]")} value={foto.coloracao} maxLength={600} onChange={(e) => pFoto.mudar({ ...foto, coloracao: e.target.value })} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Fotografia: o que evitar">
            <input className={campo} value={foto.evitar} maxLength={600} onChange={(e) => pFoto.mudar({ ...foto, evitar: e.target.value })} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Imagem gerada por IA">
            <input className={campo} value={foto.ia} maxLength={600} placeholder="Só como apoio, nunca no lugar do produto real" onChange={(e) => pFoto.mudar({ ...foto, ia: e.target.value })} />
          </CampoDeFormulario>
        </div>
      </Secao>
    </div>
  );
}

/**
 * Um slot de logo (UXS 30/09, IDV-12): vazio, a caixa tracejada é o alvo de
 * envio (clique ou arrastar e soltar, só o primeiro arquivo conta); com logo,
 * a principal e a secundária ganham "Trocar". Versões e ícone (vários
 * arquivos) mantêm o envio no título para acrescentar. Uma entrada de arquivo
 * só por slot, sempre pela mesma validação (`enviar`, com motivoParaRecusarLogo).
 */
function SlotDaLogo({ slot, rotulo, varios, itens, ocupado, onArquivo, onTirar }: { slot: SlotDeLogo; rotulo: string; varios: boolean; itens: LogoDoBrandbook[]; ocupado: boolean; onArquivo: (f: File) => void; onTirar: (i: number) => void }) {
  const entrada = useRef<HTMLInputElement | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const abrir = () => {
    if (entrada.current) entrada.current.click();
  };
  const cheio = itens.length >= MAXIMO_DO_SLOT[slot];
  const nome = rotulo.toLowerCase();
  return (
    <div className="min-w-0" data-slot-de-logo={slot}>
      <input
        ref={entrada}
        type="file"
        accept=".svg,.png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          if (f) onArquivo(f);
          e.target.value = "";
        }}
      />
      <div className="mb-2 flex min-w-0 items-center">
        <h3 className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>{rotulo}</h3>
        {varios ? (
          itens.length > 0 && (
            <button type="button" className={juntar(botao.discreto, "m-1 h-8")} aria-label={`Enviar ${nome}`} title={cheio ? "Já tem o máximo de arquivos" : `Enviar ${nome}`} disabled={ocupado || cheio} onClick={abrir}>
              {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            </button>
          )
        ) : (
          itens.length > 0 && (
            <button type="button" className={juntar(botao.discreto, "m-1 h-8")} aria-label={`Trocar ${nome}`} disabled={ocupado} onClick={abrir} data-trocar-logo={slot}>
              {ocupado ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />} Trocar
            </button>
          )
        )}
      </div>
      {itens.length === 0 && (
        <button
          type="button"
          className={juntar(
            "flex h-24 w-full flex-col items-center justify-center rounded-md border border-dashed text-[12px] leading-4 text-muted-foreground transition-colors",
            arrastando ? "border-primary bg-primary/5 text-foreground" : "border-border hover:border-primary/50 hover:text-foreground",
            ocupado && "cursor-wait",
            foco,
          )}
          aria-label={`Enviar ${nome}`}
          aria-busy={ocupado || undefined}
          disabled={ocupado}
          onClick={abrir}
          onDragEnter={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!arrastando) setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (f && !ocupado) onArquivo(f);
          }}
          data-campo={`logo-${slot}`}
          data-zona-da-logo={slot}
        >
          {ocupado ? <Loader2 className="mb-1 h-4 w-4 animate-spin" /> : <Upload className="mb-1 h-4 w-4" />}
          <span>{ocupado ? "Enviando..." : "Enviar SVG ou PNG"}</span>
        </button>
      )}
      {itens.map((l, i) => (
        <div key={l.caminho} className="mb-2 min-w-0">
          <div className="grid grid-cols-2 gap-2">
            <ImagemInteira caminho={l.previa_png || l.caminho} alt={`${rotulo} sobre claro`} className="h-24 border border-border p-2" fundo="#F4F6F4" />
            <ImagemInteira caminho={l.previa_png || l.caminho} alt={`${rotulo} sobre escuro`} className="h-24 p-2" fundo="#151B17" />
          </div>
          <div className="mt-1 flex min-w-0 items-center">
            <Pastilha tom={/svg/i.test(l.mime) ? "bom" : "neutro"}>{/svg/i.test(l.mime) ? "SVG" : "PNG"}</Pastilha>
            <span className={juntar(texto.etiqueta, "ml-1.5 min-w-0 flex-1 truncate text-muted-foreground")}>{l.rotulo}</span>
            <button type="button" className={botao.icone} aria-label={`Tirar ${nome}`} disabled={ocupado} onClick={() => onTirar(i)}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Botão pequeno que abre o seletor de arquivo. */
function EnviarArquivo({ rotulo, aceitar, ocupado, desativado, onArquivo }: { rotulo: string; aceitar: string; ocupado: boolean; desativado?: boolean; onArquivo: (f: File) => void }) {
  const entrada = useRef<HTMLInputElement | null>(null);
  return (
    <>
      <input
        ref={entrada}
        type="file"
        accept={aceitar}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          if (f) onArquivo(f);
          e.target.value = "";
        }}
      />
      <button type="button" className={juntar(botao.discreto, "m-1 h-8")} aria-label={rotulo} title={rotulo} disabled={ocupado || desativado} onClick={() => entrada.current && entrada.current.click()}>
        {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : aceitar.indexOf(".svg") >= 0 ? <Upload className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />}
      </button>
    </>
  );
}
