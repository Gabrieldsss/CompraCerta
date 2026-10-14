// Servidor local para testar o CompraCerta no computador e no celular (mesma rede Wi-Fi).
// Uso: node servidor.js   (porta opcional: node servidor.js 8080)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORTA = Number(process.argv[2]) || 8080;
const RAIZ = path.join(__dirname, 'www'); // só os arquivos do app
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.wasm': 'application/wasm', '.gz': 'application/gzip'
};

http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const arquivo = path.resolve(RAIZ, rel);
  if (!arquivo.startsWith(RAIZ + path.sep)) {
    res.writeHead(404); res.end('Não encontrado'); return;
  }
  fs.readFile(arquivo, (erro, conteudo) => {
    if (erro) { res.writeHead(404); res.end('Não encontrado'); return; }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(conteudo);
  });
}).listen(PORTA, '0.0.0.0', () => {
  console.log('CompraCerta rodando:');
  console.log('  Neste computador: http://localhost:' + PORTA);
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const r of lista || []) {
      if (r.family === 'IPv4' && !r.internal) console.log('  No celular (mesmo Wi-Fi): http://' + r.address + ':' + PORTA);
    }
  }
  console.log('Ctrl+C para parar.');
});
