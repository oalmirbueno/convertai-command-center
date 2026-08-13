/**
 * Compatibilidade: estas constantes eram a lista de pastas da tela da equipe,
 * e existiam OUTRAS duas listas diferentes no sistema (a do cliente, com só 4
 * pastas, e a da integração, com 6). Agora todas nascem da mesma fonte:
 * src/lib/fileTaxonomy.ts. Mantidas com o formato antigo para não quebrar quem
 * já importava daqui.
 */
import { FILE_FOLDER_DEFINITIONS, FILE_KINDS } from "./fileTaxonomy";

export const FILE_FOLDERS = FILE_FOLDER_DEFINITIONS.map((folder) => ({
  id: folder.id,
  label: folder.label,
}));

export const FILE_TYPES = Object.values(FILE_KINDS).map((kind) => kind.id);

export { FILE_FOLDER_DEFINITIONS, FILE_KINDS };
