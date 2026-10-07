import { destinoDaEvidencia } from "./execucaoApresentacao";

const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
export type AnexoDoCaderno = { name?: string; url?: string };

/** Projeção legível do histórico; o registro original permanece intacto. */
export function prepararEntrada(body: string, attachments: AnexoDoCaderno[] = []) {
  const anexos = new Map<string, AnexoDoCaderno>();
  for (const a of attachments) if (a.url && destinoDaEvidencia(a.url)) anexos.set(a.url, a);
  let texto = body.replace(new RegExp(`(?:aceleriq-file:\\/\\/|\\bfile_id\\s*[:=]\\s*[\x60"']?)(${UUID})`, "gi"), (_match, id: string) => {
    const url = `aceleriq-file://${id}`;
    if (!anexos.has(url)) anexos.set(url, { name: "Arquivo da execução", url });
    return "arquivo anexado";
  });
  texto = texto.replace(/\b(?:sha256|hash)\s*[:=]\s*[a-f0-9]{32,64}\b/gi, "integridade registrada");
  texto = texto.replace(new RegExp(UUID, "gi"), "registro vinculado");
  return { texto, anexos: [...anexos.values()], temDetalhes: texto !== body };
}

export function tituloDoCaderno(title?: string | null) {
  return (title || "Atualização do trabalho").replace(new RegExp(UUID, "gi"), "registro vinculado");
}

export function incluirConcluidas(visao: string, mostrarEncerradas: boolean) {
  return mostrarEncerradas || visao === "done";
}
