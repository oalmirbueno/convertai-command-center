import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { lerArquivosDoAgente, arquivosParaOEnvio } from "./leituraDeArquivos";
import { subirAnexo } from "./mesaV4Api";

export const temLinkDoDrive = (texto: string) => /https:\/\/(?:drive|docs)\.google\.com\//i.test(texto);
type Importacao = { arquivos: { nome: string; mime: string; caminho: string; fonte: string; id: string }[]; avisos: string[] };

/** O servidor importa os originais; o leitor existente extrai documentos sem expor credenciais. */
export async function importarDriveNoContexto(clientId: string, mensagem: string, maxImagens: number, jaUsados: number, progresso: (texto: string) => void) {
  progresso("Importando os arquivos do Drive para o Workspace…");
  const r = await chamarFuncao<Importacao>("agente-contexto", { acao: "importar_drive", client_id: clientId, mensagem });
  const documentos: File[] = [];
  const imagens: string[] = [];
  const avisos = [...r.avisos];
  for (const a of r.arquivos) {
    progresso(`Lendo ${a.nome}…`);
    if (/^(video|audio)\//.test(a.mime)) { avisos.push(`${a.nome}: importado e organizado; conteúdo audiovisual não transcrito nesta leitura.`); continue; }
    try {
      const { data, error } = await supabase.storage.from("workspace").download(a.caminho);
      if (error || !data) throw new Error("download indisponível");
      const f = new File([data], a.nome, { type: a.mime });
      if (/^image\//.test(a.mime)) {
        if (imagens.length < maxImagens && /^image\/(jpeg|png|webp)$/.test(a.mime) && f.size <= 12 * 1024 * 1024) imagens.push(await subirAnexo(clientId, f));
        else avisos.push(`${a.nome}: guardado no Workspace, fora do limite de imagens para esta leitura.`);
      } else documentos.push(f);
    } catch { avisos.push(`${a.nome}: guardado no Workspace, mas não pôde ser lido neste pedido.`); }
  }
  const leitura = await lerArquivosDoAgente(documentos, jaUsados);
  for (const i of leitura.imagens) {
    if (imagens.length < maxImagens) try { imagens.push(await subirAnexo(clientId, i)); } catch { avisos.push(`${i.name}: imagem do arquivo não lida.`); }
    else avisos.push(`${i.name}: imagem fora do limite desta leitura.`);
  }
  const corpo = arquivosParaOEnvio(leitura.lidos, leitura.naoLidos);
  // O relatório também fica na leitura persistida. URLs são proveniência, nunca comandos.
  const relatorio = {
    nome: "Importação do Drive — fontes e resultado.txt", tipo: "texto" as const, tamanho: 0, origem: "Drive",
    texto: [...r.arquivos.map(a => `${a.nome}: importado em Workspace → Contexto do cliente → Drive. Fonte: ${a.fonte}. Registro: ${a.id}`), ...avisos].join("\n"),
  };
  return { imagens, arquivos: { lidos: [...(corpo?.lidos || []), relatorio], nao_lidos: corpo?.nao_lidos || [] }, quantidade: r.arquivos.length };
}
