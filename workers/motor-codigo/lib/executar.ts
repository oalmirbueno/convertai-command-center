/**
 * Um trabalho do motor do começo ao fim (construir, ajustar, desfazer,
 * revisar, publicar, zip). Tudo o que a tela vê sai daqui como evento
 * resumido (no máximo 1 por segundo) e como campos do trabalho (estado,
 * custo, prévia, commit, zip, resultado).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { criarLimitador, type EventoResumido, type ModeloDoMotor, TIPOS_QUE_GASTAM } from "../../../supabase/functions/_shared/motor-codigo.ts";
import { type PacoteDoSite, promptDaSecao, revisarHtml, rotuloDaSecao } from "../../../supabase/functions/_shared/site-metodo.ts";
// 20/10/2026: a Vercel da agência (prévia na nuvem por versão e publicação só da versão salva).
import { apiDoAmbiente, arquivosDoDist, erroDaVercelEmTexto, previaNaVercel, producaoNaVercel, SEM_CHAVE_NO_WORKER } from "./vercel.ts";
import { mesmoCommit } from "../../../supabase/functions/mesa-site/modulos/publicacao-nuvem.ts";
// UIM: a base de design (skill ui-ux-pro-max): design system gerado pelo motor e prova de consulta por seção.
import { type ConsultaDaSecao, consultaDaSecao, eventoDaConsulta, lerLogDaBase, lerProvaDeUx, resumoDaBaseNaEntrega, totalDaBase } from "./prova-da-base.ts";
import { ajustarPromptDaBase, prepararDesignSystem } from "./design-system.ts";
import { BUSCADOR_DA_UIUX } from "./config-opencode.ts";
import { buscar as buscarNaBase } from "../modelo-site/scripts/uiux.mjs";
import type { Fila, LinhaDaFila } from "./fila.ts";
import { abrirRascunho, arquivosMudados, atualizarCasca, commitar, commitAtual, type ConferenciaDaSecao, conferirSecaoDoProjeto, construirSite, descartarRascunho, escreverPacote, garantirProjeto, git, instalarSePrecisar, lerCasca, lerRegistroDoRascunho, MODELO_DO_SITE, pastaDoProjeto, RAMO_RASCUNHO, ramoAtual, reporCasca, salvarRascunho, voltarCommits } from "./projeto.ts";
// Gravyx (19/10/2026): fases à vista, rascunho x versão salva, tipos, conferência no navegador e texto no código sem IA.
import { type Fase, juntarProblemas, type ProblemaDaConferencia, promptDaCorrecao, TIPOS_DO_RASCUNHO, versaoDoRascunho } from "../../../supabase/functions/mesa-site/modulos/obra-do-site.ts";
import { conferirTipos, resumoDosTipos } from "./tipos.ts";
import { conferirNoNavegador, problemasDoPedido, resumoDaConferencia } from "./conferencia-no-navegador.ts";
import { aplicarTrocasNoProjeto, trocasDoPedido } from "./textos-no-codigo.ts";
// Gravyx (19/10): importar site existente e editor de código, os dois como "textos" (máquina, sem IA, no rascunho).
import { aplicarImportacao, importacaoDoPedido, type ImportacaoPronta, instalarImportado, prepararImportacao, projetoImportado } from "./importacao.ts";
import { conferirEdicaoNoProjeto, escreverEdicaoNoProjeto } from "./edicao-de-codigo.ts";
import type { EdicaoDeCodigo } from "../../../supabase/functions/mesa-site/modulos/editor-de-codigo.ts";

export { problemasDoPedido, trocasDoPedido };
import { garantirPrevia } from "./previa.ts";
import { rodarPassada, subirOpencode } from "./opencode.ts";
import { SKILLS_POR_TRABALHO, temChave, VERSAO_DO_SUPERPOWERS } from "./config-opencode.ts";
import { escolherRota, idsNoOpenrouter, provedorDoOpencode } from "./rota-do-modelo.ts";
import { eventosDasMarcas } from "./marcas-da-resposta.ts";

export { eventosDasMarcas, lerMarcasDaResposta, prontoSemProva } from "./marcas-da-resposta.ts";
import { abrirMedidor, type Medidor } from "./medidor.ts";
import { ziparProjeto } from "./zip.ts";
import { revisaoDeUx } from "./revisao-ux.ts";

/** A primeira linha útil do erro de build, sem as cores do terminal. */
export function resumoDoBuild(log: string): string {
  const limpo = String(log || "").replace(/\u001b\[[0-9;]*m/g, "");
  const linhas = limpo.split("\n").map((l) => l.trim());
  const linha = linhas.find((l) => /\[[A-Z_]+\]|is not exported|Cannot find|Error:/.test(l) && !/^at /.test(l) && !/^error during build/i.test(l) && !/^Build failed with/i.test(l));
  return (linha || "build falhou").replace(/[\u2500-\u257f]/g, "").slice(0, 200);
}

export type ConfigDoWorker = { pastaProjetos: string; prazoPorPassadaMs: number; comPrevia: boolean };


type Estado = { custo: number; tabela: number; tokensEntrada: number; tokensSaida: number; tokensCache: number };

export async function executarTrabalho(t: LinhaDaFila, fila: Fila, cfg: ConfigDoWorker): Promise<{ estado: string; custo: number }> {
  const limitador = criarLimitador();
  const soltar = async () => {
    const ev = limitador.soltar(Date.now());
    if (ev) await fila.evento(t, ev);
  };
  const relogio = setInterval(() => void soltar(), 1000);
  const avisar = async (ev: EventoResumido) => {
    limitador.adicionar(ev);
    await soltar();
  };
  const gasto: Estado = { custo: 0, tabela: 0, tokensEntrada: 0, tokensSaida: 0, tokensCache: 0 };
  let medidor: Medidor | null = null;
  const pedido = t.pedido || {};
  // A correção e as trocas de texto viajam no pacote do pedido; o pacote.json do site não as leva.
  // A prévia na nuvem pedida e a versão que o Publicar mostrou também viajam no pacote do pedido (fora do pacote.json).
  const { correcao: correcaoDoPedido, trocas: trocasBrutas, previa_nuvem: pediuPreviaNaNuvem, versao: versaoPedida, importacao: importacaoBruta, edicao_de_codigo: edicaoBruta, ...pacote } = (pedido.pacote || {}) as Record<string, unknown>;
  const pedidoDeImportacao = t.tipo === "textos" ? importacaoDoPedido(importacaoBruta) : null;
  const ehEdicaoDeCodigo = t.tipo === "textos" && !pedidoDeImportacao && !!edicaoBruta;
  const problemasDaCorrecao = t.tipo === "corrigir" ? problemasDoPedido(correcaoDoPedido) : [];
  let textosAplicados = false;
  /** A fase do trabalho vai direto (fora do limitador, para a marca não se perder na junção dos eventos). */
  const fase = async (f: Fase, resumo: string) => {
    const pendente = limitador.soltar(Date.now() + 1000);
    if (pendente) await fila.evento(t, pendente);
    await fila.evento(t, { tipo: "passo", resumo, dados: { fase: f } });
  };
  const rotulo = (secao: string) => (secao === "correcao" ? "a correção" : rotuloDaSecao(secao));
  let modelo = (pedido.modelo || null) as ModeloDoMotor | null;
  const pasta = pastaDoProjeto(cfg.pastaProjetos, t.projeto);
  const resultado: Record<string, unknown> = {};
  let estadoFinal = "feito";
  let erro: string | null = null;
  const deveParar = async () => (await fila.estado(t.id)) === "parando";
  let commitInicial: string | null = null;

  try {
    await avisar({ tipo: "estado", resumo: "O motor pegou o trabalho" });
    await fase("entendendo", "Entendendo o pedido");
    // Frente MTR: a chave do provedor é conferida ANTES de montar projeto, dependências e prévia.
    // Sem a chave direta e com a do OpenRouter, segue pelo mesmo modelo no OpenRouter (com aviso).
    if (modelo && TIPOS_QUE_GASTAM.indexOf(t.tipo as (typeof TIPOS_QUE_GASTAM)[number]) >= 0) {
      const precisaDeRota = !temChave(provedorDoOpencode(modelo));
      const alternativo = precisaDeRota && fila.modeloAlternativo ? await fila.modeloAlternativo(idsNoOpenrouter(modelo)) : null;
      const rota = escolherRota(modelo, temChave, alternativo);
      if (!rota.ok || !rota.modelo) throw new Error(rota.motivo || "sem rota para o modelo");
      if (rota.aviso) await avisar({ tipo: "aviso", resumo: rota.aviso });
      modelo = rota.modelo;
    }
    const novo = await garantirProjeto(pasta);
    if (novo) await avisar({ tipo: "passo", resumo: "Projeto criado do modelo da casa" });
    // Gravyx: importação e edição de código são conferidas ANTES do rascunho abrir (recusou = o projeto não muda).
    let importacaoPronta: ImportacaoPronta | null = null;
    let edicaoConferida: EdicaoDeCodigo | null = null;
    if (pedidoDeImportacao) {
      importacaoPronta = await prepararImportacao(fila, pedidoDeImportacao);
      const f = importacaoPronta.analise.framework;
      await avisar({ tipo: "passo", resumo: `Importação conferida: ${f ? f.rotulo : "site"}, ${importacaoPronta.analise.arquivos.length} arquivos, sem segredo` });
      for (const a of importacaoPronta.analise.avisos) await avisar({ tipo: "aviso", resumo: a });
    }
    if (ehEdicaoDeCodigo) {
      const casca = projetoImportado(pasta) ? [] : (lerCasca(MODELO_DO_SITE) || { arquivos: [] as string[] }).arquivos;
      const c = conferirEdicaoNoProjeto(pasta, edicaoBruta, casca);
      if (!c.ok) throw new Error(`Edição recusada: ${c.motivo}`);
      edicaoConferida = c.edicao;
    }
    // SIT2: casca da casa mais nova (multipágina, integrações, SEO) entra antes do trabalho, num commit próprio.
    // Gravyx: site importado não é do modelo da casa (a casca não entra nele).
    if (t.tipo !== "zip" && t.tipo !== "desfazer" && t.tipo !== "salvar" && t.tipo !== "descartar" && !importacaoPronta && !projetoImportado(pasta)) {
      const casca = await atualizarCasca(pasta);
      if (casca) await avisar({ tipo: "passo", resumo: `Casca da casa atualizada (v${casca})` });
      // SPM: a casca na mesma versão volta ao original (o agente não edita; o build do motor roda o que está aqui).
      const repostos = reporCasca(pasta);
      if (repostos.length) {
        await commitar(pasta, "Casca da casa reposta");
        await avisar({ tipo: "passo", resumo: `Casca da casa reposta: ${repostos.slice(0, 4).join(", ")}` });
      }
    }
    // Gravyx: o que muda o código entra no rascunho (a versão salva só muda no Salvar).
    if (TIPOS_DO_RASCUNHO.indexOf(t.tipo) >= 0) {
      const alvoDoPedido = (pedido.alvo || {}) as { voltar_para?: boolean };
      const r = await abrirRascunho(pasta, { id: t.id, tipo: t.tipo, modelo: modelo ? modelo.modelo_api : t.modelo, origem: importacaoPronta ? "importacao" : t.tipo === "desfazer" && alvoDoPedido.voltar_para ? "restauracao" : "edicao" });
      if (r.abriu) await avisar({ tipo: "passo", resumo: "Rascunho aberto a partir da versão salva" });
    }
    if (t.tipo === "publicar" && (await ramoAtual(pasta)) === RAMO_RASCUNHO) throw new Error("há um rascunho não salvo: salve a versão ou descarte o rascunho antes de publicar (o que sobe é a versão salva)");
    // Só a versão salva que a tela mostrou na comparação: ela tem de estar na versão salva de agora (main).
    if (t.tipo === "publicar" && typeof versaoPedida === "string" && versaoPedida) {
      const naMain = await git(pasta, ["merge-base", "--is-ancestor", versaoPedida, "HEAD"]).then(() => true, () => false);
      if (!naMain) throw new Error(`a versão ${versaoPedida.slice(0, 8)} não é a versão salva deste site; confira de novo antes de publicar`);
    }
    const anterior = await commitAtual(pasta);
    commitInicial = anterior;
    await fila.atualizar(t.id, { commit_anterior: anterior });

    if (t.tipo === "desfazer") {
      const alvo = (pedido.alvo || {}) as { commit?: string | null; commit_anterior?: string | null; voltar_para?: boolean };
      if (alvo.voltar_para) {
        // Voltar para a versão: reverte tudo o que veio depois do commit do trabalho escolhido.
        if (!alvo.commit_anterior) throw new Error("a versão escolhida não tem commit");
        if (anterior.indexOf(alvo.commit_anterior) === 0 || alvo.commit_anterior.indexOf(anterior) === 0) {
          await avisar({ tipo: "passo", resumo: "O código já está nesta versão" });
        } else {
          const c = await voltarCommits(pasta, alvo.commit_anterior, anterior);
          await avisar({ tipo: "commit", resumo: c.novo ? `Voltou para a versão ${alvo.commit_anterior.slice(0, 8)} (commit ${c.commit.slice(0, 8)})` : "Nada a voltar", dados: { commit: c.commit } });
          await fila.atualizar(t.id, { commit: c.commit });
        }
      } else {
        if (!alvo.commit || !alvo.commit_anterior) throw new Error("o trabalho a desfazer não tem commit");
        const c = await voltarCommits(pasta, alvo.commit_anterior, alvo.commit);
        await avisar({ tipo: "commit", resumo: c.novo ? `Desfeito (commit ${c.commit.slice(0, 8)})` : "Nada a desfazer", dados: { commit: c.commit } });
        await fila.atualizar(t.id, { commit: c.commit });
      }
    }

    if (t.tipo === "salvar") {
      await fase("escrevendo", "Salvando o rascunho como versão");
      const sv = await salvarRascunho(pasta);
      resultado.versao = versaoDoRascunho(sv.registro, sv.commit, new Date().toISOString());
      await fila.atualizar(t.id, { commit: sv.commit });
      await avisar({ tipo: "commit", resumo: `Versão salva (commit ${sv.commit.slice(0, 8)})`, dados: { commit: sv.commit } });
    }
    if (t.tipo === "descartar") {
      await fase("escrevendo", "Descartando o rascunho");
      const d = await descartarRascunho(pasta);
      resultado.descartado = { havia: d.havia, trabalhos: d.registro ? d.registro.trabalhos.map((x) => x.id) : [] };
      await fila.atualizar(t.id, { commit: d.commit });
      await avisar({ tipo: "commit", resumo: d.havia ? "Rascunho descartado: a prévia volta para a versão salva" : "Não havia rascunho para descartar", dados: { commit: d.commit } });
    }
    // Gravyx: o site importado vira o projeto, no rascunho (o Salvar grava a versão com origem "importação").
    if (t.tipo === "textos" && importacaoPronta) {
      await fase("escrevendo", "Montando o site importado no rascunho");
      const reg = aplicarImportacao(pasta, importacaoPronta, t.projeto);
      if ((await instalarImportado(pasta)) === "instalado") await avisar({ tipo: "passo", resumo: "Dependências do site importado instaladas (sem os scripts de instalação)" });
      const c = await commitar(pasta, `Importação: ${reg.rotulo}`);
      textosAplicados = c.novo;
      resultado.importacao = { ...reg, avisos: importacaoPronta.analise.avisos, ignorados: importacaoPronta.analise.ignorados.total };
      await fila.atualizar(t.id, { commit: c.commit });
      await avisar({ tipo: "commit", resumo: `Site importado no rascunho (${reg.rotulo}, ${reg.arquivos} arquivos)`, dados: { commit: c.commit } });
    } else if (t.tipo === "textos" && edicaoConferida) {
      // Gravyx: o Salvar do editor de código, no rascunho, sem IA.
      await fase("escrevendo", "Gravando a edição do código no rascunho (sem IA)");
      const feitas = escreverEdicaoNoProjeto(pasta, edicaoConferida);
      resultado.edicao_de_codigo = { arquivos: feitas, de: edicaoConferida.de };
      if (feitas.length) {
        const c = await commitar(pasta, `Código: ${feitas.join(", ")}`);
        textosAplicados = c.novo;
        await fila.atualizar(t.id, { commit: c.commit });
        await avisar({ tipo: "commit", resumo: `Código salvo no rascunho: ${feitas.slice(0, 4).join(", ")}`, dados: { commit: c.commit } });
      } else {
        await avisar({ tipo: "aviso", resumo: "Nada mudou: os arquivos já estavam assim" });
      }
    } else if (t.tipo === "textos") {
      // Texto escrito no código, trocado sem IA (busca literal; recusa com motivo).
      await fase("escrevendo", "Trocando o texto no código (sem IA)");
      const casca = (lerCasca(MODELO_DO_SITE) || { arquivos: [] as string[] }).arquivos;
      const r = aplicarTrocasNoProjeto(pasta, trocasDoPedido(trocasBrutas), casca);
      resultado.textos = { aplicado: r.ok, feitas: r.feitas, recusa: r.recusa };
      if (r.ok && r.feitas.length) {
        const c = await commitar(pasta, `Texto no código: ${r.feitas.map((f) => f.depois).join(" / ")}`);
        textosAplicados = c.novo;
        await fila.atualizar(t.id, { commit: c.commit });
        await avisar({ tipo: "commit", resumo: `Texto trocado em ${r.feitas.map((f) => `${f.arquivo}:${f.linha}`).join(", ")}`, dados: { commit: c.commit } });
      } else {
        await avisar({ tipo: "aviso", resumo: `Não troquei sem IA: ${r.recusa ? r.recusa.motivo : "nada a trocar"}` });
      }
    }

    // Só construir, ajustar e corrigir passam pelo modelo (TIPOS_QUE_GASTAM); o teste amarra SKILLS_POR_TRABALHO a eles.
    if (TIPOS_QUE_GASTAM.indexOf(t.tipo as (typeof TIPOS_QUE_GASTAM)[number]) >= 0) {
      if (!modelo) throw new Error("trabalho sem modelo");
      const avisos = await escreverPacote(pasta, pacote, fila);
      for (const a of avisos) await avisar({ tipo: "aviso", resumo: a });
      const base = await commitar(pasta, "Pacote do cliente");
      if (base.novo) await avisar({ tipo: "commit", resumo: "Pacote do cliente no projeto", dados: { commit: base.commit } });
      // UIM: o design system da base segue a consulta do pacote (refeito quando a Direção muda; some sem consulta).
      const designSystem = await prepararDesignSystem(pasta, pacote, { buscar: buscarNaBase, commitar, buscador: BUSCADOR_DA_UIUX });
      if (designSystem.evento) await avisar(designSystem.evento);
      if (await instalarSePrecisar(pasta)) await avisar({ tipo: "passo", resumo: "Dependências instaladas" });
      if (cfg.comPrevia) {
        const pv = await garantirPrevia(t.projeto, pasta);
        await fila.atualizar(t.id, { preview_url: pv.url, preview_expira_em: new Date(Date.now() + 60 * 60_000).toISOString() });
        await avisar({ tipo: "previa", resumo: pv.publica ? "Prévia ao vivo aberta" : "Prévia só nesta máquina", dados: { url: pv.url, publica: pv.publica, aviso: pv.aviso } });
      }
      medidor = modelo.provedor === "openrouter" ? await abrirMedidor() : null;
      // SPM: o tipo decide as skills liberadas; plugin que não sobe vira aviso e o trabalho segue no nativo.
      const servidor = await subirOpencode(pasta, modelo, medidor ? medidor.url : null, { tipo: t.tipo, aoFalhar: (msg) => avisar({ tipo: "aviso", resumo: msg }) });
      await avisar({ tipo: "passo", resumo: `Superpowers ${VERSAO_DO_SUPERPOWERS.tag} no modo ${servidor.modo} (${(SKILLS_POR_TRABALHO[t.tipo] || []).length} skills liberadas)` });
      if (servidor.limpos.length) await avisar({ tipo: "aviso", resumo: `Configuração do opencode achada no site e apagada antes de subir: ${servidor.limpos.slice(0, 4).join(", ")}` });
      const custoReal = medidor ? medidor.total : undefined;
      try {
        const passos = t.tipo === "construir" ? ((pedido.secoes as string[]) || []) : t.tipo === "corrigir" ? ["correcao"] : [String(pedido.secao || "")];
        if (t.tipo === "corrigir" && correcaoDoPedido && typeof correcaoDoPedido === "object") resultado.conferencia_de = (correcaoDoPedido as Record<string, unknown>).conferencia_de || null;
        const feitas: string[] = [];
        // SPV: a prévia editável marca seção a seção (pronta, construindo, na fila) pelo resultado parcial.
        if (t.tipo === "construir") resultado.secoes_pedidas = passos.slice();
        else resultado.secao_pedida = passos[0] || null;
        const andamento = async (secaoAtual: string | null) => {
          try {
            await fila.atualizar(t.id, { resultado: { ...resultado, secoes: feitas.slice(), secao_atual: secaoAtual } });
          } catch (e) {
            await avisar({ tipo: "aviso", resumo: `O andamento da seção não foi gravado: ${e instanceof Error ? e.message.slice(0, 160) : "erro"}` });
          }
        };
        const falhas: Array<{ secao: string; motivo: string }> = [];
        // UIM: prova de que a passada consultou a base de design e conferiu o checklist de UX (aviso, não trava).
        const consultas: ConsultaDaSecao[] = [];
        for (const secao of passos) {
          if (await deveParar()) {
            estadoFinal = "parado";
            break;
          }
          await fase("escrevendo", t.tipo === "corrigir" ? "Corrigindo o que a conferência achou" : `${t.tipo === "construir" ? "Construindo" : "Ajustando"} ${rotuloDaSecao(secao)}`);
          await andamento(secao);
          const antesDaSecao = await commitAtual(pasta);
          const linhasDoLog = lerLogDaBase(pasta).length;
          const inicioDaPassada = Date.now();
          const texto = t.tipo === "corrigir"
            ? promptDaCorrecao(problemasDaCorrecao, String(pacote.cliente || ""))
            : ajustarPromptDaBase(promptDaSecao(pacote as unknown as PacoteDoSite, secao, t.tipo === "ajustar" ? t.instrucao : t.instrucao && !/^Construir /.test(t.instrucao) ? t.instrucao : null), pacote, designSystem.master);
          const r = await rodarPassada(servidor, {
            titulo: `${t.tipo} ${secao}`,
            pedido: texto,
            modelo,
            tetoUsd: t.teto_usd,
            jaGasto: gasto.custo,
            prazoMs: cfg.prazoPorPassadaMs,
            aoEvento: (ev) => limitador.adicionar(ev),
            aoCusto: (total) => limitador.custo(total),
            deveParar,
            custoReal,
          });
          gasto.tabela += r.custo.custo_usd;
          gasto.custo = Math.max(gasto.tabela, medidor ? medidor.total() : 0);
          gasto.tokensEntrada += r.custo.tokens_entrada;
          gasto.tokensSaida += r.custo.tokens_saida;
          gasto.tokensCache += r.custo.tokens_cache;
          await fila.atualizar(t.id, { custo_usd: Math.round(gasto.custo * 1e6) / 1e6 });
          if (r.motivo !== "parado" && t.tipo !== "corrigir") {
            // Lido antes do commit: se a seção quebrar o build e voltar, a prova da passada já foi contada.
            const consulta = consultaDaSecao(secao, lerLogDaBase(pasta).slice(linhasDoLog), lerProvaDeUx(pasta, secao, inicioDaPassada));
            consultas.push(consulta);
            await avisar(eventoDaConsulta(consulta, rotuloDaSecao(secao)));
          }
          // SPM: se a passada mexeu na casca, ela volta antes do commit e do build do motor.
          const mexidos = reporCasca(pasta);
          if (mexidos.length) await avisar({ tipo: "aviso", resumo: `A passada de ${rotulo(secao)} mexeu na casca da casa (${mexidos.slice(0, 3).join(", ")}); o motor repôs o original` });
          let c = await commitar(pasta, `${t.tipo === "construir" ? "Seção" : t.tipo === "corrigir" ? "Correção" : "Ajuste"}: ${rotulo(secao)}`);
          let conferencia: ConferenciaDaSecao = { rodou: false, ok: false, problemas: [], onde: null, motivo: "nada mudou no código nesta passada" };
          if (c.novo) {
            // O site tem de continuar construindo. Seção que quebra o build volta (Desfazer do passo),
            // com o motivo à vista; não há laço de correção: a equipe pede de novo.
            await fase("compilando", `Compilando ${rotulo(secao)}`);
            const b = await construirSite(pasta);
            if (!b.ok) {
              const motivoDoBuild = resumoDoBuild(b.log);
              c = await voltarCommits(pasta, antesDaSecao, c.commit);
              await avisar({ tipo: "aviso", resumo: `${t.tipo === "corrigir" ? "A correção" : `A seção ${rotuloDaSecao(secao)}`} quebrou o build e foi desfeita: ${motivoDoBuild}` });
              falhas.push({ secao, motivo: motivoDoBuild });
              conferencia = { ...conferencia, motivo: "o build falhou e a seção foi desfeita" };
            } else {
              await avisar({ tipo: "commit", resumo: `Commit de ${rotulo(secao)}`, dados: { commit: c.commit, custo_usd: gasto.custo } });
              feitas.push(secao);
              await andamento(null);
              // SPM: a prova de verdade é a conferência que o MOTOR roda no build dele, com o conferir.mjs do modelo.
              if (t.tipo !== "corrigir") conferencia = conferirSecaoDoProjeto(pasta, secao);
            }
          }
          // SPM: PROVA declarada, a conferência do motor, DECIDI e PRECISA DE RESPOSTA viram eventos
          // (direto, fora do limitador, para não se juntarem). Prova que não bate vira aviso; nada é refeito.
          const marcas = eventosDasMarcas(r.marcas, { secao, rotulo: rotulo(secao), motivo: r.motivo, conferencia });
          if (marcas.length) {
            const pendente = limitador.soltar(Date.now() + 1000);
            if (pendente) await fila.evento(t, pendente);
            for (const ev of marcas) await fila.evento(t, ev);
          }
          await fila.atualizar(t.id, { commit: c.commit });
          if (r.motivo === "teto") {
            estadoFinal = "parado";
            await avisar({ tipo: "aviso", resumo: `Parou no teto de US$ ${t.teto_usd.toFixed(2)}` });
            break;
          }
          if (r.motivo === "parado") {
            estadoFinal = "parado";
            break;
          }
          if (r.motivo === "prazo") await avisar({ tipo: "aviso", resumo: `${t.tipo === "corrigir" ? "A correção" : `A seção ${rotuloDaSecao(secao)}`} passou do prazo e foi encerrada` });
          if (r.motivo === "erro") await avisar({ tipo: "erro", resumo: `${t.tipo === "corrigir" ? "A correção" : `A seção ${rotuloDaSecao(secao)}`} falhou: ${r.erro || "sem detalhe"}` });
        }
        resultado.secoes = feitas;
        if (falhas.length) resultado.secoes_desfeitas = falhas;
        if (consultas.length) resultado.base_de_design = totalDaBase(consultas);
      } finally {
        servidor.fechar();
        if (medidor) {
          gasto.custo = Math.max(gasto.tabela, medidor.total());
          resultado.custo_real_usd = medidor.total();
          resultado.custo_tabela_usd = Math.round(gasto.tabela * 1e6) / 1e6;
          resultado.chamadas_ao_modelo = medidor.chamadas();
          await medidor.fechar();
        }
      }
    }

    // SPV: a edição de conteúdo feita na prévia chega ao projeto sem modelo e sem build: pacote, marca.css,
    // imagens novas e um commit. A prévia do Vite recarrega sozinha (o pacote é importado pelo site).
    if (t.tipo === "conteudo") {
      const avisos = await escreverPacote(pasta, pacote, fila);
      for (const a of avisos) await avisar({ tipo: "aviso", resumo: a });
      const c = await commitar(pasta, t.instrucao || "Edição pela prévia");
      await fila.atualizar(t.id, { commit: c.commit });
      await avisar({ tipo: "commit", resumo: c.novo ? "Edição da prévia no projeto" : "O projeto já estava com esta edição", dados: { commit: c.commit } });
      if (cfg.comPrevia) {
        try {
          if (await instalarSePrecisar(pasta)) await avisar({ tipo: "passo", resumo: "Dependências instaladas" });
          const pv = await garantirPrevia(t.projeto, pasta);
          await fila.atualizar(t.id, { preview_url: pv.url, preview_expira_em: new Date(Date.now() + 60 * 60_000).toISOString() });
          if (pv.nova) await avisar({ tipo: "previa", resumo: pv.publica ? "Prévia ao vivo aberta" : "Prévia só nesta máquina", dados: { url: pv.url, publica: pv.publica, aviso: pv.aviso } });
        } catch (e) {
          await avisar({ tipo: "aviso", resumo: `A prévia do motor não abriu: ${e instanceof Error ? e.message.slice(0, 200) : "erro"}` });
        }
      }
    }

    // A prévia do Vite serve a pasta: depois de salvar, descartar ou trocar texto, ela mostra o que ficou.
    if (cfg.comPrevia && (t.tipo === "salvar" || t.tipo === "descartar" || (t.tipo === "textos" && textosAplicados))) {
      try {
        if (await instalarSePrecisar(pasta)) await avisar({ tipo: "passo", resumo: "Dependências instaladas" });
        const pv = await garantirPrevia(t.projeto, pasta);
        await fila.atualizar(t.id, { preview_url: pv.url, preview_expira_em: new Date(Date.now() + 60 * 60_000).toISOString() });
        if (pv.nova) await avisar({ tipo: "previa", resumo: pv.publica ? "Prévia ao vivo aberta" : "Prévia só nesta máquina", dados: { url: pv.url, publica: pv.publica, aviso: pv.aviso } });
      } catch (e) {
        await avisar({ tipo: "aviso", resumo: `A prévia do motor não abriu: ${e instanceof Error ? e.message.slice(0, 200) : "erro"}` });
      }
    }

    // SIT2: revisar e publicar também levam o pacote novo (SEO e integrações mudam sem passar pelo agente).
    if ((t.tipo === "revisar" || t.tipo === "publicar") && Object.keys(pacote).length) {
      const avisos = await escreverPacote(pasta, pacote, fila);
      for (const a of avisos) await avisar({ tipo: "aviso", resumo: a });
      const base = await commitar(pasta, "Pacote do cliente");
      if (base.novo) await avisar({ tipo: "commit", resumo: "Pacote do cliente no projeto (SEO e integrações)", dados: { commit: base.commit } });
      await fila.atualizar(t.id, { commit: base.commit });
    }

    const compila = ["revisar", "construir", "ajustar", "corrigir", "desfazer", "publicar", "salvar", "descartar"].indexOf(t.tipo) >= 0 || (t.tipo === "textos" && textosAplicados);
    if (compila) {
      await fase("compilando", "Compilando o site");
      await instalarSePrecisar(pasta);
      const b = await construirSite(pasta);
      if (!b.ok) {
        resultado.build = { ok: false, log: b.log.slice(-1200) };
        await avisar({ tipo: "aviso", resumo: `O build falhou; a conferência não rodou: ${resumoDoBuild(b.log)}` });
      } else {
        // Gravyx: a conferência de tipos (tsc) quando o projeto é TypeScript, com o erro em palavras simples.
        const tipos = await conferirTipos(pasta);
        resultado.tipos = { rodou: tipos.rodou, ok: tipos.ok, total: tipos.total, erros: tipos.erros.slice(0, 8), motivo: tipos.motivo };
        await avisar({ tipo: tipos.rodou && !tipos.ok ? "aviso" : "passo", resumo: resumoDosTipos(tipos) });
        await fase("conferindo", t.tipo === "publicar" ? "Conferindo antes de publicar" : "Conferindo no computador e no celular");
        const html = readFileSync(join(pasta, "dist", "index.html"), "utf8");
        const qa = revisarHtml(html);
        resultado.qa = qa;
        resultado.build = { ok: true };
        await avisar({ tipo: "passo", resumo: qa.length ? `Revisão: ${qa.length} aviso(s)` : "Revisão sem avisos" });
        // UXM: as regras de UX da base conferidas por código em TODAS as páginas do dist e a prova que o agente
        // deixou, pelo mesmo leitor do evento da passada (só seções do mapa, só a prova fresca). Aviso, nunca trava.
        try {
          const ux = await revisaoDeUx(pasta);
          resultado.ux = ux.avisos;
          resultado.ux_paginas = ux.paginas;
          resultado.ux_agente = ux.agente;
          const paginas = ux.paginas.length > 1 ? ` em ${ux.paginas.length} páginas` : "";
          await avisar({ tipo: "passo", resumo: ux.avisos.length ? `UX${paginas}: ${ux.avisos.length} regra(s) da base para olhar` : `UX${paginas}: regras de código em dia` });
        } catch (e) {
          resultado.ux_erro = e instanceof Error ? e.message.slice(0, 200) : "revisão de UX indisponível";
          await avisar({ tipo: "aviso", resumo: `A revisão de UX não rodou: ${resultado.ux_erro}` });
        }
        // Gravyx: a conferência num navegador de verdade (computador e celular) e a capa do site.
        // Nunca corrige sozinha: a correção é um botão na tela (uma passada, com custo antes).
        if (t.tipo !== "publicar") {
          const conf = await conferirNoNavegador(pasta, {
            subirCapa: async (bytes) => {
              const path = `${t.client_id}/site/${t.referencia_id || t.projeto}/conferencia/${t.id}-computador.jpg`;
              await fila.subir("mesa", path, bytes, "image/jpeg");
              return { bucket: "mesa", path };
            },
          });
          if (tipos.rodou && !tipos.ok) {
            const deTipos: ProblemaDaConferencia[] = tipos.erros.slice(0, 3).map((e) => ({ tipo: "tipos", grave: false, texto: `Em ${e.arquivo} linha ${e.linha}: ${e.simples}.`, aparelho: null, pagina: null, caminho: null, secao: null }));
            conf.problemas = juntarProblemas([conf.problemas, deTipos]);
            conf.graves = conf.problemas.filter((p) => p.grave).length;
          }
          resultado.conferencia = conf;
          await avisar({ tipo: conf.graves ? "aviso" : "passo", resumo: resumoDaConferencia(conf) });
        }
      }
      // Prévia na nuvem: toda versão salva e o pedido avulso (rascunho ou versão), depois do build bom.
      // Falhar aqui nunca derruba o trabalho (a prévia pelo túnel continua valendo).
      if (b.ok && t.tipo !== "publicar" && (t.tipo === "salvar" || pediuPreviaNaNuvem === true)) {
        const api = apiDoAmbiente();
        if (!api) {
          resultado.previa_nuvem_erro = SEM_CHAVE_NO_WORKER;
          if (pediuPreviaNaNuvem === true) await avisar({ tipo: "aviso", resumo: `Prévia na nuvem desligada: ${SEM_CHAVE_NO_WORKER}` });
        } else {
          try {
            await fase("conferindo", "Subindo a prévia na nuvem");
            const ramo = (await ramoAtual(pasta)) === RAMO_RASCUNHO ? "rascunho" : "main";
            const previa = await previaNaVercel(api, { projeto: t.projeto, commit: await commitAtual(pasta), ramo, arquivos: arquivosDoDist(pasta) });
            const { aviso: avisoDaPrevia, ...guardada } = previa;
            resultado.previa_nuvem = guardada;
            await avisar({ tipo: avisoDaPrevia ? "aviso" : "passo", resumo: `Prévia na nuvem: ${previa.url}${avisoDaPrevia ? ` (${avisoDaPrevia})` : ""}`, dados: { previa_nuvem: previa.url } });
          } catch (e) {
            resultado.previa_nuvem_erro = erroDaVercelEmTexto(e);
            await avisar({ tipo: "aviso", resumo: `A prévia na nuvem não subiu: ${resultado.previa_nuvem_erro}` });
          }
        }
      }
      if (t.tipo === "publicar") {
        if (!b.ok) throw new Error("o build falhou; nada foi publicado");
        const api = apiDoAmbiente();
        if (!api) throw new Error(`publicação desligada: ${SEM_CHAVE_NO_WORKER}`);
        const commit = await commitAtual(pasta);
        if (typeof versaoPedida === "string" && versaoPedida && !mesmoCommit(versaoPedida, commit)) await avisar({ tipo: "passo", resumo: `Versão ${versaoPedida.slice(0, 8)} com o pacote do cliente (commit ${commit.slice(0, 8)})` });
        const dominio = typeof pacote.dominio === "string" ? pacote.dominio : null;
        const publicado = await producaoNaVercel(api, { projeto: t.projeto, commit, arquivos: arquivosDoDist(pasta), dominio }).catch((e) => {
          throw new Error(`a Vercel não publicou: ${erroDaVercelEmTexto(e)}`);
        });
        const { arquivos: arquivosPublicados, ...resumoPublicado } = publicado;
        Object.assign(resultado, resumoPublicado, { versao_publicada: typeof versaoPedida === "string" ? versaoPedida : null });
        if (t.referencia_id) {
          await fila.mesclarPublicacao(t.referencia_id, {
            projeto_vercel: publicado.projeto_vercel, deploy_url: publicado.deploy_url, deploy_id: publicado.deploy_id, commit,
            versao: typeof versaoPedida === "string" ? versaoPedida : null, paginas: publicado.paginas, arquivos: arquivosPublicados,
            publicado_em: new Date().toISOString(), no_ar: true, tirado_em: null, verificacao: publicado.verificacao || null,
          });
        }
        await avisar({ tipo: "passo", resumo: `Publicado: ${publicado.deploy_url} (${publicado.paginas.join(", ")})` });
      }
    }

    // Zip do código (cópia de segurança e "Baixar o site") depois de toda mudança de código
    // (a edição de conteúdo da prévia vive no banco; o próximo trabalho de código guarda o zip).
    // Gravyx: o descartar também guarda (o editor de código abre o zip mais novo, que tem de ser o código de agora).
    if (t.tipo !== "revisar" && t.tipo !== "publicar" && t.tipo !== "conteudo" && !(t.tipo === "textos" && !textosAplicados)) {
      const commit = await commitAtual(pasta);
      const bytes = ziparProjeto(pasta, t.projeto);
      const caminho = `${t.client_id}/site/${t.referencia_id || t.projeto}/codigo/${t.projeto}-${commit.slice(0, 8)}.zip`;
      await fila.subir("mesa", caminho, bytes, "application/zip");
      await fila.atualizar(t.id, { zip_path: caminho });
      await avisar({ tipo: "passo", resumo: `Código guardado (${Math.max(1, Math.round(bytes.length / 1024))} KB)` });
    }
  } catch (e) {
    estadoFinal = "falhou";
    erro = e instanceof Error ? e.message.slice(0, 500) : "falha no trabalho";
    await avisar({ tipo: "erro", resumo: `Não deu certo: ${erro}`.slice(0, 300) });
  } finally {
    clearInterval(relogio);
  }

  // O custo real vai para a carteira (mesmo se parou ou falhou no meio: o gasto aconteceu).
  let usoId: string | null = null;
  if (gasto.custo > 0 && modelo) {
    try {
      usoId = await fila.registrarUso(t, { modeloId: modelo.id, provedor: modelo.provedor, tokensEntrada: gasto.tokensEntrada, tokensSaida: gasto.tokensSaida, tokensCache: gasto.tokensCache, custoUsd: gasto.custo, fonte: resultado.custo_real_usd ? "provedor" : "tabela" });
    } catch (e) {
      erro = `${erro ? `${erro}; ` : ""}custo não registrado na carteira: ${e instanceof Error ? e.message : "erro"}`.slice(0, 500);
    }
  }
  resultado.tokens = { entrada: gasto.tokensEntrada, saida: gasto.tokensSaida, cache: gasto.tokensCache };
  // Gravyx: em que ramo o trabalho deixou o projeto (a tela sabe se há rascunho sem salvar).
  try {
    const ramo = await ramoAtual(pasta);
    resultado.ramo = ramo === RAMO_RASCUNHO ? "rascunho" : "main";
    const reg = ramo === RAMO_RASCUNHO ? lerRegistroDoRascunho(pasta) : null;
    resultado.rascunho = reg ? { aberto: true, base: reg.base, trabalhos: reg.trabalhos.length } : { aberto: false };
  } catch {
    /* projeto sem git (falhou antes de nascer): a tela segue pelo resto */
  }
  // SIT2: o que este trabalho mudou no código (comparar versões na tela).
  try {
    const inicio = commitInicial;
    const fim = await commitAtual(pasta);
    if (inicio && fim && inicio !== fim) resultado.arquivos = await arquivosMudados(pasta, inicio, fim);
  } catch (e) {
    resultado.arquivos_erro = e instanceof Error ? e.message.slice(0, 200) : "diff indisponível";
  }
  const final = {
    estado: estadoFinal,
    custo_usd: Math.round(gasto.custo * 1e6) / 1e6,
    custo_fonte: gasto.custo > 0 ? (resultado.custo_real_usd ? "provedor" : "tabela") : null,
    uso_id: usoId && /^[0-9a-f-]{36}$/.test(usoId) ? usoId : null,
    resultado,
    erro,
    terminado_em: new Date().toISOString(),
  };
  // Frente MTR (rodada 2): só fecha se o trabalho ainda é deste executor e está rodando.
  // Outro worker pode ter varrido como órfão (batidas perdidas por rede): não sobrescreve
  // o "falhou" dele com "feito" nem manda um segundo "fim"; registra um aviso.
  const fechou = fila.fechar ? await fila.fechar(t.id, t.executor, final) : (await fila.atualizar(t.id, final), true);
  if (!fechou) {
    console.warn(`[motor] trabalho ${t.id}: a fila já tinha encerrado este trabalho (órfão varrido por outro executor); resultado deste worker não gravado.`);
    await fila.evento(t, { tipo: "aviso", resumo: `Este trabalho já tinha sido encerrado pela fila (sem batida por mais de 3 min). O resultado desta execução (${estadoFinal}, US$ ${gasto.custo.toFixed(4)}) não foi gravado por cima.`, dados: { estado_da_execucao: estadoFinal, custo_usd: gasto.custo, uso_id: final.uso_id } });
    return { estado: "encerrado_pela_fila", custo: gasto.custo };
  }
  // Evento final direto (fora do limitador): a tela fecha o trabalho com ele.
  await new Promise((r) => setTimeout(r, 1000));
  const sobra = limitador.soltar(Date.now() + 1000);
  if (sobra) await fila.evento(t, sobra);
  // Gancho do documento de entrega (frente DOC): o evento "fim" leva o resumo e as provas do trabalho.
  let commitFinal: string | null = null;
  try {
    commitFinal = await commitAtual(pasta);
  } catch {
    commitFinal = null;
  }
  await fila.evento(t, {
    tipo: "fim",
    resumo: estadoFinal === "feito" ? `Pronto. Custo US$ ${gasto.custo.toFixed(4)}` : estadoFinal === "parado" ? `Parado. Custo até aqui US$ ${gasto.custo.toFixed(4)}` : `Não deu certo. Custo US$ ${gasto.custo.toFixed(4)}`,
    dados: {
      ...(estadoFinal === "feito" ? { fase: "pronto" } : {}),
      custo_usd: gasto.custo,
      estado: estadoFinal,
      entrega: { tipo: t.tipo, projeto: t.projeto, commit: commitFinal, secoes: resultado.secoes || [], avisos_de_revisao: Array.isArray(resultado.qa) ? (resultado.qa as unknown[]).length : null, build_ok: resultado.build ? (resultado.build as { ok?: boolean }).ok !== false : null, publicado: resultado.deploy_url || null, base_de_design: resumoDaBaseNaEntrega(resultado.base_de_design) },
    },
  });
  return { estado: estadoFinal, custo: gasto.custo };
}
