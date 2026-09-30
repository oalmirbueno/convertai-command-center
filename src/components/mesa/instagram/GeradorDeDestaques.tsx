import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Bot, Download, ImagePlus, Loader2, Plus, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { ErroDaMesa, padraoPara, textoDoErro, usd, type Qualidade } from "@/lib/mesa/api";
import { BotaoComCusto, useAvisarErro } from "../Custo";
import { SeletorDeModelo, SeletorDeQualidade } from "../Seletores";
import { ImagemDaMesa, useMesa } from "../MesaContexto";
import {
  caracteres,
  DESTAQUES_TIPICOS,
  destaquesLimpos,
  LIMITES_DO_PERFIL,
  type CorDaPaleta,
  type DestaqueProposto,
  type EstiloDaCapa,
} from "../../../../supabase/functions/mesa-instagram/modulos/conhecimento-perfil-instagram";
import { chamarInstagram, type CapaGuardada } from "./instagramApi";
import { baixarDoStorage, baixarZipDasCapas, capaComFoto, capaComIcone, capaComLogo, capaTipografica, nomeDoArquivo, salvarBlob } from "./capaDoDestaque";
import { useFonteDaMarca } from "./fonteDaMarca";
import NavegadorDePastas, { type ImagemEscolhida } from "../NavegadorDePastas";
import { supabase } from "@/integrations/supabase/client";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";

/**
 * Gerador de destaques. A lista (nome e ícone) vem da equipe, das sugestões
 * típicas ou do agente da aba. Um clique gera todas as que faltam, uma por
 * vez, com andamento e Parar; o preço aparece antes no botão. Cores só do kit
 * do cliente (a função recusa cor de fora), nada de texto nem logo inventada
 * na capa: o nome aparece embaixo, como no Instagram. Modo "Logo da marca":
 * a logo do kit no centro, montada no navegador, sem custo.
 * A API do Instagram não lê nem cria destaques: as capas saem prontas para
 * baixar (PNG 1080 x 1920) e subir pelo app.
 */

/**
 * Estilos de conjunto (rodada 3, 28/09: o dono escolhe antes de gerar tudo),
 * todos com a trava da marca: cores do kit, fonte do cliente, logo do cliente.
 * - icone: ícone de linha na cor da marca, com o objeto do negócio (IA, custo antes);
 * - foto: foto real do acervo, recortada no círculo (sem custo, foto intacta);
 * - tipografia: o nome na fonte da marca sobre a cor do kit (sem custo);
 * - logo: a logo do kit no centro (sem custo).
 */
type Modo = "icone" | "foto" | "tipografia" | "logo";
const MODOS: Modo[] = ["icone", "foto", "tipografia", "logo"];

