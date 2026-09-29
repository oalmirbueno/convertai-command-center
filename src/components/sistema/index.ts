/**
 * Componentes base do sistema de design do painel (docs/design/SISTEMA.md).
 * Importe daqui: `import { Secao, Painel, texto } from "@/components/sistema";`
 * A CascaDaMesa e o SeletorDeMesa importam por caminho próprio nas mesas, para
 * não puxar o resto junto na abertura.
 */
export { default as Secao, CabecalhoDeSecao } from "./Secao";
export { default as Painel } from "./Painel";
export { default as CabecalhoDePagina } from "./CabecalhoDePagina";
export { CampoDeFormulario, GrupoDeCampos, CampoDeEscolha } from "./Formulario";
export { EstadoVazio, Carregando, EstadoDeErro } from "./Estados";
export { default as BarraDeAcoes } from "./BarraDeAcoes";
export { default as Etapas, type ItemDeEtapa } from "./Etapas";
export { default as AjudaRecolhida } from "./AjudaRecolhida";
export { texto, conversa, campo, campoTexto, botao, superficie, foco, etiqueta, larguraDaMesa, juntar, toqueCompacto, espaco, lista, rolagem, ESCALA_DE_FONTE } from "./estilos";
export { default as AreaDeTrabalho, useAreaDeTrabalho, useLargo, abrirLateralDaArea, useAlturaQueCabe } from "./AreaDeTrabalho";
export { default as RegiaoRolavel } from "./RegiaoRolavel";
export { default as PainelDoAgente, CabecalhoDoAgente, MensagensDoAgente, CompositorDoAgente, BalaoDaConversa } from "./PainelDoAgente";
export { default as SeletorCompacto, type OpcaoCompacta } from "./SeletorCompacto";
export { useEstadoDaTela, lerEstadoDaTela, gravarEstadoDaTela, apagarEstadoDaTela } from "./useEstadoDaTela";
export { default as FaixaDeNumeros, CelulaDeNumero, type NumeroDaFaixa } from "./FaixaDeNumeros";
export { default as CampoDeBusca } from "./CampoDeBusca";
export { default as BotaoComIcone, RotuloLargo } from "./BotaoComIcone";
export { useReservaFlutuante } from "./useReservaFlutuante";
export { default as JanelaDoCelular } from "./JanelaDoCelular";
export { default as BarraDeControles } from "./BarraDeControles";
export { default as MenuMais, type ItemDoMenu } from "./MenuMais";
export { default as GradeDeSecoes } from "./GradeDeSecoes";
export { GrupoDeFuncoes, GradeDeGrupos } from "./GrupoDeFuncoes";
export { default as PreencherComIA, type CampoParaPreencher, type ResultadoDoPreenchimento, type PropsDoPreencherComIA } from "./PreencherComIA";
