const TIPOS: Record<string, string[]> = {
  pdf: ["application/pdf"],
  mp4: ["video/mp4"],
  webm: ["video/webm"],
  mp3: ["audio/mpeg"],
  m4a: ["audio/mp4"],
  ogg: ["audio/ogg"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  txt: ["text/plain"],
  zip: ["application/zip", "application/x-zip-compressed"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
};
const BLOQUEADO =
  /(?:\.(?:exe|dll|com|scr|msi|bat|cmd|ps1|sh|js|mjs|cjs|html?|svg|php|py|jar|vbs|lnk|url|wasm)$|vbaProject\.bin$|(?:^|\/)\.\.(?:\/|$))/i;
export async function validarMaterial(arquivo: File): Promise<string> {
  const ext = arquivo.name.split(".").pop()?.toLowerCase() || "";
  const mimes = TIPOS[ext];
  if (
    !mimes ||
    !mimes.includes(arquivo.type) ||
    BLOQUEADO.test(arquivo.name) ||
    arquivo.size <= 0 ||
    arquivo.size > 524288000
  )
    throw Error(
      "Escolha PDF, vídeo, áudio, imagem, documento ou ZIP de até 500 MB. Arquivos executáveis não são aceitos.",
    );
  if (ext === "pdf") {
    const inicio = new TextDecoder().decode(
      await arquivo.slice(0, 8).arrayBuffer(),
    );
    if (!inicio.startsWith("%PDF-"))
      throw Error("O arquivo escolhido não é um PDF válido.");
  }
  if (["zip", "docx", "xlsx", "pptx"].includes(ext)) {
    // Lê apenas o diretório do ZIP, sem descompactar ou executar conteúdo.
    const fim = new Uint8Array(
      await arquivo.slice(Math.max(0, arquivo.size - 65557)).arrayBuffer(),
    );
    const view = new DataView(fim.buffer);
    let eocd = -1;
    for (let i = fim.length - 22; i >= 0; i--)
      if (view.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw Error("Arquivo compactado inválido.");
    const quantidade = view.getUint16(eocd + 10, true),
      tamanho = view.getUint32(eocd + 12, true),
      inicio = view.getUint32(eocd + 16, true);
    if (
      quantidade > 5000 ||
      tamanho > 4 * 1024 * 1024 ||
      inicio + tamanho > arquivo.size
    )
      throw Error(
        "Este pacote é muito grande para conferir. Divida os materiais.",
      );
    const central = new Uint8Array(
      await arquivo.slice(inicio, inicio + tamanho).arrayBuffer(),
    );
    const d = new DataView(central.buffer);
    let offset = 0;
    let total = 0;
    for (let i = 0; i < quantidade; i++) {
      if (
        offset + 46 > central.length ||
        d.getUint32(offset, true) !== 0x02014b50
      )
        throw Error("Diretório do pacote inválido.");
      const nomeTam = d.getUint16(offset + 28, true),
        extra = d.getUint16(offset + 30, true),
        comentario = d.getUint16(offset + 32, true);
      const nome = new TextDecoder()
        .decode(central.subarray(offset + 46, offset + 46 + nomeTam))
        .replace(/\\/g, "/");
      total += d.getUint32(offset + 24, true);
      if (
        BLOQUEADO.test(nome) ||
        nome.startsWith("/") ||
        /^[A-Z]:/i.test(nome) ||
        /\.(zip|rar|7z|tar|gz)$/i.test(nome) ||
        total > 1073741824 ||
        d.getUint16(offset + 8, true) & 1
      )
        throw Error(
          "O pacote contém arquivo executável, caminho inválido, outro pacote ou conteúdo que não pode ser conferido.",
        );
      offset += 46 + nomeTam + extra + comentario;
      if (offset > central.length) throw Error("Diretório do pacote inválido.");
    }
  }
  return mimes[0];
}
