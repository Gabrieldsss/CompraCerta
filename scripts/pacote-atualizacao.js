// Monta a pasta publicada no GitHub Pages com a atualização automática do APK:
//   <saída>/                         = conteúdo de www (o web app, usado no iPhone)
//   <saída>/atualizacao.json         = versão disponível, endereço do pacote e SHA-256
//   <saída>/atualizacao/compracerta-<versão>.zip = www compactado (o APK baixa e aplica sozinho)
// Uso: node scripts/pacote-atualizacao.js [pasta de saída, padrão "publicar"]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const raiz = path.join(__dirname, '..');
const www = path.join(raiz, 'www');
const saida = path.resolve(raiz, process.argv[2] || 'publicar');
const pacote = require(path.join(raiz, 'package.json'));
const versao = pacote.version;
const cc = pacote.compracerta || {};

function falhar(msg) { console.error('ERRO: ' + msg); process.exit(1); }

function listar(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const rel = base ? base + '/' + e.name : e.name;
    return e.isDirectory() ? listar(path.join(dir, e.name), rel) : [rel];
  }).sort();
}

/* ---------- ZIP mínimo (deflate), sem dependências ---------- */

const TABELA_CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function criarZip(arquivos) {
  const DATA = ((2026 - 1980) << 9) | (1 << 5) | 1; // data fixa: o mesmo conteúdo gera o mesmo zip
  const locais = [], centrais = [];
  let deslocamento = 0;
  for (const { nome, dados } of arquivos) {
    const nomeBuf = Buffer.from(nome, 'utf8');
    const comprimido = zlib.deflateRawSync(dados, { level: 9 });
    const usarDeflate = comprimido.length < dados.length;
    const corpo = usarDeflate ? comprimido : dados;
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(usarDeflate ? 8 : 0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(DATA, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(corpo.length, 18); local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(usarDeflate ? 8 : 0, 10); central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DATA, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(corpo.length, 20);
    central.writeUInt32LE(dados.length, 24); central.writeUInt16LE(nomeBuf.length, 28);
    central.writeUInt32LE(deslocamento, 42);
    locais.push(local, nomeBuf, corpo);
    centrais.push(central, nomeBuf);
    deslocamento += local.length + nomeBuf.length + corpo.length;
  }
  const diretorio = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12); fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, diretorio, fim]);
}

/* ---------- Montagem ---------- */

if (!fs.existsSync(path.join(www, 'index.html'))) falhar('www/index.html não encontrado.');
if (!fs.existsSync(path.join(www, 'js', 'versao.js'))) falhar('www/js/versao.js não encontrado: rode "node scripts/build.js" antes.');
if (!cc.apkMinimo || !cc.urlAtualizacao) falhar('package.json sem "compracerta.apkMinimo" / "compracerta.urlAtualizacao".');
const config = fs.readFileSync(path.join(www, 'js', 'config.js'), 'utf8');
if (!/supabase\.co/.test(config)) console.warn('Aviso: o pacote vai sem configuração do Supabase (o app funcionará sem nuvem).');

fs.rmSync(saida, { recursive: true, force: true });
fs.cpSync(www, saida, { recursive: true });

const arquivos = listar(www).map(nome => ({ nome: nome, dados: fs.readFileSync(path.join(www, nome)) }));
const zip = criarZip(arquivos);
const nomeZip = 'atualizacao/compracerta-' + versao + '.zip';
fs.mkdirSync(path.join(saida, 'atualizacao'), { recursive: true });
fs.writeFileSync(path.join(saida, nomeZip), zip);

const info = {
  versao: versao,
  apkMinimo: cc.apkMinimo,
  url: nomeZip,
  checksum: crypto.createHash('sha256').update(zip).digest('hex'),
  tamanho: zip.length,
  urlApk: cc.urlApk
};
fs.writeFileSync(path.join(saida, 'atualizacao.json'), JSON.stringify(info, null, 2) + '\n');
console.log('pacote: ' + nomeZip + ' (' + arquivos.length + ' arquivos, ' + (zip.length / 1048576).toFixed(1) + ' MB)');
console.log('atualizacao.json: versão ' + versao + ', APK mínimo ' + cc.apkMinimo);
