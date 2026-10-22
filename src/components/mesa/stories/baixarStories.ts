import { supabase } from "@/integrations/supabase/client";
import { novoIdDaProposta } from "../mesaV4Api";
import { baixarDoStorage, salvarBlob } from "../instagram/capaDoDestaque";
import { noFuso } from "../instagram/calendario-da-grade";
import { arteRegistrada, corDoFundo, montarArteDoStory } from "./arteDoStory";
import { hexValido } from "./layoutDoStory";
import type { MarcaDosStories } from "./marcaDosStories";
import { montarStoryFinal, nomeDoPngDoStory, textoNativoDoStory } from "./textoNativo";
import { chamarStories, imagemDoStory, normalizarStory, type LaminasDoTrabalho, type Story } from "./storiesApi";

/**
 * Baixar ali mesmo (22/10/2026, dono: "opção de baixar ali mesmo pra
 * postar"): o PNG final 1080 x 1920 de cada tela, com o texto e o adesivo
 * desenhado no estilo do app, e "Baixar todas" num ZIP (jszip, que o projeto
 * já usa nas capas; sem ele, uma por uma). O nome traz a ordem e o horário.
 *
 * E a arte que vai para a Agenda no estilo Natural: a foto do momento com o
 * texto nativo (sem o adesivo, que a equipe põe pelo app), registrada como o
 * arquivo do story.
 */

const horaDe = (s: Pick<Story, "horario">) => (s.horario ? noFuso(s.horario).hora : null);

/** O PNG final de uma tela. `comAdesivo`: o adesivo desenhado (para baixar); sem ele, a arte da Agenda. */
export async function pngDoStory(s: Story, marca: Pick<MarcaDosStories, "paleta" | "familia">, o: { laminas?: Record<string, LaminasDoTrabalho>; comAdesivo: boolean }): Promise<Blob> {
  const cor = hexValido(marca.paleta[0]) || "#6b2bd9";
  const adesivo = o.comAdesivo ? s.adesivo : null;
  if (s.fundo.tipo === "natural") {
    if (!s.fundo.caminho) throw new Error("A foto deste story ainda não foi gerada.");
    const foto = await baixarDoStorage("mesa", s.fundo.caminho);
    return montarStoryFinal({ imagem: foto, corDeFundo: "#000000", texto: textoNativoDoStory(s), adesivo, corDoAdesivo: cor });
  }
  if (s.fundo.tipo === "gerada") {
    // Destaque: o texto já está na arte; aqui entra só o adesivo.
    const viva = imagemDoStory(s, o.laminas);
    let base: Blob | null = viva ? await baixarDoStorage("mesa", viva.caminho) : null;
    if (!base && s.file_id) base = await arteRegistrada(s.file_id).catch(() => null);
    if (!base) throw new Error("A imagem deste story ainda não foi gerada.");
    return montarStoryFinal({ imagem: base, corDeFundo: "#000000", texto: null, adesivo, corDoAdesivo: cor });
  }
  if (s.file_id) {
    const registrada = await arteRegistrada(s.file_id).catch(() => null);
    if (registrada) return montarStoryFinal({ imagem: registrada, corDeFundo: "#000000", texto: null, adesivo, corDoAdesivo: cor });
  }
  if (s.fundo.tipo === "cor") {
    // Só a cor da marca: texto puro (nenhuma imagem colada).
    const arte = await montarArteDoStory(s, { paleta: marca.paleta, familia: marca.familia }, null);
    return montarStoryFinal({ imagem: arte, corDeFundo: corDoFundo(s, marca.paleta), texto: null, adesivo, corDoAdesivo: cor });
  }
  throw new Error("Este story ainda não tem imagem. Gere pelo gerador.");
}

/** Baixa o PNG final de uma tela (texto e adesivo). */
export async function baixarStory(s: Story, marca: Pick<MarcaDosStories, "paleta" | "familia">, laminas?: Record<string, LaminasDoTrabalho>): Promise<void> {
  salvarBlob(await pngDoStory(s, marca, { laminas, comAdesivo: true }), nomeDoPngDoStory(s, horaDe(s)));
}

/** "Baixar todas": um ZIP com as telas prontas, na ordem; sem o jszip, uma por uma. Devolve quantas e as que ficaram de fora. */
export async function baixarTodosOsStories(
  stories: Story[],
  marca: Pick<MarcaDosStories, "paleta" | "familia">,
  o: { laminas?: Record<string, LaminasDoTrabalho>; nome: string },
): Promise<{ baixadas: number; deFora: number[] }> {
  const arquivos: Array<{ nome: string; blob: Blob }> = [];
  const deFora: number[] = [];
  for (const s of stories.slice().sort((a, b) => a.ordem - b.ordem)) {
    try {
      arquivos.push({ nome: nomeDoPngDoStory(s, horaDe(s)), blob: await pngDoStory(s, marca, { laminas: o.laminas, comAdesivo: true }) });
    } catch {
      deFora.push(s.ordem);
    }
  }
  if (!arquivos.length) return { baixadas: 0, deFora };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let JSZip: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modulo: any = await import("jszip");
    JSZip = modulo.default || modulo;
  } catch {
    JSZip = null;
  }
  if (JSZip) {
    const zip = new JSZip();
    arquivos.forEach((a) => zip.file(a.nome, a.blob));
    const blob = await zip.generateAsync({ type: "blob" });
    const base = (o.nome || "stories").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    salvarBlob(blob, `stories-${base || "sequencia"}.zip`);
  } else {
    arquivos.forEach((a) => salvarBlob(a.blob, a.nome));
  }
  return { baixadas: arquivos.length, deFora };
}

/**
 * A arte do story Natural que vai para a Agenda: a foto com o texto nativo
 * (sem o adesivo: a equipe põe pelo app), no bucket mesa em
 * <cliente>/stories/<story>/, registrada como o arquivo do story.
 */
export async function registrarStoryNatural(clientId: string, s: Story, marca: Pick<MarcaDosStories, "paleta" | "familia">): Promise<Story> {
  const png = await pngDoStory(s, marca, { comAdesivo: false });
  const caminho = `${clientId}/stories/${s.id}/${novoIdDaProposta()}.png`;
  const envio = await supabase.storage.from("mesa").upload(caminho, png, { contentType: "image/png", upsert: false });
  if (envio.error) throw envio.error;
  const r = await chamarStories<{ story: unknown }>("registrar_arte", clientId, { id: s.id, caminho });
  if (!r || !r.story) throw new Error("A função não confirmou a arte.");
  return normalizarStory(r.story);
}

/** Hora de registrar a arte Natural: a foto existe, o story não tem arquivo e está fora da agenda. */
export const precisaRegistrarNatural = (s: Story) =>
  s.fundo.tipo === "natural" && !!s.fundo.caminho && !s.file_id && !s.publicacao_id && s.situacao !== "agendado" && s.situacao !== "publicado" && s.situacao !== "postar_pelo_app";
