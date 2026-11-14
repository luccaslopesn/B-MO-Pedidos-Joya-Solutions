#!/usr/bin/env node
// Hook PostToolUse (Edit, Write, MultiEdit): verificar-edicao.
//
// O que faz: logo depois de uma edição, confere se ela não quebrou nada.
//   .cs      -> dotnet build backend/BMO.slnx; se falhar, devolve só as linhas de
//               erro (error CS...), no máximo 20.
//   .ts/.tsx -> eslint só no arquivo editado, a partir de frontend/.
//   outras   -> nada.
//
// Por que existe: o Claude descobre o erro na hora, com a edição ainda fresca,
// e não só no fim do turno ou no CI. Mostrar só as linhas de erro evita encher o
// contexto com o log inteiro do build.
//
// Fica inativo (sai 0 em silêncio) enquanto a estrutura não existir:
//   sem backend/BMO.slnx, sem frontend/package.json, sem eslint instalado
//   (frontend/node_modules), sem o comando dotnet, ou com arquivo .ts fora de frontend/.
// Também sai 0 se a verificação estourar o tempo (110 s, abaixo do timeout de 120 s
// do hook): sem resultado não dá para acusar erro.
//
// Códigos de saída: 0 = segue; 2 = devolve o erro ao Claude (stderr, em português).

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const LIMITE_LINHAS_ERRO = 20;
const TEMPO_MAXIMO_MS = 110_000;

function lerEntrada() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

function executar(comando, args, cwd) {
  return spawnSync(comando, args, { cwd, encoding: 'utf8', timeout: TEMPO_MAXIMO_MS, maxBuffer: 32 * 1024 * 1024 });
}

// Falha de infraestrutura (comando inexistente, tempo esgotado): não é erro do código.
function naoExecutou(r) {
  return Boolean(r.error);
}

function falhar(mensagem) {
  process.stderr.write(`${mensagem.trimEnd()}\n`);
  process.exit(2);
}

function verificarCSharp(raiz) {
  const solucao = path.join(raiz, 'backend', 'BMO.slnx');
  if (!existsSync(solucao)) process.exit(0);

  const r = executar('dotnet', ['build', 'backend/BMO.slnx', '-nologo', '-v', 'q'], raiz);
  if (naoExecutou(r) || r.status === 0) process.exit(0);

  const saida = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split(/\r?\n/);
  // O build repete cada erro (uma vez por projeto/alvo); mantém só a primeira ocorrência.
  const erros = [...new Set(saida.filter((l) => /\berror\s+[A-Za-z]+\d+\s*:/.test(l)).map((l) => l.trim()))];
  const linhas = erros.length ? erros : saida.map((l) => l.trim()).filter(Boolean).slice(-10);

  const extras = erros.length > LIMITE_LINHAS_ERRO ? [`... e mais ${erros.length - LIMITE_LINHAS_ERRO} erro(s).`] : [];
  falhar(
    ['O build do backend falhou depois desta edição. Corrija antes de seguir:', ...linhas.slice(0, LIMITE_LINHAS_ERRO), ...extras].join('\n'),
  );
}

function verificarTypeScript(raiz, arquivo) {
  const front = path.join(raiz, 'frontend');
  if (!existsSync(path.join(front, 'package.json'))) process.exit(0);

  const relativo = path.relative(front, arquivo);
  if (relativo.startsWith('..') || path.isAbsolute(relativo)) process.exit(0); // fora de frontend/

  // Roda o eslint com o próprio Node: igual no Windows, Mac e Linux, sem shell e sem npx.
  const eslint = path.join(front, 'node_modules', 'eslint', 'bin', 'eslint.js');
  if (!existsSync(eslint)) process.exit(0);

  const r = executar(process.execPath, [eslint, relativo], front);
  if (naoExecutou(r) || r.status === 0) process.exit(0);

  const linhas = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const extras = linhas.length > LIMITE_LINHAS_ERRO ? [`... e mais ${linhas.length - LIMITE_LINHAS_ERRO} linha(s).`] : [];
  falhar(
    [`O eslint encontrou problemas em frontend/${relativo.split(path.sep).join('/')}. Corrija antes de seguir:`, ...linhas.slice(0, LIMITE_LINHAS_ERRO), ...extras].join('\n'),
  );
}

const entrada = lerEntrada();
const arquivo = entrada?.tool_input?.file_path;
if (typeof arquivo !== 'string' || arquivo === '') process.exit(0);

const raiz = process.env.CLAUDE_PROJECT_DIR || entrada.cwd || process.cwd();
const extensao = path.extname(arquivo).toLowerCase();

if (extensao === '.cs') verificarCSharp(raiz);
else if (extensao === '.ts' || extensao === '.tsx') verificarTypeScript(raiz, path.resolve(raiz, arquivo));
process.exit(0);
