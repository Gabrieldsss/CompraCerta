// Testes da leitura de itens de nota fiscal (texto vindo do OCR).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../www/js/core.js');
const N = require('../www/js/nota.js');

const CUPOM = `
SUPERMERCADOS EXEMPLO LTDA
CNPJ: 00.000.000/0001-00
Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica
Código Descrição Qtde Un Vl Unit Vl Total
001 7896005800058 ARROZ TIO JOAO T1 5KG 1 UN X 24,90 24,90
002 7898215151784 FEIJAO CARIOCA KICALDO 1KG 2 UN X 8,49 16,98
003 2000150000000 BANANA PRATA KG 0,856 KG X 6,99 5,98
004 7891000315507 LEITE NINHO INTEGRAL 400G
1 UN X 19,90 19,90
QTD. TOTAL DE ITENS 5
VALOR TOTAL R$ 67,76
FORMA DE PAGAMENTO VALOR PAGO R$
Cartão de Débito 67,76
`;

test('cupom típico: itens em uma e em duas linhas, produto pesado e total', () => {
  const r = N.lerItensDaNota(CUPOM);
  assert.deepEqual(r.itens.map(i => [i.nome, i.quantidade, i.unidade, i.precoUnitarioCentavos, i.totalCentavos, i.conferir]), [
    ['Arroz Tio Joao T1 5kg', 1, 'un', 2490, 2490, false],
    ['Feijao Carioca Kicaldo 1kg', 2, 'un', 849, 1698, false],
    ['Banana Prata Kg', 0.856, 'kg', 699, 598, false],
    ['Leite Ninho Integral 400g', 1, 'un', 1990, 1990, false]
  ]);
  assert.equal(r.totalNotaCentavos, 6776);
  assert.equal(r.somaItensCentavos, 6776);
  assert.deepEqual(r.avisos, []);
});

test('erros comuns de OCR em números são corrigidos ou sinalizados', () => {
  const r = N.lerItensDaNota([
    '1 7891910000197 ACUCAR UNIAO 1KG 1,000 UN x 4,99 4,99',  // quantidade com 3 casas, "x" minúsculo
    '2 789100 CAFE PILAO 500G 1 UN X 19.9O 19,9O',            // letra O no lugar de zero, ponto decimal
    '3 789200 OLEO SOJA LIZA 900ML 3 UN X 7 ,49 22 ,47',      // espaço antes da vírgula
    '4 789300 MACARRAO ADRIA 500G 2 UN X 4,2S 8,58',          // S no lugar de 5 -> 4,25 x 2 = 8,50: não fecha
    '5 2000 QUEIJO MUSSARELA KG 0,456 KG X 39,900 18,19'      // preço por kg com 3 casas
  ].join('\n'));
  assert.deepEqual(r.itens.map(i => [i.nome, i.quantidade, i.precoUnitarioCentavos, i.totalCentavos, i.conferir]), [
    ['Acucar Uniao 1kg', 1, 499, 499, false],
    ['Cafe Pilao 500g', 1, 1990, 1990, false],
    ['Oleo Soja Liza 900ml', 3, 749, 2247, false],
    ['Macarrao Adria 500g', 2, 425, 858, true],
    ['Queijo Mussarela Kg', 0.456, 3990, 1819, false]
  ]);
  assert.match(r.avisos.join(' '), /1 item pode ter sido lido errado/);
});

test('descontos, cabeçalho e rodapé não viram itens; soma diferente do total gera aviso', () => {
  const r = N.lerItensDaNota([
    'Código Descrição Qtde Un Vl Unit Vl Total',
    '1 7890001 SABAO EM PO OMO 800G 1 UN X 15,90 15,90',
    'Desconto sobre item -1,00',
    'VALOR TOTAL R$ 30,00',
    '2 7890002 ITEM DEPOIS DO TOTAL 1 UN X 5,00 5,00'
  ].join('\n'));
  assert.deepEqual(r.itens.map(i => i.nome), ['Sabao em Po Omo 800g']);
  assert.match(r.avisos.join(' '), /diferente do total da nota/);
});

test('códigos de barras com letras trocadas pelo OCR saem do nome', () => {
  const r = N.lerItensDaNota([
    '006 T894900011517 REFRIG COCA COLA 2L',
    '2 UN X 10,99 21,98',
    'B898215151784 FEIJAO CARIOCA 1K6 2 UN X 8,49 16,98'
  ].join('\n'));
  assert.deepEqual(r.itens.map(i => i.nome), ['Refrig Coca Cola 2l', 'Feijao Carioca 1kg']);
});