const nomesIguais = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function Cores({ paleta, valor, onEscolher, rotulo }: { paleta: CorDaPaleta[]; valor: string; onEscolher: (hex: string) => void; rotulo: string }) {
  return (
    <div className="min-w-0">
      <p className={texto.rotulo}>{rotulo}</p>
      <div className="mt-1 flex min-w-0 flex-wrap" role="radiogroup" aria-label={rotulo}>
        {paleta.map((c) => (
          <button
            key={c.hex}
            type="button"
            role="radio"
            aria-checked={valor === c.hex}
            aria-label={`${c.nome || c.papel || c.hex} ${c.hex}`}
            title={`${c.nome || c.papel || ""} ${c.hex}`.trim()}
            onClick={() => onEscolher(c.hex)}
            className={juntar("mb-1 mr-1.5 h-7 w-7 rounded-full border border-border", valor === c.hex ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "")}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>
    </div>
  );
}

export default function GeradorDeDestaques({
  contaId,
  paleta,
  logo,
  capas,
  lista,
  onLista,
  onNovaCapa,
  onArquivada,
  onPedirAoAgente,
  nomeDoCliente,
  escopo,
}: {
  /** Cliente, marca e conta: cada perfil tem o seu estilo de capa. */
  escopo?: string;
  contaId: string | null;
  paleta: CorDaPaleta[];
  logo: { bucket: string; caminho: string } | null;
  capas: CapaGuardada[];
  lista: DestaqueProposto[];
  onLista: (l: DestaqueProposto[]) => void;
  onNovaCapa: (c: CapaGuardada) => void;
  onArquivada: (id: string) => void;
  onPedirAoAgente: () => void;
  nomeDoCliente: string;
}) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const avisarErro = useAvisarErro();
  const [modo, setModo] = useEstadoDaTela<Modo>(`mesa:instagram:capa-modo:${escopo || clientId}`, "icone", { validar: (v) => MODOS.indexOf(v as Modo) >= 0 });
  const [estilo, setEstilo] = useEstadoDaTela<EstiloDaCapa | null>(`mesa:instagram:capa-estilo:${escopo || clientId}`, null);
  const [modeloId, setModeloId] = useEstadoDaTela<string>(`mesa:instagram:capa-modelo:${clientId}`, "");
  const [qualidade, setQualidade] = useEstadoDaTela<Qualidade>(`mesa:instagram:capa-qualidade:${clientId}`, "baixa", { validar: (v) => v === "baixa" || v === "media" || v === "alta" });
  const [novo, setNovo] = useState("");
  const [andamento, setAndamento] = useState<{ feitos: number; total: number; atual: string } | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [fotoPara, setFotoPara] = useState<number | null>(null);
  const fonte = useFonteDaMarca(clientId);
  const [listaRecolhida, setListaRecolhida] = useRecolhido(`mesa:instagram:destaques-lista:${clientId}`, false);
  const [estiloRecolhido, setEstiloRecolhido] = useRecolhido(`mesa:instagram:destaques-estilo:${clientId}`, false);
  const parar = useRef(false);

  // Cores sempre do kit: a guardada que saiu do kit volta para a primeira e a segunda cor.
  const hexes = paleta.map((c) => c.hex);
  const fundo = estilo && hexes.indexOf(estilo.fundo) >= 0 ? estilo.fundo : hexes[0] || "";
  const desenho = estilo && hexes.indexOf(estilo.desenho) >= 0 ? estilo.desenho : hexes[1] || hexes[0] || "";
  const traco = estilo ? estilo.traco : "linha";
  const estiloAtual: EstiloDaCapa = { fundo, desenho, traco };
  const mudarEstilo = (m: Partial<EstiloDaCapa>) => setEstilo({ ...estiloAtual, ...m });

  const padraoImagem = useMemo(() => padraoPara(catalogo, "imagem"), [catalogo]);
  useEffect(() => {
    if (!modeloId && padraoImagem) setModeloId(padraoImagem.id);
  }, [padraoImagem, modeloId, setModeloId]);

  const pendentes = lista.filter((d) => !capas.some((c) => nomesIguais(c.nome, d.nome)));
  const semPaleta = paleta.length === 0;

  const mudarItem = (i: number, campoMudado: "nome" | "icone", valor: string) => {
    const l = lista.slice();
    l[i] = { ...l[i], [campoMudado]: campoMudado === "nome" ? Array.from(valor).slice(0, LIMITES_DO_PERFIL.destaqueNome).join("") : valor.slice(0, 80) };
    onLista(l);
  };
  const adicionar = (nome: string, icone?: string) => {
    const l = destaquesLimpos(lista.concat([{ nome, icone: icone || "" }]));
    onLista(l);
    setNovo("");
  };

  const gerarTodas = async () => {
    parar.current = false;
    let custo = 0;
    let feitas = 0;
    const alvo = pendentes.slice();
    for (let i = 0; i < alvo.length; i++) {
      if (parar.current) break;
      setAndamento({ feitos: i, total: alvo.length, atual: alvo[i].nome });
      try {
        const r = await chamarInstagram<{ destaque: CapaGuardada; custo_usd: number; aviso_sql?: string | null }>("gerar_capa", clientId, {
          ...(contaId ? { conta_id: contaId } : {}),
          nome: alvo[i].nome,
          icone: alvo[i].icone,
          ...(alvo[i].conceito ? { conceito: alvo[i].conceito } : {}),
          estilo: estiloAtual,
          modelo_id: modeloId || undefined,
          qualidade,
          ordem: lista.indexOf(alvo[i]),
        });
        custo += Number(r.custo_usd || 0);
        feitas++;
        onNovaCapa(r.destaque);
        atualizarCusto();
        if (r.aviso_sql && feitas === 1) toast.message(r.aviso_sql);
      } catch (e) {
        avisarErro(e, `Capa "${alvo[i].nome}" não saiu`);
        // Saldo, cota, chave ou modelo: as próximas também falhariam. Para aqui.
        if (e instanceof ErroDaMesa && (e.acao || e.codigo === "sem_paleta" || e.codigo === "cor_fora_do_kit")) break;
      }
    }
    setAndamento(null);
    return { custo_usd: custo, feitas };
  };

  const baixarUma = async (c: CapaGuardada) => {
    if (!c.caminho) return;
    setBaixando(c.id);
    try {
      const png = await capaComIcone(await baixarDoStorage("mesa", c.caminho), c.estilo && c.estilo.fundo ? c.estilo.fundo : fundo);
      salvarBlob(png, nomeDoArquivo(c.nome));
    } catch (e) {
      toast.error("Não deu para montar a capa", { description: textoDoErro(e) });
    } finally {
      setBaixando(null);
    }
  };

  const baixarTodas = async () => {
    setBaixando("todas");
    try {
      if (modo === "logo") {
        if (!logo) throw new Error("O cliente ainda não tem logo no kit.");
        const logoBlob = await baixarDoStorage(logo.bucket, logo.caminho);
        const capa = await capaComLogo(logoBlob, fundo);
        await baixarZipDasCapas(lista.map((d) => ({ nome: d.nome, blob: capa })), nomeDoCliente);
      } else if (modo === "foto") {
        const comFoto = lista.filter((d) => !!d.foto);
        if (!comFoto.length) throw new Error("Escolha a foto de cada destaque na lista.");
        const montadas: Array<{ nome: string; blob: Blob }> = [];
        for (const d of comFoto) montadas.push({ nome: d.nome, blob: await capaComFoto(await baixarDoStorage((d.foto as { bucket: string }).bucket, (d.foto as { caminho: string }).caminho)) });
        await baixarZipDasCapas(montadas, nomeDoCliente);
        if (comFoto.length < lista.length) toast.message(`${lista.length - comFoto.length} sem foto ficaram de fora.`);
      } else if (modo === "tipografia") {
        if (!fonte.familia) throw new Error(fonte.motivo || "A fonte da marca ainda não carregou.");
        const montadas: Array<{ nome: string; blob: Blob }> = [];
        for (const d of lista) montadas.push({ nome: d.nome, blob: await capaTipografica({ texto: d.nome, familia: fonte.familia, fundo, cor: desenho }) });
        await baixarZipDasCapas(montadas, nomeDoCliente);
      } else {
        const montadas: Array<{ nome: string; blob: Blob }> = [];
        for (const c of capas) {
          if (!c.caminho) continue;
          montadas.push({ nome: c.nome, blob: await capaComIcone(await baixarDoStorage("mesa", c.caminho), c.estilo && c.estilo.fundo ? c.estilo.fundo : fundo) });
        }
        if (!montadas.length) throw new Error("Nenhuma capa gerada ainda.");
        await baixarZipDasCapas(montadas, nomeDoCliente);
      }
    } catch (e) {
      toast.error("Não deu para baixar as capas", { description: textoDoErro(e) });
    } finally {
      setBaixando(null);
    }
  };

  const arquivar = async (c: CapaGuardada) => {
    try {
      await chamarInstagram("arquivar_capa", clientId, { destaque_id: c.id });
      onArquivada(c.id);
    } catch (e) {
      toast.error("Não deu para arquivar", { description: textoDoErro(e) });
    }
  };

  const escolherFoto = async (e: ImagemEscolhida) => {
    if (fotoPara === null) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      let onde: { bucket: string; caminho: string } | null = null;
      if (e.origem === "acervo") {
        const { data } = await db.from("cliente_imagens").select("client_id, storage_bucket, storage_path").eq("id", e.id).maybeSingle();
        if (data && data.client_id === clientId && data.storage_path) onde = { bucket: String(data.storage_bucket || "mesa"), caminho: String(data.storage_path) };
      } else if (e.origem === "workspace") {
        const { data } = await db.from("workspace_nodes").select("client_id, storage_path").eq("id", e.id).maybeSingle();
        if (data && data.client_id === clientId && data.storage_path) onde = { bucket: "workspace", caminho: String(data.storage_path) };
      } else {
        const { data } = await db.from("files").select("client_id, storage_bucket, storage_path").eq("id", e.id).maybeSingle();
        if (data && data.client_id === clientId && data.storage_bucket && data.storage_path) onde = { bucket: String(data.storage_bucket), caminho: String(data.storage_path) };
      }
      if (!onde) throw new Error("Não achei a foto escolhida.");
      const l = lista.slice();
      l[fotoPara] = { ...l[fotoPara], foto: onde };
      onLista(l);
      setFotoPara(null);
    } catch (err) {
      toast.error("Não deu para usar a foto", { description: textoDoErro(err) });
    }
  };

  return (
    <div className="min-w-0 space-y-3" data-gerador-de-destaques="">
      <NavegadorDePastas
        aberto={fotoPara !== null}
        onOpenChange={(v) => !v && setFotoPara(null)}
        titulo={fotoPara !== null && lista[fotoPara] ? `Foto do destaque ${lista[fotoPara].nome}` : "Foto do destaque"}
        descricao="Uma foto real do cliente. Ela entra inteira, só recortada para o círculo do destaque."
        onEscolher={(e) => void escolherFoto(e)}
      />
      <p className={juntar(texto.auxiliar, "flex items-center")}>
        Nome até {LIMITES_DO_PERFIL.destaqueVisivel} letras
        <AjudaRecolhida className="ml-1" rotulo="Como subir os destaques">
          A API do Instagram não lê nem cria destaques: gere as capas aqui, baixe e suba pelo app (Novo destaque, Editar capa). Nome até {LIMITES_DO_PERFIL.destaqueVisivel} letras para não cortar.
        </AjudaRecolhida>
      </p>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center justify-between">
          <TituloRecolhivel titulo={`Lista e nomes (${lista.length})`} recolhido={listaRecolhida} onAlternar={() => setListaRecolhida(!listaRecolhida)} resumo={lista.map((d) => d.nome).join(", ")} />
          <button type="button" className={juntar(botao.discreto, "h-8 shrink-0 px-2 text-[12px]")} onClick={onPedirAoAgente}>
            <Bot className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Pedir ao agente
          </button>
        </div>
        {!listaRecolhida && (
        <>
        {lista.length === 0 && <p className={juntar(texto.auxiliar, "mt-1")}>Nenhum destaque na lista. Comece pelas sugestões ou peça ao agente.</p>}
        <ul className="mt-1 min-w-0 space-y-1.5">
          {lista.map((d, i) => {
            const n = caracteres(d.nome);
            const feita = capas.some((c) => nomesIguais(c.nome, d.nome));
            return (
              <li key={i} className="flex min-w-0 items-center">
                <span className="mr-2 w-5 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">{i + 1}</span>
                <input className={juntar(campo, "h-8 w-[130px] shrink-0")} value={d.nome} onChange={(e) => mudarItem(i, "nome", e.target.value)} aria-label={`Nome do destaque ${i + 1}`} />
                <span className={juntar("ml-1 w-9 shrink-0 text-[11px] tabular-nums", n > LIMITES_DO_PERFIL.destaqueVisivel ? "text-warning" : "text-muted-foreground")} title={n > LIMITES_DO_PERFIL.destaqueVisivel ? "Passa de 10: o Instagram corta com reticências" : ""}>
                  {n}/{LIMITES_DO_PERFIL.destaqueVisivel}
                </span>
                <input className={juntar(campo, "ml-1 h-8 min-w-0 flex-1")} value={d.icone} onChange={(e) => mudarItem(i, "icone", e.target.value)} aria-label={`Ícone do destaque ${i + 1}`} placeholder="Objeto do negócio (ex.: armação de óculos)" title={d.conceito || undefined} />
                {modo === "foto" && (
                  <button type="button" className={juntar(botao.secundario, "ml-1 h-8 shrink-0 px-2 text-[11.5px]", d.foto ? "border-success/50" : "")} onClick={() => setFotoPara(i)} aria-label={`Escolher a foto de ${d.nome}`}>
                    <ImagePlus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    {d.foto ? "Trocar" : "Foto"}
                  </button>
                )}
                {feita && <span className={juntar(etiqueta, "ml-1.5 bg-success/15 text-success")}>capa</span>}
                <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => onLista(lista.filter((_, k) => k !== i))} aria-label={`Tirar ${d.nome}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex min-w-0 items-center">
          <input
            className={juntar(campo, "h-8 w-[160px]")}
            value={novo}
            maxLength={LIMITES_DO_PERFIL.destaqueNome}
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && novo.trim()) adicionar(novo);
            }}
            placeholder="Novo destaque"
            aria-label="Nome do novo destaque"
          />
          <button type="button" className={juntar(botao.secundario, "ml-1.5 h-8 px-2.5 text-[12px]")} onClick={() => novo.trim() && adicionar(novo)} disabled={!novo.trim() || lista.length >= LIMITES_DO_PERFIL.destaquesMaximo}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Pôr
          </button>
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap" aria-label="Sugestões típicas">
          {DESTAQUES_TIPICOS.filter((t) => !lista.some((d) => nomesIguais(d.nome, t.nome))).slice(0, 8).map((t) => (
            <button
              key={t.nome}
              type="button"
              onClick={() => adicionar(t.nome, t.icone)}
              disabled={lista.length >= LIMITES_DO_PERFIL.destaquesMaximo}
              title={t.para}
              className="mb-1 mr-1 rounded-full border border-border px-2.5 py-0.5 text-[11.5px] text-muted-foreground hover:border-primary/60 hover:text-foreground disabled:opacity-50"
            >
              + {t.nome}
            </button>
          ))}
        </div>
        </>
        )}
      </div>

      {!semPaleta && (
        <TituloRecolhivel
          titulo="Estilo e modelo"
          recolhido={estiloRecolhido}
          onAlternar={() => setEstiloRecolhido(!estiloRecolhido)}
          resumo={modo === "logo" ? "logo da marca" : modo === "foto" ? "foto real do acervo" : modo === "tipografia" ? `tipografia ${fonte.nome || "da marca"}` : `ícone ${traco === "cheio" ? "cheio" : "de linha"}, qualidade ${qualidade === "baixa" ? "rascunho" : qualidade}`}
        />
      )}
      {semPaleta ? (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-[12.5px] leading-5">
          O cliente ainda não tem cores no kit. As capas usam só as cores da marca (trava da marca).{" "}
          <Link to={`/mesa?client=${clientId}&aba=contexto`} className="font-medium text-primary hover:underline">
            Definir a paleta em Contexto
          </Link>
        </div>
      ) : estiloRecolhido ? null : (
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <SeletorCompacto
              rotulo="Estilo do conjunto"
              valor={modo}
              onEscolher={(v) => setModo(v as Modo)}
              listaQuandoNaoCabe
              opcoes={[
                { valor: "icone", rotulo: "Ícone da marca", descricao: "Objeto do negócio em linha, na cor da marca (IA)" },
                { valor: "foto", rotulo: "Foto real", descricao: "Foto do acervo recortada no círculo (sem custo)" },
                { valor: "tipografia", rotulo: "Tipografia", descricao: "O nome na fonte da marca (sem custo)", desativada: !!fonte.motivo },
                { valor: "logo", rotulo: "Logo", descricao: "A logo do kit no centro (sem custo)", desativada: !logo },
              ]}
            />
            <Cores paleta={paleta} valor={fundo} onEscolher={(hex) => mudarEstilo({ fundo: hex })} rotulo="Fundo (cor do kit)" />
            {(modo === "icone" || modo === "tipografia") && (
              <>
                <Cores paleta={paleta} valor={desenho} onEscolher={(hex) => mudarEstilo({ desenho: hex })} rotulo={modo === "tipografia" ? "Letra (cor do kit)" : "Desenho (cor do kit)"} />
                {modo === "icone" && <SeletorCompacto
                  rotulo="Traço"
                  valor={traco}
                  onEscolher={(v) => mudarEstilo({ traco: v === "cheio" ? "cheio" : "linha" })}
                  opcoes={[
                    { valor: "linha", rotulo: "Linha" },
                    { valor: "cheio", rotulo: "Cheio" },
                  ]}
                />}
              </>
            )}
          </div>
          {modo === "icone" ? (
            <div className="min-w-0 space-y-2">
              <SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={modeloId} onChange={setModeloId} rotulo="Modelo de imagem" qualidade={qualidade} />
              <SeletorDeQualidade valor={qualidade} onChange={setQualidade} />
            </div>
          ) : (
            <div className="min-w-0 rounded-md bg-muted/50 px-3 py-2 text-[13px] leading-5 text-muted-foreground">
              {modo === "logo" && "A logo do kit vai inteira no centro, sobre a cor escolhida. Montado no navegador, sem custo e sem redesenhar a logo."}
              {modo === "foto" && "Escolha uma foto do acervo em cada destaque. Ela entra inteira, só recortada para o círculo. Sem custo."}
              {modo === "tipografia" && (fonte.motivo || `O nome de cada destaque na fonte ${fonte.nome || "da marca"}, na cor escolhida, sobre o fundo do kit. Sem custo.`)}
            </div>
          )}
        </div>
      )}

      {!semPaleta && (
        <div className="flex min-w-0 flex-wrap items-center [&>*]:mb-1.5 [&>*]:mr-2">
          {modo === "icone" ? (
            <BotaoComCusto
              rotulo={pendentes.length ? `Gerar ${pendentes.length} ${pendentes.length === 1 ? "capa" : "capas"}` : "Todas já têm capa"}
              titulo="Capas de destaque"
              descricao="Gera uma capa por vez; dá para parar no meio."
              partes={() => [{ modeloId: modeloId || null, tipo: "imagem", imagens: pendentes.length, qualidade }]}
              executar={gerarTodas}
              fecharAoConfirmar
              aoConcluir={(d) => {
                if (d && d.feitas) toast.success(`${d.feitas} ${d.feitas === 1 ? "capa pronta" : "capas prontas"}`, { description: `Custo real: ${usd(d.custo_usd)}.` });
              }}
              disabled={!pendentes.length || !!andamento || !modeloId}
            />
          ) : (
            <button
              type="button"
              className={botao.primario}
              onClick={() => void baixarTodas()}
              disabled={!lista.length || !!baixando || (modo === "logo" && !logo) || (modo === "tipografia" && !fonte.familia) || (modo === "foto" && !lista.some((d) => !!d.foto))}
            >
              {baixando === "todas" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
              Baixar {modo === "foto" ? lista.filter((d) => !!d.foto).length : lista.length} capas ({modo === "logo" ? "logo" : modo === "foto" ? "foto" : "tipografia"})
            </button>
          )}
          {andamento && (
            <>
              <span className="text-[12.5px] text-muted-foreground" aria-live="polite">
                {andamento.feitos + 1} de {andamento.total}: {andamento.atual}
              </span>
              <button type="button" className={juntar(botao.secundario, "h-8 px-2.5 text-[12px]")} onClick={() => (parar.current = true)}>
                <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Parar
              </button>
            </>
          )}
          {modo === "icone" && capas.length > 0 && !andamento && (
            <button type="button" className={juntar(botao.secundario, "h-9")} onClick={() => void baixarTodas()} disabled={!!baixando}>
              {baixando === "todas" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
              Baixar todas (ZIP)
            </button>
          )}
        </div>
      )}

      {modo === "icone" && capas.length > 0 && (
        <ul className="flex min-w-0 flex-wrap" aria-label="Capas geradas">
          {capas.map((c) => (
            <li key={c.id} className="mb-2 mr-3 flex w-[84px] flex-col items-center" data-capa={c.nome}>
              <span className="block h-[72px] w-[72px] overflow-hidden rounded-full border border-border p-[2px]">
                <ImagemDaMesa caminho={c.caminho} alt={`Capa ${c.nome}`} className="h-full w-full rounded-full" />
              </span>
              <span className="mt-1 w-full truncate text-center text-[12px] leading-4 text-foreground" title={c.nome}>
                {c.nome}
              </span>
              <span className="mt-0.5 flex">
                <button type="button" className={botao.icone} onClick={() => void baixarUma(c)} disabled={!!baixando} aria-label={`Baixar a capa ${c.nome}`} title="Baixar (PNG 1080 x 1920)">
                  {baixando === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                </button>
                <button type="button" className={botao.icone} onClick={() => void arquivar(c)} aria-label={`Arquivar a capa ${c.nome}`} title="Arquivar">
                  <Archive className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
