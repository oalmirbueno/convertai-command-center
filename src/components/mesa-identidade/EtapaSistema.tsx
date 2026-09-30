import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Pipette, Plus, Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { PreencherComIA } from "@/components/sistema";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { botao, campo, campoTexto, espaco, juntar, lista, texto } from "@/components/sistema/estilos";
import { fichaDaCor, normalizarHex, PERFIS, ROTULO_DO_PAPEL_DA_COR, textoCmyk, textoRgb, type PapelDaCor } from "../../../supabase/functions/_shared/cores-da-marca";
import { SLOTS_DE_LOGO, USOS_INCORRETOS_PADRAO, type LogoDoBrandbook, type SlotDeLogo } from "../../../supabase/functions/mesa-identidade/modulos/brandbook";
import { enviarImagemDeApoio, enviarLogo, motivoParaRecusarLogo, paletaDaLogo } from "./arquivosDaMarca";
import { CabecalhoDaEtapa, contextoParaPreencher, ImagemInteira, Pastilha, useProjetoDaMesa } from "./Comuns";
import GeradorDePaleta, { ContrasteDaPaleta } from "./PaletaDaMarca";
import { GrafismosGerados, TipografiaDaMarca } from "./TipoEGrafismos";

type Cor = { nome: string; papel: PapelDaCor; hex: string };
type Tipo = { familia: string; uso: "titulo" | "texto" | "apoio"; pesos: string; licenca: string; alternativa: string };
type Grafismo = { tipo: string; descricao: string; imagem: string | null; svg?: string | null };
type Logos = { principal: LogoDoBrandbook | null; secundario: LogoDoBrandbook | null; alternativas: LogoDoBrandbook[]; icone: LogoDoBrandbook[] };

const PAPEIS: PapelDaCor[] = ["primaria", "secundaria", "destaque", "neutra"];
const TIPOS_DE_GRAFISMO = [
  { valor: "pattern", rotulo: "Pattern" },
  { valor: "ilustracao", rotulo: "Ilustração" },
  { valor: "fotografia", rotulo: "Estilo de foto" },
  { valor: "composicao", rotulo: "Composição" },
  { valor: "icones", rotulo: "Ícones" },
  { valor: "outro", rotulo: "Outro" },
];

const logosVazias = (): Logos => ({ principal: null, secundario: null, alternativas: [], icone: [] });

/**
 * Etapa 6, Sistema: logo, paleta, tipografia e grafismos. A logo é arquivo
 * real (SVG ou PNG) enviado pela equipe; a prévia PNG sai do próprio arquivo
 * e a paleta sai dos pixels da logo. RGB e CMYK são calculados por código.
 */