test('texto sem itens reconhecíveis', () => {
  const r = N.lerItensDaNota('foto borrada\n@@@ ### \n');
  assert.equal(r.itens.length, 0);
  assert.match(r.avisos[0], /Nenhum item/);
});

test('sugere o item da lista atual correspondente a cada linha da nota', () => {
  const lista = ['Arroz', 'Leite', 'Banana', 'Café', 'Detergente'].map(nome => C.novoItem(C.novoProduto(nome), 1));
  const nota = N.lerItensDaNota(CUPOM + '\n').itens.concat(N.lerItensDaNota('9 1 LEITE CONDENSADO MOCOCA 1 UN X 5,49 5,49').itens);
  const sugestoes = N.sugerirCorrespondencias(nota, lista);
  const nomeDo = id => (id ? lista.find(i => i.id === id).nomeProdutoSnapshot : null);
  assert.deepEqual(sugestoes.map(nomeDo), ['Arroz', null, 'Banana', 'Leite', null]);
});

test('preencher a lista atual com os itens conferidos da nota', () => {
  const estado = C.estadoInicial();
  const novo = nome => { const p = C.novoProduto(nome); estado.produtos.push(p); return p; };
  const arroz = C.novoItem(novo('Arroz'), 2);          // na lista: planejava 2
  const leite = C.novoItem(novo('Leite'), 6);
  const cafe = C.novoItem(novo('Café'), 1);            // não está na nota: fica como está
  estado.listaAtual.itens.push(arroz, leite, cafe);
  novo('Banana Prata Kg');                              // já no catálogo, fora da lista

  const r = N.aplicarNaLista(estado, [
    { nome: 'Arroz Tio Joao T1 5kg', quantidade: 1, precoCentavos: 2490, unidade: 'un', destino: arroz.id },
    { nome: 'Leite Ninho', quantidade: 2, precoCentavos: 500, unidade: 'un', destino: leite.id },
    { nome: 'Leite Integral', quantidade: 1, precoCentavos: 440, unidade: 'un', destino: leite.id },
    { nome: 'Banana Prata Kg', quantidade: 0.856, precoCentavos: 699, unidade: 'kg', destino: null },
    { nome: 'Feijao Carioca 1kg', quantidade: 2, precoCentavos: 849, unidade: 'un', destino: null }
  ]);

  assert.deepEqual(r, { preenchidos: 2, adicionados: 2 });
  assert.deepEqual([arroz.quantidade, arroz.precoUnitarioRealCentavos, arroz.pego], [1, 2490, true], 'quantidade real da nota');
  assert.deepEqual([leite.quantidade, leite.precoUnitarioRealCentavos, leite.pego], [3, 480, true], '2×5,00 + 1×4,40 = 14,40 / 3');
  assert.deepEqual([cafe.precoUnitarioRealCentavos, cafe.pego], [null, false], 'item fora da nota não muda');
  const banana = estado.listaAtual.itens.find(i => i.nomeProdutoSnapshot === 'Banana Prata Kg');
  assert.equal(banana.produtoId, estado.produtos.find(p => p.nome === 'Banana Prata Kg').id, 'reaproveita o produto do catálogo');
  assert.deepEqual([banana.quantidade, banana.precoUnitarioRealCentavos, banana.pego], [0.856, 699, true]);
  const feijao = estado.produtos.find(p => p.nome === 'Feijao Carioca 1kg');
  assert.ok(feijao, 'produto novo criado no catálogo');
  assert.equal(estado.listaAtual.itens.length, 5);
  const resumo = C.calcularResumo(estado.listaAtual, estado.compras);
  assert.equal(resumo.quantidadeSemPreco, 1, 'só o café continua sem preço');
});

test('nome exato do catálogo tem prioridade e palavras curtas não casam por engano', () => {
  const lista = ['Sal', 'Leite condensado'].map(nome => C.novoItem(C.novoProduto(nome), 1));
  const nota = [
    { descricao: 'SALSICHA PERDIGAO', nome: 'Salsicha Perdigao' },
    { descricao: 'LEITE CONDENS MOCOCA 395G', nome: 'Leite Condens Mococa 395g' },
    { descricao: 'SAL', nome: 'Sal' }
  ];
  const sugestoes = N.sugerirCorrespondencias(nota, lista).map(id => (id ? lista.find(i => i.id === id).nomeProdutoSnapshot : null));
  assert.deepEqual(sugestoes, [null, 'Leite condensado', 'Sal']);
});
