/* CompraCerta — regras de negócio, sem dependência de interface.
   Funciona no navegador (window.CCCore) e no Node (require) para os testes.
   Todos os valores monetários são inteiros em centavos. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.CCCore = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSAO_DADOS = 3;
  const PRECO_MAXIMO_CENTAVOS = 99999999; // R$ 999.999,99
  const QUANTIDADE_MAXIMA = 9999;
  const CATEGORIAS = ['Mercearia', 'Hortifruti', 'Laticínios', 'Carnes', 'Bebidas', 'Limpeza', 'Higiene', 'Padaria', 'Outros'];
  const UNIDADES = ['', 'un', 'kg', 'g', 'L', 'ml', 'pct', 'cx', 'dz'];

  function gerarId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  }

  function agoraISO() { return new Date().toISOString(); }

  function dataValida(valor) {
    const d = new Date(valor);
    return valor && !isNaN(d.getTime()) ? d.toISOString() : null;
  }

  /* ---------- Dinheiro ---------- */

  function precoValido(c) { return Number.isSafeInteger(c) && c >= 0; }

  /** Converte texto digitado ("5,99", "R$ 1.234,50", "5.99") em centavos.
      Campo vazio = preço não informado (null), nunca zero. */
  function interpretarPreco(texto) {
    const s = String(texto == null ? '' : texto).trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
    if (s === '') return { ok: true, centavos: null };
    if (s.charAt(0) === '-') return { ok: false, erro: 'O preço não pode ser negativo.' };
    let m, inteiro, fracao;
    if ((m = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{0,2}))?$/.exec(s))) { inteiro = m[1].replace(/\./g, ''); fracao = m[2] || ''; }
    else if ((m = /^(\d+)(?:,(\d{0,2}))?$/.exec(s))) { inteiro = m[1]; fracao = m[2] || ''; }
    else if ((m = /^(\d+)\.(\d{1,2})$/.exec(s))) { inteiro = m[1]; fracao = m[2]; }
    else if ((m = /^,(\d{1,2})$/.exec(s))) { inteiro = '0'; fracao = m[1]; }
    else return { ok: false, erro: 'Preço inválido. Use o formato 5,99.' };
    const centavos = Number(inteiro) * 100 + Number((fracao + '00').slice(0, 2));
    if (!Number.isSafeInteger(centavos) || centavos > PRECO_MAXIMO_CENTAVOS) return { ok: false, erro: 'Preço muito alto.' };
    return { ok: true, centavos: centavos };
  }

  const formatoBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  function formatarMoeda(centavos) { return formatoBRL.format(centavos / 100); }

  /** Texto para preencher um campo de preço: 599 -> "5,99". */
  function centavosParaCampo(c) {
    if (!precoValido(c)) return '';
    return Math.floor(c / 100) + ',' + String(c % 100).padStart(2, '0');
  }

  /* ---------- Quantidade ---------- */

  function interpretarQuantidade(texto) {
    const s = String(texto == null ? '' : texto).trim().replace(/\s+/g, '');
    if (s === '') return { ok: false, erro: 'Informe a quantidade.' };
    if (s.charAt(0) === '-') return { ok: false, erro: 'A quantidade deve ser maior que zero.' };
    const m = /^(\d+)(?:[.,](\d{1,3}))?$/.exec(s);
    if (!m) return { ok: false, erro: 'Quantidade inválida. Use, por exemplo, 2 ou 1,5.' };
    const milesimos = Number(m[1]) * 1000 + Number(((m[2] || '') + '000').slice(0, 3));
    if (milesimos <= 0) return { ok: false, erro: 'A quantidade deve ser maior que zero.' };
    if (milesimos > QUANTIDADE_MAXIMA * 1000) return { ok: false, erro: 'Quantidade muito alta.' };
    return { ok: true, valor: milesimos / 1000 };
  }

  function quantidadeValida(q) { return typeof q === 'number' && isFinite(q) && q > 0 && q <= QUANTIDADE_MAXIMA; }

  function formatarQuantidade(q) { return Number(q).toLocaleString('pt-BR', { maximumFractionDigits: 3 }); }

  /** quantidade × preço em centavos, sem erro de ponto flutuante (quantidade com até 3 casas). */
  function multiplicar(quantidade, centavos) {
    return Math.round(Math.round(quantidade * 1000) * centavos / 1000);
  }

  /* ---------- Nomes e catálogo ---------- */

  function limparNome(nome) { return String(nome == null ? '' : nome).trim().replace(/\s+/g, ' ').slice(0, 80); }
  function normalizarNome(nome) { return limparNome(nome).toLocaleLowerCase('pt-BR'); }
  function semAcentos(nome) { return normalizarNome(nome).normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  function validarNome(nome) {
    const valor = limparNome(nome);
    return valor ? { ok: true, valor: valor } : { ok: false, erro: 'Informe o nome do produto.' };
  }

  function distancia(a, b) {
    if (a === b) return 0;
    let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const atual = [i];
      for (let j = 1; j <= b.length; j++) {
        atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      anterior = atual;
    }
    return anterior[b.length];
  }

  /** Mesmo nome, ignorando maiúsculas e espaços extras: é o mesmo produto. */
  function encontrarProdutoExato(produtos, nome) {
    const chave = normalizarNome(nome);
    return produtos.find(p => normalizarNome(p.nome) === chave) || null;
  }

  /** Nomes parecidos (acentos, palavras contidas, pequenos erros de digitação).
      Nunca são unificados automaticamente: a interface pede confirmação. */
  function produtosParecidos(produtos, nome) {
    const alvo = semAcentos(nome);
    const exato = normalizarNome(nome);
    if (!alvo) return [];
    const palavrasAlvo = alvo.split(' ');
    return produtos.filter(p => {
      if (normalizarNome(p.nome) === exato) return false;
      const b = semAcentos(p.nome);
      if (b === alvo) return true;
      const palavrasB = b.split(' ');
      const [menor, maior] = palavrasAlvo.length <= palavrasB.length ? [palavrasAlvo, palavrasB] : [palavrasB, palavrasAlvo];
      if (menor.join('').length >= 3 && menor.every(w => maior.includes(w))) return true;
      // Nome digitado pela metade ("arr" -> "Arroz").
      if (alvo.length >= 3 && palavrasB.some(w => w.startsWith(alvo))) return true;
      const tamanho = Math.min(alvo.length, b.length);
      return tamanho >= 4 && distancia(alvo, b) <= (tamanho >= 7 ? 2 : 1);
    }).slice(0, 5);
  }

  /** Sugestões para o campo de busca enquanto a pessoa digita. */
  function buscarSugestoes(produtos, texto, limite) {
    const q = semAcentos(texto);
    if (!q) return [];
    return produtos
      .map(p => ({ p: p, chave: semAcentos(p.nome) }))
      .filter(x => x.chave.includes(q))
      .sort((x, y) => (y.chave.startsWith(q) - x.chave.startsWith(q)) || x.chave.localeCompare(y.chave, 'pt-BR'))
      .slice(0, limite || 6)
      .map(x => x.p);
  }

  function novoProduto(nome, extras, criadoEm) {
    extras = extras || {};
    return {
      id: gerarId(),
      nome: limparNome(nome),
      unidade: UNIDADES.includes(extras.unidade) ? extras.unidade : '',
      categoria: CATEGORIAS.includes(extras.categoria) ? extras.categoria : 'Outros',
      criadoEm: criadoEm || agoraISO()
    };
  }

  /* ---------- Listas ---------- */

  function novaLista(nome, criadaEm) {
    return { id: gerarId(), nome: limparNome(nome || ''), criadaEm: criadaEm || agoraISO(), status: 'rascunho', itens: [] };
  }

  function novoItem(produto, quantidade) {
    return {
      id: gerarId(),
      produtoId: produto.id,
      nomeProdutoSnapshot: produto.nome,
      unidadeSnapshot: produto.unidade || '',
      quantidade: quantidade,
      precoUnitarioRealCentavos: null,
      pego: false
    };
  }

  /* ---------- Histórico e estimativas ---------- */

  /** Compras da mais recente para a mais antiga. */
  function comprasRecentes(compras) {
    return compras
      .map((c, i) => ({ c: c, i: i }))
      .sort((x, y) => (x.c.finalizadaEm < y.c.finalizadaEm ? 1 : x.c.finalizadaEm > y.c.finalizadaEm ? -1 : y.i - x.i))
      .map(x => x.c);
  }

  /** produtoId -> { centavos, data, compraId } usando a compra concluída mais recente
      em que o produto teve preço válido registrado. */
  function mapaReferencias(compras) {
    const mapa = new Map();
    for (const compra of comprasRecentes(compras)) {
      for (const item of compra.itens || []) {
        if (item.produtoId && !mapa.has(item.produtoId) && precoValido(item.precoUnitarioRealCentavos)) {
          mapa.set(item.produtoId, { centavos: item.precoUnitarioRealCentavos, data: compra.finalizadaEm, compraId: compra.id });
        }
      }
    }
    return mapa;
  }

  function referenciaDePreco(compras, produtoId) { return mapaReferencias(compras).get(produtoId) || null; }

  /** Todos os preços já registrados de um produto, do mais recente ao mais antigo. */
  function historicoDePrecos(compras, produtoId) {
    const saida = [];
    for (const compra of comprasRecentes(compras)) {
      for (const item of compra.itens || []) {
        if (item.produtoId === produtoId) {
          saida.push({ compraId: compra.id, data: compra.finalizadaEm, quantidade: item.quantidade,
            centavos: precoValido(item.precoUnitarioRealCentavos) ? item.precoUnitarioRealCentavos : null });
        }
      }
    }
    return saida;
  }

  /** Resumo da lista atual. Itens sem preço nunca contam como R$ 0,00. */
  function calcularResumo(lista, compras, refs) {
    refs = refs || mapaReferencias(compras);
    const r = {
      quantidadeItens: lista.itens.length, quantidadeItensPegos: 0,
      quantidadeComPreco: 0, quantidadeSemPreco: 0, totalRegistradoCentavos: 0,
      quantidadeComEstimativa: 0, quantidadeSemEstimativa: 0, totalEstimadoCentavos: null,
      comparacao: null, totalCompleto: false, linhas: {}
    };
    let estimado = 0, compReal = 0, compEst = 0, compItens = 0;
    for (const item of lista.itens) {
      const ref = refs.get(item.produtoId) || null;
      const subReal = precoValido(item.precoUnitarioRealCentavos) ? multiplicar(item.quantidade, item.precoUnitarioRealCentavos) : null;
      const subEst = ref ? multiplicar(item.quantidade, ref.centavos) : null;
      r.linhas[item.id] = { referencia: ref, subtotalRealCentavos: subReal, subtotalEstimadoCentavos: subEst };
      if (item.pego) r.quantidadeItensPegos++;
      if (subReal !== null) { r.quantidadeComPreco++; r.totalRegistradoCentavos += subReal; } else r.quantidadeSemPreco++;
      if (subEst !== null) { r.quantidadeComEstimativa++; estimado += subEst; }
      if (subReal !== null && subEst !== null) { compItens++; compReal += subReal; compEst += subEst; }
    }
    r.quantidadeSemEstimativa = r.quantidadeItens - r.quantidadeComEstimativa;
    if (r.quantidadeComEstimativa) r.totalEstimadoCentavos = estimado;
    // Diferença só entre itens que têm estimativa E preço real; "completa" quando cobre a lista toda.
    if (compItens) {
      r.comparacao = { completa: compItens === r.quantidadeItens, itensComparados: compItens,
        estimadoCentavos: compEst, realCentavos: compReal, diferencaCentavos: compReal - compEst };
    }
    r.totalCompleto = r.quantidadeItens > 0 && r.quantidadeSemPreco === 0;
    return r;
  }

  /** Gera a compra concluída (cópia independente dos itens) e abre uma lista nova.
      Chamar duas vezes com a mesma lista não duplica a compra. */
  function finalizarCompra(estado, finalizadaEm) {
    const lista = estado.listaAtual;
    const existente = estado.compras.find(c => c.id === lista.id);
    if (existente) return { estado: estado, compra: existente, duplicada: true };
    if (!lista.itens.length) throw new Error('A lista está vazia.');
    const resumo = calcularResumo(lista, estado.compras);
    const produtos = new Map(estado.produtos.map(p => [p.id, p]));
    const compra = {
      id: lista.id,
      nome: lista.nome || '',
      criadaEm: lista.criadaEm,
      finalizadaEm: finalizadaEm || agoraISO(),
      status: 'concluida',
      itens: lista.itens.map(item => {
        const linha = resumo.linhas[item.id];
        const produto = produtos.get(item.produtoId);
        return {
          produtoId: item.produtoId,
          nomeProdutoSnapshot: item.nomeProdutoSnapshot,
          unidade: item.unidadeSnapshot || '',
          categoria: produto ? produto.categoria : 'Outros',
          quantidade: item.quantidade,
          precoUnitarioRealCentavos: precoValido(item.precoUnitarioRealCentavos) ? item.precoUnitarioRealCentavos : null,
          subtotalCentavos: linha.subtotalRealCentavos,
          pego: !!item.pego,
          precoReferenciaCentavos: linha.referencia ? linha.referencia.centavos : null,
          dataPrecoReferencia: linha.referencia ? linha.referencia.data : null
        };
      }),
      totalRealCentavos: resumo.totalRegistradoCentavos,
      totalEstimadoCentavos: resumo.totalEstimadoCentavos,
      quantidadeItens: resumo.quantidadeItens,
      quantidadeItensPegos: resumo.quantidadeItensPegos,
      quantidadeItensSemPreco: resumo.quantidadeSemPreco,
      possuiItensSemPreco: resumo.quantidadeSemPreco > 0
    };
    const novo = Object.assign({}, estado, { compras: estado.compras.concat([compra]), listaAtual: novaLista() });
    return { estado: novo, compra: compra, duplicada: false };
  }

  /* ---------- Estado, validação e migração ---------- */

  function estadoInicial() {
    return { versao: VERSAO_DADOS, produtos: [], listaAtual: novaLista(), compras: [], preferencias: { limiteCentavos: null } };
  }

  function sanitizarItem(i) {
    if (!i || !i.produtoId || !limparNome(i.nomeProdutoSnapshot)) return null;
    return {
      id: String(i.id || gerarId()),
      produtoId: String(i.produtoId),
      nomeProdutoSnapshot: limparNome(i.nomeProdutoSnapshot),
      unidadeSnapshot: typeof i.unidadeSnapshot === 'string' ? i.unidadeSnapshot : '',
      quantidade: quantidadeValida(i.quantidade) ? i.quantidade : 1,
      precoUnitarioRealCentavos: precoValido(i.precoUnitarioRealCentavos) ? i.precoUnitarioRealCentavos : null,
      pego: i.pego === true
    };
  }

  /** Confere a estrutura de dados v3. Compras concluídas são mantidas como foram gravadas. */
  function sanitizar(d) {
    const e = estadoInicial();
    e.produtos = (Array.isArray(d.produtos) ? d.produtos : [])
      .filter(p => p && p.id && limparNome(p.nome))
      .map(p => ({
        id: String(p.id), nome: limparNome(p.nome),
        unidade: UNIDADES.includes(p.unidade) ? p.unidade : '',
        categoria: CATEGORIAS.includes(p.categoria) ? p.categoria : 'Outros',
        criadoEm: dataValida(p.criadoEm) || e.listaAtual.criadaEm
      }));
    const l = d.listaAtual;
    if (l && Array.isArray(l.itens)) {
      e.listaAtual = {
        id: String(l.id || gerarId()), nome: limparNome(l.nome || ''),
        criadaEm: dataValida(l.criadaEm) || e.listaAtual.criadaEm, status: 'rascunho',
        itens: l.itens.map(sanitizarItem).filter(Boolean)
      };
    }
    // Todo item da lista precisa ter um produto no catálogo.
    const ids = new Set(e.produtos.map(p => p.id));
    for (const item of e.listaAtual.itens) {
      if (!ids.has(item.produtoId)) {
        e.produtos.push({ id: item.produtoId, nome: item.nomeProdutoSnapshot, unidade: item.unidadeSnapshot, categoria: 'Outros', criadoEm: e.listaAtual.criadaEm });
        ids.add(item.produtoId);
      }
    }
    e.compras = (Array.isArray(d.compras) ? d.compras : []).filter(c => c && c.id && dataValida(c.finalizadaEm) && Array.isArray(c.itens));
    const limite = d.preferencias && d.preferencias.limiteCentavos;
    e.preferencias.limiteCentavos = precoValido(limite) && limite > 0 ? limite : null;
    return e;
  }

  /** Converte os dados do HTML antigo (chaves compracerta-v1/v2: items, history, budget, preços em reais). */
  function migrarLegado(dados, zeroEhAusente) {
    const estado = estadoInicial();
    const porNome = new Map();
    const produtoPara = (nome, categoria, data) => {
      const chave = normalizarNome(nome);
      if (!porNome.has(chave)) {
        const p = novoProduto(nome, { categoria: categoria }, data);
        estado.produtos.push(p);
        porNome.set(chave, p);
      }
      return porNome.get(chave);
    };
    const centavos = v => {
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      if (!isFinite(n) || n < 0 || (zeroEhAusente && n === 0)) return null;
      return Math.round(n * 100);
    };
    const quantidade = v => { const q = Number(v); return quantidadeValida(q) ? Math.round(q * 1000) / 1000 : 1; };
    const preencher = (lista, itens, data) => {
      for (const i of Array.isArray(itens) ? itens : []) {
        if (!i || !limparNome(i.name)) continue;
        const p = produtoPara(i.name, i.category, data);
        if (lista.itens.some(x => x.produtoId === p.id)) continue;
        const item = novoItem(p, quantidade(i.qty));
        item.precoUnitarioRealCentavos = centavos(i.price);
        item.pego = !!i.done;
        lista.itens.push(item);
      }
    };
    const historico = (Array.isArray(dados.history) ? dados.history : []).slice()
      .sort((a, b) => String(a && a.date).localeCompare(String(b && b.date)));
    for (const h of historico) {
      const data = dataValida(h && h.date);
      if (!data) continue;
      const lista = novaLista('', data);
      preencher(lista, h.items, data);
      if (!lista.itens.length) continue;
      // Reaproveita a mesma regra de finalização, em ordem cronológica.
      const r = finalizarCompra(Object.assign({}, estado, { listaAtual: lista }), data);
      estado.compras = r.estado.compras;
    }
    estado.listaAtual = novaLista('', dataValida(dados.listStartedAt));
    preencher(estado.listaAtual, dados.items, estado.listaAtual.criadaEm);
    const limite = Number(dados.budget);
    estado.preferencias.limiteCentavos = isFinite(limite) && limite > 0 ? Math.round(limite * 100) : null;
    return estado;
  }

  /** Aceita dados v3 ou do formato antigo; lança erro se o formato for desconhecido. */
  function migrar(dados, opcoes) {
    if (!dados || typeof dados !== 'object') throw new Error('Arquivo de dados vazio ou inválido.');
    if (dados.versao === VERSAO_DADOS) return sanitizar(dados);
    if (typeof dados.versao === 'number' && dados.versao > VERSAO_DADOS) {
      throw new Error('Estes dados foram salvos por uma versão mais nova do CompraCerta.');
    }
    if (Array.isArray(dados.items) || Array.isArray(dados.history)) return migrarLegado(dados, opcoes && opcoes.zeroEhAusente);
    throw new Error('Formato de dados não reconhecido.');
  }

  return {
    VERSAO_DADOS, CATEGORIAS, UNIDADES,
    gerarId, dataValida, precoValido, interpretarPreco, formatarMoeda, centavosParaCampo,
    interpretarQuantidade, quantidadeValida, formatarQuantidade, multiplicar,
    limparNome, normalizarNome, semAcentos, validarNome, encontrarProdutoExato, produtosParecidos, buscarSugestoes,
    novoProduto, novaLista, novoItem,
    comprasRecentes, mapaReferencias, referenciaDePreco, historicoDePrecos, calcularResumo, finalizarCompra,
    estadoInicial, sanitizar, migrar
  };
});
