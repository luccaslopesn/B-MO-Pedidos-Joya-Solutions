#!/usr/bin/env node
// Hook Stop: portao-testes.
//
// O que faz: quando o Claude vai encerrar o turno, roda os testes unitários do
// backend (dotnet test backend/tests/BMO.Testes.Unitarios). Se algum falhar,
// devolve um resumo dos testes que falharam e bloqueia o encerramento: o Claude
// continua o turno e corrige.
//
// Por que existe: os testes unitários não precisam de banco e são rápidos, então
// valem como portão a cada turno. Os de integração (SQL Server em contêiner) são
// pesados demais para isso e ficam para o CI e para a execução manual.
//
// Fica inativo (sai 0 em silêncio) quando:
//   - stop_hook_active é true (o Claude já está continuando por causa deste hook;
//     sem isso, um teste que não consegue passar prenderia o turno num laço);
//   - não há mudança em backend/ (git status vazio), porque nada mudou para testar;
//   - backend/tests/BMO.Testes.Unitarios não existe;
//   - não há git, não há dotnet, ou os testes estouram o tempo (170 s, abaixo do
//     timeout de 180 s do hook): sem resultado não dá para acusar falha.
//
// Códigos de saída: 0 = encerra normalmente; 2 = devolve o erro ao Claude (stderr).

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const LIMITE_LINHAS = 30;
const TEMPO_MAXIMO_MS = 170_000;

function lerEntrada() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

function executar(comando, args, cwd, tempo) {
  return spawnSync(comando, args, { cwd, encoding: 'utf8', timeout: tempo, maxBuffer: 32 * 1024 * 1024 });
}

// Do relatório do dotnet test, guarda: cada teste que falhou (com a primeira linha
// da mensagem de erro), erros de compilação e a linha de totais.
function resumirFalhas(texto) {
  const linhas = texto.split(/\r?\n/);
  const resumo = [];
  let aposMensagem = false;

  for (const bruta of linhas) {
    const linha = bruta.trimEnd();
    const limpa = linha.trim();

    if (aposMensagem && limpa) {
      resumo.push(`    ${limpa}`);
      aposMensagem = false;
      continue;
    }
    if (/^Failed\s+\S/.test(limpa) && !/^Failed!/.test(limpa)) resumo.push(limpa);
    else if (/^Error Message:/.test(limpa)) aposMensagem = true;
    else if (/\berror\s+[A-Za-z]+\d+\s*:/.test(limpa) && !resumo.includes(limpa)) resumo.push(limpa);
    else if (/^(Failed|Passed)!\s+-/.test(limpa)) resumo.push(limpa);
  }
  return resumo;
}

const entrada = lerEntrada();
if (entrada?.stop_hook_active === true) process.exit(0);

const raiz = process.env.CLAUDE_PROJECT_DIR || entrada?.cwd || process.cwd();

const projeto = path.join(raiz, 'backend', 'tests', 'BMO.Testes.Unitarios');
if (!existsSync(projeto)) process.exit(0);

const status = executar('git', ['status', '--porcelain', 'backend/'], raiz, 20_000);
if (status.error || status.status !== 0 || status.stdout.trim() === '') process.exit(0);

const r = executar('dotnet', ['test', 'backend/tests/BMO.Testes.Unitarios', '--nologo'], raiz, TEMPO_MAXIMO_MS);
if (r.error || r.status === 0) process.exit(0);

const saida = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
let resumo = resumirFalhas(saida);
if (resumo.length === 0) {
  // Falha sem teste identificável (por exemplo, SDK ausente): mostra o fim da saída.
  resumo = saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-10);
}
const extras = resumo.length > LIMITE_LINHAS ? [`... e mais ${resumo.length - LIMITE_LINHAS} linha(s).`] : [];

process.stderr.write(
  ['Os testes unitários do backend falharam. Corrija antes de encerrar:', ...resumo.slice(0, LIMITE_LINHAS), ...extras].join('\n') + '\n',
);
process.exit(2);