export default function EtapaSistema() {
  const mesa = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, salvarParte } = useProjetoDaMesa();
  const avisarErro = useAvisarErro();
  const sistema = (projeto.dados.sistema || {}) as Record<string, any>;
  const marcaId = projeto.marca_id || (marca && !marca.principal ? marca.id : null);
  const nomeDaMarca = (projeto.dados.naming && projeto.dados.naming.nome) || (marca && !marca.principal ? marca.nome : mesa.clientName);
  const conceito = (projeto.dados.conceito || {}) as { caminhos?: any[]; escolhido?: string | null };
  const caminho = (conceito.caminhos || []).filter((c) => c.id === conceito.escolhido)[0] || null;

  const [logos, setLogos] = useState<Logos>(logosVazias());
  const [cores, setCores] = useState<Cor[]>([]);
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [grafismos, setGrafismos] = useState<Grafismo[]>([]);
  const [regras, setRegras] = useState({ significado_do_logo: "", protecao: "25", px: "120", mm: "25", incorretos: USOS_INCORRETOS_PADRAO.join("\n") });
  const [foto, setFoto] = useState({ coloracao: "", composicao: "", evitar: "", ia: "" });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [sugeridas, setSugeridas] = useState<string[]>([]);

  useEffect(() => {
    const l = (sistema.logos || {}) as Partial<Logos>;
    setLogos({ principal: l.principal || null, secundario: l.secundario || null, alternativas: l.alternativas || [], icone: l.icone || [] });
    setCores(Array.isArray(sistema.cores) ? sistema.cores : []);
    setTipos(Array.isArray(sistema.tipografia) ? sistema.tipografia.map((t: any) => ({ familia: t.familia || "", uso: t.uso || "texto", pesos: Array.isArray(t.pesos) ? t.pesos.join(", ") : "", licenca: t.licenca || "", alternativa: t.alternativa || "" })) : []);
    setGrafismos(Array.isArray(sistema.grafismos) ? sistema.grafismos : []);
    const r = (sistema.regras || {}) as Record<string, any>;
    setRegras({
      significado_do_logo: sistema.significado_do_logo || "",
      protecao: String(Math.round((Number(r.protecao_fator) || 0.25) * 100)),
      px: String(r.reducao_minima_px || 120),
      mm: String(r.reducao_minima_mm || 25),
      incorretos: Array.isArray(r.usos_incorretos) && r.usos_incorretos.length ? r.usos_incorretos.join("\n") : USOS_INCORRETOS_PADRAO.join("\n"),
    });
    const f = (sistema.fotografia || {}) as Record<string, string>;
    setFoto({ coloracao: f.coloracao || "", composicao: f.composicao || "", evitar: f.evitar || "", ia: f.ia || "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projeto.id, projeto.versao]);

  const salvar = async (qual: string, valor: Record<string, unknown>, frase: string) => {
    setOcupado(qual);
    try {
      await salvarParte("sistema", valor);
      toast.success(frase);
    } catch (e) {
      avisarErro(e, "Não foi salvo");
    } finally {
      setOcupado(null);
    }
  };

  /** Troca uma parte do sistema e oferece o Desfazer (volta o valor de antes, gravando de novo). */
  const trocarComDesfazer = async (chave: "cores" | "tipografia", novo: unknown[], antes: unknown[], frase: string, aplicarNaTela: (v: any[]) => void) => {
    aplicarNaTela(novo as any[]);
    try {
      await salvarParte("sistema", { [chave]: novo });
      toast.success(frase, {
        duration: 10_000,
        action: {
          label: "Desfazer",
          onClick: () => {
            aplicarNaTela(antes as any[]);
            salvarParte("sistema", { [chave]: antes }).catch((e) => avisarErro(e, "Não foi possível desfazer"));
          },
        },
      });
    } catch (e) {
      aplicarNaTela(antes as any[]);
      avisarErro(e, "Não foi salvo");
    }
  };
  const tiposParaSalvar = (l: Tipo[]) => l.filter((t) => t.familia.trim()).map((t) => ({ familia: t.familia.trim(), uso: t.uso, pesos: t.pesos.split(/[,;]+/).map((x) => x.trim()).filter(Boolean), licenca: t.licenca.trim(), alternativa: t.alternativa.trim() }));

  // ---------------------------------------------------------------- logos

  const enviar = async (slot: SlotDeLogo, arquivo: File) => {
    const motivo = motivoParaRecusarLogo(arquivo);
    if (motivo) {
      toast.error(motivo);
      return;
    }
    setOcupado(`logo-${slot}`);
    try {
      const rotulo = slot === "alternativas" ? `Alternativa ${logos.alternativas.length + 1}` : slot === "icone" ? `Ícone ${logos.icone.length + 1}` : "";
      const l = await enviarLogo(mesa.clientId, projeto.id, arquivo, slot, rotulo);
      const novas: Logos = { ...logos };
      if (slot === "alternativas") novas.alternativas = logos.alternativas.concat([l]).slice(0, 4);
      else if (slot === "icone") novas.icone = logos.icone.concat([l]).slice(0, 3);
      else novas[slot] = l;
      setLogos(novas);
      await salvarParte("sistema", { logos: novas });
      toast.success(/svg/i.test(l.mime) ? "Logo em vetor guardada" : "Logo guardada", { description: /svg/i.test(l.mime) ? undefined : "PNG serve, mas o vetor (SVG) é o ideal para o pacote." });
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
    setLogos(novas);
    await salvar(`logo-${slot}`, { logos: novas }, "Logo tirada do sistema (o arquivo continua guardado)");
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

  return (
    <div className={espaco.pagina} data-etapa-sistema="">
      <CabecalhoDaEtapa
        etapa="sistema"
        ajuda="Logo pelo código: a logo final é o arquivo real da equipe (SVG de preferência; PNG serve). A imagem de IA do conceito é só inspiração. Vetorizar PNG dentro do painel ainda não existe (sem biblioteca leve): faça o vetor no editor e envie o SVG."
      />

      <Secao titulo="Logotipos" descricao={logos.principal ? "Principal enviada" : "Falta a principal"} recolher={`mesa-identidade:${projeto.id}:sistema:logos`}>
        <div className={juntar("grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4")}>
          {SLOTS_DE_LOGO.map((s) => {
            const itens = s.valor === "alternativas" ? logos.alternativas : s.valor === "icone" ? logos.icone : logos[s.valor] ? [logos[s.valor] as LogoDoBrandbook] : [];
            return (
              <div key={s.valor} className="min-w-0" data-slot-de-logo={s.valor}>
                <div className="mb-2 flex min-w-0 items-center">
                  <h3 className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>{s.rotulo}</h3>
                  <EnviarArquivo rotulo={`Enviar ${s.rotulo.toLowerCase()}`} aceitar=".svg,.png,.jpg,.jpeg,.webp" ocupado={ocupado === `logo-${s.valor}`} desativado={!s.varios && itens.length > 0} onArquivo={(f) => void enviar(s.valor, f)} />
                </div>
                {itens.length === 0 && <div className={juntar(texto.auxiliar, "flex h-24 items-center justify-center rounded-md border border-dashed border-border")}>Sem arquivo</div>}
                {itens.map((l, i) => (
                  <div key={l.caminho} className="mb-2 min-w-0">
                    <div className="grid grid-cols-2 gap-2">
                      <ImagemInteira caminho={l.previa_png || l.caminho} alt={`${s.rotulo} sobre claro`} className="h-24 border border-border p-2" fundo="#F4F6F4" />
                      <ImagemInteira caminho={l.previa_png || l.caminho} alt={`${s.rotulo} sobre escuro`} className="h-24 p-2" fundo="#151B17" />
                    </div>
                    <div className="mt-1 flex min-w-0 items-center">
                      <Pastilha tom={/svg/i.test(l.mime) ? "bom" : "neutro"}>{/svg/i.test(l.mime) ? "SVG" : "PNG"}</Pastilha>
                      <span className={juntar(texto.etiqueta, "ml-1.5 min-w-0 flex-1 truncate text-muted-foreground")}>{l.rotulo}</span>
                      <button type="button" className={botao.icone} aria-label={`Tirar ${s.rotulo.toLowerCase()}`} onClick={() => void tirar(s.valor, i)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Secao>

      <Secao
        titulo="Paleta"
        divisoria
        descricao={`${cores.length} cores`}
        recolher={`mesa-identidade:${projeto.id}:sistema:paleta`}
        ajuda={`HEX é o que a equipe define. RGB e CMYK saem por código; o CMYK usa o perfil ${perfil.nome} (limite de tinta ${perfil.limiteDeTinta}%). Para impressão, confirme a prova com a gráfica.`}
        acao={
          <>
            <button type="button" className={juntar(botao.discreto, "m-1 h-8")} onClick={() => void tirarPaleta()} disabled={ocupado === "paleta-logo"}>
              {ocupado === "paleta-logo" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Pipette className="mr-1.5 h-3.5 w-3.5" />} Da logo
            </button>
            {caminho && caminho.paleta && caminho.paleta.length > 0 && (
              <button type="button" className={juntar(botao.discreto, "m-1 h-8")} onClick={() => setCores(caminho.paleta.map((p: any) => ({ nome: p.nome, papel: PAPEIS.indexOf(p.papel) >= 0 ? p.papel : "secundaria", hex: p.hex })))}>
                Do caminho
              </button>
            )}
            <button type="button" className={juntar(botao.secundario, "m-1 h-8")} disabled={ocupado === "paleta"} onClick={() => void salvar("paleta", { cores: cores.filter((c) => normalizarHex(c.hex)).map((c) => ({ ...c, hex: normalizarHex(c.hex) })) }, "Paleta salva")}>
              <Save className="mr-1.5 h-3.5 w-3.5" /> Salvar
            </button>
          </>
        }
      >
        {sugeridas.length > 0 && (
          <div className="-m-1 mb-3 flex min-w-0 flex-wrap items-center">
            <span className={juntar(texto.auxiliar, "m-1")}>Da logo:</span>
            {sugeridas.map((h) => (
              <button key={h} type="button" className={juntar(botao.discreto, "m-1 h-8")} onClick={() => {
                setCores(cores.concat([{ nome: h, papel: cores.length < 2 ? "primaria" : "secundaria", hex: h }]));
                setSugeridas(sugeridas.filter((x) => x !== h));
              }}>
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
                <input className={juntar(campo, "mr-2 w-40")} value={c.nome} maxLength={40} aria-label="Nome da cor" onChange={(e) => setCores(cores.map((x, k) => (k === i ? { ...x, nome: e.target.value } : x)))} />
                <select className={juntar(campo, "mr-2 w-36")} value={c.papel} aria-label="Papel da cor" onChange={(e) => setCores(cores.map((x, k) => (k === i ? { ...x, papel: e.target.value as PapelDaCor } : x)))}>
                  {PAPEIS.map((p) => (
                    <option key={p} value={p}>
                      {ROTULO_DO_PAPEL_DA_COR[p]}
                    </option>
                  ))}
                </select>
                <input className={juntar(campo, "mr-3 w-28 font-mono")} value={c.hex} maxLength={7} aria-label="HEX" onChange={(e) => setCores(cores.map((x, k) => (k === i ? { ...x, hex: e.target.value } : x)))} />
                <span className={juntar(texto.auxiliar, "min-w-0 flex-1 tabular-nums")}>{ficha ? `${textoRgb(ficha.rgb)}  ·  ${textoCmyk(ficha.cmyk)}` : "HEX inválido"}</span>
                <button type="button" className={botao.icone} aria-label={`Tirar a cor ${c.nome}`} onClick={() => setCores(cores.filter((_, k) => k !== i))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className={juntar(botao.discreto, "mt-2")} disabled={cores.length >= 8} onClick={() => setCores(cores.concat([{ nome: "", papel: cores.length ? "secundaria" : "primaria", hex: "#" }]))}>
          <Plus className="mr-1.5 h-4 w-4" /> Cor
        </button>
        <ContrasteDaPaleta cores={cores} />
        <GeradorDePaleta
          cores={cores}
          onUsar={(novas, origem) => void trocarComDesfazer("cores", novas, cores.filter((c) => normalizarHex(c.hex)).map((c) => ({ ...c, hex: normalizarHex(c.hex) })), `Paleta trocada (${origem})`, (v) => setCores(v as Cor[]))}
        />
      </Secao>

      <Secao
        titulo="Tipografia"
        divisoria
        descricao={tipos.length ? tipos.map((t) => t.familia).filter(Boolean).join(", ") : "Nenhuma família"}
        recolher={`mesa-identidade:${projeto.id}:sistema:tipografia`}
        ajuda="Família, uso e licença. O painel não adivinha a fonte de uma imagem: escreva o nome exato (de preferência do Google Fonts). Arquivos de fonte enviados em Contexto > Fontes entram no pacote da marca."
        acao={
          <>
            {caminho && caminho.tipografia && (
              <button type="button" className={juntar(botao.discreto, "m-1 h-8")} onClick={() => setTipos(([{ familia: String(caminho.tipografia.titulo || ""), uso: "titulo", pesos: "", licenca: "Google Fonts (OFL)", alternativa: "" }, { familia: String(caminho.tipografia.texto || ""), uso: "texto", pesos: "", licenca: "Google Fonts (OFL)", alternativa: "" }] as Tipo[]).filter((t) => t.familia))}>
                Do caminho
              </button>
            )}
            <button type="button" className={juntar(botao.secundario, "m-1 h-8")} disabled={ocupado === "tipos"} onClick={() => void salvar("tipos", { tipografia: tipos.filter((t) => t.familia.trim()).map((t) => ({ familia: t.familia.trim(), uso: t.uso, pesos: t.pesos.split(/[,;]+/).map((x) => x.trim()).filter(Boolean), licenca: t.licenca.trim(), alternativa: t.alternativa.trim() })) }, "Tipografia salva")}>
              <Save className="mr-1.5 h-3.5 w-3.5" /> Salvar
            </button>
          </>
        }
      >
        {tipos.map((t, i) => (
          <div key={i} className="mb-3 grid min-w-0 grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,1fr)_120px_140px_minmax(0,1fr)_auto]">
            <CampoDeFormulario rotulo="Família">
              <input className={campo} value={t.familia} maxLength={60} onChange={(e) => setTipos(tipos.map((x, k) => (k === i ? { ...x, familia: e.target.value } : x)))} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Uso">
              <select className={campo} value={t.uso} onChange={(e) => setTipos(tipos.map((x, k) => (k === i ? { ...x, uso: e.target.value as Tipo["uso"] } : x)))}>
                <option value="titulo">Títulos</option>
                <option value="texto">Texto</option>
                <option value="apoio">Apoio</option>
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Pesos">
              <input className={campo} value={t.pesos} maxLength={60} placeholder="400, 700" onChange={(e) => setTipos(tipos.map((x, k) => (k === i ? { ...x, pesos: e.target.value } : x)))} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Licença">
              <input className={campo} value={t.licenca} maxLength={120} placeholder="Google Fonts (OFL)" onChange={(e) => setTipos(tipos.map((x, k) => (k === i ? { ...x, licenca: e.target.value } : x)))} />
            </CampoDeFormulario>
            <button type="button" className={botao.icone} aria-label="Tirar a família" onClick={() => setTipos(tipos.filter((_, k) => k !== i))}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button type="button" className={botao.discreto} disabled={tipos.length >= 4} onClick={() => setTipos(tipos.concat([{ familia: "", uso: tipos.length ? "texto" : "titulo", pesos: "", licenca: "", alternativa: "" }]))}>
          <Plus className="mr-1.5 h-4 w-4" /> Família
        </button>
        <TipografiaDaMarca
          tipos={tipos}
          onUsar={(novos, origem) =>
            void trocarComDesfazer("tipografia", tiposParaSalvar(novos), tiposParaSalvar(tipos), `Tipografia trocada (${origem})`, (v) =>
              setTipos((v as Array<Record<string, any>>).map((t) => ({ familia: t.familia || "", uso: t.uso || "texto", pesos: Array.isArray(t.pesos) ? t.pesos.join(", ") : "", licenca: t.licenca || "", alternativa: t.alternativa || "" }))),
            )
          }
        />
      </Secao>

      <Secao
        titulo="Grafismos e ativos"
        divisoria
        descricao={`${grafismos.length} ativos`}
        recolher={`mesa-identidade:${projeto.id}:sistema:grafismos`}
        acao={
          <>
            <EnviarArquivo rotulo="Enviar ativo" aceitar=".png,.jpg,.jpeg,.webp" ocupado={ocupado === "grafismo"} onArquivo={(f) => void (async () => {
              setOcupado("grafismo");
              try {
                const caminhoDoAtivo = await enviarImagemDeApoio(mesa.clientId, projeto.id, f, "grafismos");
                const novos = grafismos.concat([{ tipo: "pattern", descricao: "", imagem: caminhoDoAtivo }]).slice(0, 6);
                setGrafismos(novos);
                await salvarParte("sistema", { grafismos: novos });
              } catch (e) {
                avisarErro(e, "O ativo não foi enviado");
              } finally {
                setOcupado(null);
              }
            })()} />
            <button type="button" className={juntar(botao.secundario, "m-1 h-8")} disabled={ocupado === "graf"} onClick={() => void salvar("graf", { grafismos }, "Ativos salvos")}>
              <Save className="mr-1.5 h-3.5 w-3.5" /> Salvar
            </button>
          </>
        }
      >
        <div className={juntar(espaco.grade, "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3")}>
          {grafismos.map((g, i) => (
            <div key={i} className="min-w-0">
              <ImagemInteira caminho={g.imagem} alt={g.descricao || "Ativo da marca"} className="h-32 bg-muted" />
              <div className="mt-2 grid min-w-0 grid-cols-[120px_minmax(0,1fr)_auto] items-center gap-2">
                <select className={campo} value={g.tipo} aria-label="Tipo do ativo" onChange={(e) => setGrafismos(grafismos.map((x, k) => (k === i ? { ...x, tipo: e.target.value } : x)))}>
                  {TIPOS_DE_GRAFISMO.map((t) => (
                    <option key={t.valor} value={t.valor}>
                      {t.rotulo}
                    </option>
                  ))}
                </select>
                <input className={campo} value={g.descricao} maxLength={300} placeholder="Como usar" aria-label="Descrição do ativo" onChange={(e) => setGrafismos(grafismos.map((x, k) => (k === i ? { ...x, descricao: e.target.value } : x)))} />
                <button type="button" className={botao.icone} aria-label="Tirar o ativo" onClick={() => setGrafismos(grafismos.filter((_, k) => k !== i))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
        {!grafismos.length && <p className={texto.auxiliar}>Pattern, estilo de foto, ilustração e ícones da marca.</p>}
        <GrafismosGerados
          cores={cores.map((c) => c.hex)}
          familia={(tipos.filter((t) => t.uso === "titulo")[0] || tipos[0] || { familia: "Helvetica" }).familia}
          nome={String(nomeDaMarca || "")}
          onGuardar={async (g) => {
            const novos = grafismos.concat([g]).slice(-6);
            setGrafismos(novos);
            await salvarParte("sistema", { grafismos: novos });
            toast.success("Padrão guardado nos ativos");
          }}
        />
      </Secao>

      <Secao
        titulo="Regras de uso e conceito do logo"
        divisoria
        recolher={`mesa-identidade:${projeto.id}:sistema:regras`}
        acao={
          <>
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
              const r2 = { ...regras, significado_do_logo: v.significado_do_logo != null ? String(v.significado_do_logo) : regras.significado_do_logo };
              const f2 = { ...foto, coloracao: v["fotografia.coloracao"] != null ? String(v["fotografia.coloracao"]) : foto.coloracao, evitar: v["fotografia.evitar"] != null ? String(v["fotografia.evitar"]) : foto.evitar, ia: v["fotografia.ia"] != null ? String(v["fotografia.ia"]) : foto.ia };
              setRegras(r2);
              setFoto(f2);
              await salvarParte("sistema", { significado_do_logo: r2.significado_do_logo.slice(0, 1500), fotografia: f2 });
            }}
            onDesfazer={async (a) => {
              const r2 = { ...regras, significado_do_logo: String(a.significado_do_logo || "") };
              const f2 = { ...foto, coloracao: String(a["fotografia.coloracao"] || ""), evitar: String(a["fotografia.evitar"] || ""), ia: String(a["fotografia.ia"] || "") };
              setRegras(r2);
              setFoto(f2);
              await salvarParte("sistema", { significado_do_logo: r2.significado_do_logo, fotografia: f2 });
            }}
          />
          <button type="button" className={juntar(botao.secundario, "m-1 h-8")} disabled={ocupado === "regras"} onClick={() => void salvar("regras", {
            significado_do_logo: regras.significado_do_logo.trim().slice(0, 1500),
            regras: {
              protecao_fator: Math.max(5, Math.min(100, Number(regras.protecao) || 25)) / 100,
              reducao_minima_px: Math.max(16, Number(regras.px) || 120),
              reducao_minima_mm: Math.max(5, Number(regras.mm) || 25),
              usos_incorretos: regras.incorretos.split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 8),
            },
            fotografia: foto,
          }, "Regras salvas")}>
            <Save className="mr-1.5 h-3.5 w-3.5" /> Salvar
          </button>
          </>
        }
      >
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          <CampoDeFormulario rotulo="Significado do logo" largo>
            <textarea className={juntar(campoTexto, "min-h-[72px]")} value={regras.significado_do_logo} maxLength={1500} onChange={(e) => setRegras({ ...regras, significado_do_logo: e.target.value })} />
          </CampoDeFormulario>
          <div className="grid min-w-0 grid-cols-3 gap-3">
            <CampoDeFormulario rotulo="Proteção (%)">
              <input className={campo} inputMode="numeric" value={regras.protecao} onChange={(e) => setRegras({ ...regras, protecao: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) })} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Mínimo (px)">
              <input className={campo} inputMode="numeric" value={regras.px} onChange={(e) => setRegras({ ...regras, px: e.target.value.replace(/[^0-9]/g, "").slice(0, 4) })} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Mínimo (mm)">
              <input className={campo} inputMode="numeric" value={regras.mm} onChange={(e) => setRegras({ ...regras, mm: e.target.value.replace(/[^0-9]/g, "").slice(0, 3) })} />
            </CampoDeFormulario>
          </div>
          <CampoDeFormulario rotulo="Usos incorretos" apoio="Um por linha">
            <textarea className={juntar(campoTexto, "min-h-[120px]")} value={regras.incorretos} maxLength={1200} onChange={(e) => setRegras({ ...regras, incorretos: e.target.value })} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Fotografia: coloração e composição">
            <textarea className={juntar(campoTexto, "min-h-[120px]")} value={foto.coloracao} maxLength={600} onChange={(e) => setFoto({ ...foto, coloracao: e.target.value })} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Fotografia: o que evitar">
            <input className={campo} value={foto.evitar} maxLength={600} onChange={(e) => setFoto({ ...foto, evitar: e.target.value })} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Imagem gerada por IA">
            <input className={campo} value={foto.ia} maxLength={600} placeholder="Só como apoio, nunca no lugar do produto real" onChange={(e) => setFoto({ ...foto, ia: e.target.value })} />
          </CampoDeFormulario>
        </div>
      </Secao>
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
