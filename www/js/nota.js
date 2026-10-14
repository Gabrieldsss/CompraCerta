/* CompraCerta — leitura dos itens de uma nota fiscal (cupom NFC-e) a partir do texto do OCR.
   Funciona no navegador (window.CCNota) e no Node (require) para os testes.
   O OCR erra em papel térmico: tudo o que sai daqui passa por uma tela de revisão. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica(require('./core.js'));
  else raiz.CCNota = fabrica(raiz.CCCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  /* ---------- Números ---------- */

  /** "24,90" | "39,9000" | "1.234,56" -> décimos de milésimo (inteiro), sem ponto flutuante. */
  function paraDezMilesimos(texto) {
    let s = String(texto).trim();
    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, ''); // 1.234,56
    const m = /^(\d+)(?:[.,](\d{1,4}))?$/.exec(s);
    if (!m) return null;
    return Number(m[1]) * 10000 + Number(((m[2] || '') + '0000').slice(0, 4));
  }

  const centavosDe = texto => {
    const v = paraDezMilesimos(texto);
    return v === null ? null : Math.round(v / 100);
  };

  const quantidadeDe = texto => {
    const v = paraDezMilesimos(texto);
    return v === null ? null : Math.round(v / 10) / 1000; // até 3 casas
  };

  /** Corrige confusões típicas do OCR só em "palavras" que são números (não mexe em descrições). */
  function corrigirNumeros(linha) {
    return linha
      .replace(/(\d)\s*([.,])\s*(\d)/g, '$1$2$3')
      .split(' ')
      .map(t => (/\d/.test(t) && /^[\dOoQDIl|SBZ.,]+$/.test(t)
        ? t.replace(/[OoQD]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2')
        : t))
      .join(' ');
  }

  /* ---------- Unidades e nomes ---------- */

  const UNIDADES = {
    UN: 'un', UND: 'un', UNID: 'un', U: 'un', PC: 'un', 'PÇ': 'un', PCA: 'un', PECA: 'un',
    KG: 'kg', KGS: 'kg', G: 'g', GR: 'g', L: 'L', LT: 'L', LTS: 'L', ML: 'ml',
    PCT: 'pct', PT: 'pct', PAC: 'pct', CX: 'cx', DZ: 'dz'
  };
  const unidadeDe = u => UNIDADES[String(u || '').toUpperCase()] || '';

  const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'com', 'sem', 'para', 'p', 'c']);

  /** "LEITE NINHO INTEGRAL 400G" -> "Leite Ninho Integral 400g" */
  function nomeLegivel(descricao) {
    const limpo = String(descricao).replace(/[|_*#~^"]+/g, ' ').replace(/(\d)\s?K6\b/gi, '$1kg'); // "1K6" lido no lugar de "1KG"
    return C.limparNome(limpo).toLocaleLowerCase('pt-BR').split(' ')
      .map((p, i) => (/^\d/.test(p) || (i > 0 && MINUSCULAS.has(p)) ? p : p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1)))
      .join(' ');
  }

  /* ---------- Itens ---------- */

  // Final de linha de item: QTD [UN] [x] VL_UNIT VL_TOTAL   (ex.: "0,856 KG X 6,99 5,98")
  const CAUDA = /(?:^|\s)(\d{1,4}(?:[.,]\d{1,3})?)\s*([A-Za-zÇç]{1,4})?\s*[xX×*]?\s*(\d{1,5}[.,]\d{2,4})\s+(\d{1,6}[.,]\d{2})\s*$/;
  // Início da linha: nº do item e/ou código do produto (EAN ou interno).
  const PREFIXO = /^\s*(?:\d{1,3}\s+)?(?:\d{4,14}\s+)?/;
  const FIM_DOS_ITENS = /VALOR\s*TOTAL|QTD\.?\s*TOTAL|TOTAL\s*DE\s*ITENS|FORMA\s*(?:DE\s*)?PAG|VALOR\s*A\s*PAGAR/i;
  const NAO_E_ITEM = /DESCONTO|DESC\.|ACR[EÉ]SC|TROCO|SUBTOTAL|CPF|CNPJ|CHAVE|PROTOCOLO|TRIBUTOS|C[OÓ]D(?:IGO)?\.?\s+DESCRI/i;

  /** Código "quase numérico": o OCR às vezes troca um dígito por letra (ex.: "T894900011517"). */
  const pareceCodigo = t => t.length >= 6 && (t.match(/\d/g) || []).length / t.length >= 0.7;

  function semPrefixo(texto) {
    const partes = texto.replace(PREFIXO, '').trim().split(' ');
    while (partes.length > 1 && pareceCodigo(partes[0])) partes.shift();
    return partes.join(' ').replace(/^[^A-Za-zÀ-ú]+/, '').trim();
  }

  const letras = t => (t.match(/[A-Za-zÀ-ú]/g) || []).length;

  /** Lê o texto do OCR e devolve { itens, totalNotaCentavos, somaItensCentavos, avisos }. */
  function lerItensDaNota(texto) {
    const linhas = String(texto || '').split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const itens = [];
    let descricaoPendente = '';
    let totalNotaCentavos = null;
    let acabaramOsItens = false;

    for (const original of linhas) {
      const linha = corrigirNumeros(original);
      const total = /VALOR\s*TOTAL[^\d]*(\d{1,6}[.,]\d{2})/i.exec(linha);
      if (total && totalNotaCentavos === null) totalNotaCentavos = centavosDe(total[1]);
      // Depois do rodapé só interessa o "VALOR TOTAL" (pode vir algumas linhas abaixo).
      if (itens.length && FIM_DOS_ITENS.test(linha)) acabaramOsItens = true;
      if (acabaramOsItens) continue;
      if (NAO_E_ITEM.test(linha)) { descricaoPendente = ''; continue; }

      const m = CAUDA.exec(linha);
      if (!m) {
        // Linha só com descrição: o restante do item costuma vir na linha de baixo.
        const desc = semPrefixo(original);
        descricaoPendente = letras(desc) >= 3 ? desc : '';
        continue;
      }
      let descricao = semPrefixo(linha.slice(0, m.index));
      if (letras(descricao) < 3) descricao = descricaoPendente;
      descricaoPendente = '';
      const quantidade = quantidadeDe(m[1]);
      const precoUnitarioCentavos = centavosDe(m[3]);
      const totalCentavos = centavosDe(m[4]);
      if (!descricao || !quantidade || precoUnitarioCentavos === null || totalCentavos === null) continue;
      const calculado = C.multiplicar(quantidade, precoUnitarioCentavos);
      const tolerancia = Math.max(2, Math.round(totalCentavos * 0.005));
      itens.push({
        descricao: descricao,
        nome: nomeLegivel(descricao),
        quantidade: quantidade,
        unidade: unidadeDe(m[2]),
        precoUnitarioCentavos: precoUnitarioCentavos,
        totalCentavos: totalCentavos,
        conferir: Math.abs(calculado - totalCentavos) > tolerancia // a conta não fecha: provável erro de leitura
      });
    }

    const somaItensCentavos = itens.reduce((s, i) => s + i.totalCentavos, 0);
    const avisos = [];
    if (!itens.length) avisos.push('Nenhum item foi reconhecido. Tente uma foto mais nítida, de perto e com boa luz.');
    const aConferir = itens.filter(i => i.conferir).length;
    if (aConferir) avisos.push(aConferir + (aConferir === 1 ? ' item pode ter sido lido errado' : ' itens podem ter sido lidos errado') + ' (a conta não fecha). Confira.');
    if (itens.length && totalNotaCentavos !== null && Math.abs(totalNotaCentavos - somaItensCentavos) > 2) {
      avisos.push('A soma dos itens lidos (' + C.formatarMoeda(somaItensCentavos) + ') é diferente do total da nota (' +
        C.formatarMoeda(totalNotaCentavos) + '): algum item pode não ter sido lido.');
    }
    return { itens: itens, totalNotaCentavos: totalNotaCentavos, somaItensCentavos: somaItensCentavos, avisos: avisos };
  }

  /* ---------- Correspondência com a lista atual ---------- */

  const IGNORAR = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'tipo', 'para', 'e']);
  const palavras = nome => C.semAcentos(nome).split(/[^a-z0-9]+/).filter(p => p.length >= 2 && !IGNORAR.has(p));

  /** "arroz" casa com "arroz"; "condens" com "condensado"; abreviações a partir de 4 letras. */
  function palavrasCasam(a, b) {
    if (a === b) return true;
    return Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a));
  }

  /** Pontuação de um item da lista para um nome da nota: nº de palavras do item encontradas na nota
      (todas precisam ser encontradas); 0 = não corresponde. */
  function pontuacao(nomeNota, nomeLista) {
    const daNota = palavras(nomeNota);
    const daLista = palavras(nomeLista).filter(p => /[a-z]/.test(p));
    if (!daLista.length) return 0;
    return daLista.every(p => daNota.some(q => palavrasCasam(p, q))) ? daLista.length : 0;
  }

  /** Para cada item lido, sugere um item da lista atual (cada item da lista é sugerido no máximo uma vez).
      Devolve um array com o id do item da lista ou null (= adicionar como novo). */
  function sugerirCorrespondencias(itensNota, itensLista) {
    const candidatos = [];
    itensNota.forEach((n, i) => itensLista.forEach(l => {
      const exato = C.normalizarNome(n.nome) === C.normalizarNome(l.nomeProdutoSnapshot);
      const p = exato ? 1000 : pontuacao(n.descricao, l.nomeProdutoSnapshot);
      if (p > 0) candidatos.push({ i: i, id: l.id, p: p });
    }));
    candidatos.sort((a, b) => b.p - a.p || a.i - b.i);
    const resultado = itensNota.map(() => null);
    const usados = new Set();
    for (const c of candidatos) {
      if (resultado[c.i] !== null || usados.has(c.id)) continue;
      resultado[c.i] = c.id;
      usados.add(c.id);
    }
    return resultado;
  }

  /* ---------- Preencher a lista atual ---------- */

  /** Aplica os itens conferidos na lista atual (altera `estado`).
      itensNota: [{ nome, quantidade, precoCentavos, unidade, destino (id de item da lista ou null) }]
      - destino: o item da lista recebe quantidade e preço da nota e fica marcado como pego;
      - sem destino: usa o produto de mesmo nome do catálogo (ou cria um) e adiciona à lista;
      - várias linhas para o mesmo item: soma as quantidades e usa o preço médio. */
  function aplicarNaLista(estado, itensNota) {
    const lista = estado.listaAtual;
    const acumulado = new Map();
    let adicionados = 0;
    for (const n of itensNota) {
      let item = n.destino ? lista.itens.find(i => i.id === n.destino) : null;
      if (!item) {
        let produto = C.encontrarProdutoExato(estado.produtos, n.nome);
        if (!produto) {
          produto = C.novoProduto(n.nome, { unidade: n.unidade });
          estado.produtos.push(produto);
        }
        item = lista.itens.find(i => i.produtoId === produto.id);
        if (!item) {
          item = C.novoItem(produto, n.quantidade);
          lista.itens.push(item);
          adicionados++;
        }
      }
      const a = acumulado.get(item) || { quantidade: 0, totalCentavos: 0, linhas: 0, preco: 0 };
      a.quantidade += n.quantidade;
      a.totalCentavos += C.multiplicar(n.quantidade, n.precoCentavos);
      a.linhas++;
      a.preco = n.precoCentavos;
      acumulado.set(item, a);
    }
    for (const [item, a] of acumulado) {
      item.quantidade = Math.round(a.quantidade * 1000) / 1000;
      item.precoUnitarioRealCentavos = a.linhas === 1 ? a.preco : Math.round(a.totalCentavos / item.quantidade);
      item.pego = true;
    }
    return { preenchidos: acumulado.size - adicionados, adicionados: adicionados };
  }

  return { lerItensDaNota, sugerirCorrespondencias, aplicarNaLista, nomeLegivel, unidadeDe, corrigirNumeros, centavosDe, quantidadeDe };
});
