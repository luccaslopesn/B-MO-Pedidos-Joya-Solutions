#!/usr/bin/env node
// Hook PreToolUse (ferramentas Bash e PowerShell): proteger-historico.
//
// O que faz: impede que o Claude reescreva o histórico do git. Bloqueia
//   git rebase, git commit --amend, git push --force / -f / --force-with-lease
//   (e refspec com "+", que também força), git reset --hard, git merge --squash,
//   git filter-branch e git filter-repo.
//
// Por que existe: o enunciado exige histórico preservado, e cada passo do
// trabalho vira um commit próprio. Corrigir um erro é um commit novo, nunca
// uma reescrita do anterior.
//
// Como evita falso positivo: o comando é dividido em subcomandos (&&, ||, ;, |,
// quebra de linha) respeitando aspas, e só o subcomando git em si é analisado.
// Então `git commit -m "docs: explica por que não usamos rebase"` passa, porque
// "rebase" está dentro da mensagem, e não é um subcomando do git.
//
// Limites conhecidos: não interpreta `bash -c "..."`, `eval`, aliases do git nem
// variáveis de shell. É um freio contra acidente, não uma barreira contra quem
// quer burlar de propósito.
//
// Códigos de saída: 0 = segue; 2 = bloqueia e devolve a mensagem ao Claude.

import { readFileSync } from 'node:fs';

const MENSAGEM =
  'Bloqueado: o enunciado exige histórico preservado (sem reescrita). Use um novo commit.';

// Opções globais do git que consomem o argumento seguinte (git -C dir, git -c k=v).
const OPCOES_GLOBAIS_COM_VALOR = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env',
]);
// Prefixos que não mudam qual comando roda.
const PREFIXOS = new Set(['command', 'env', 'sudo', 'time', 'nohup', 'exec']);
// Opções do `git commit` cujo valor é texto livre (podem conter "--amend" sem ser a opção).
const COMMIT_OPCOES_COM_VALOR = ['-m', '--message', '-F', '--file'];

function lerEntrada() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

// Divide o comando em subcomandos, cada um uma lista de tokens { texto, citado }.
// Devolve null se as aspas ficaram abertas (comando que não conseguimos ler).
function dividirEmSubcomandos(comando) {
  const subcomandos = [];
  let tokens = [];
  let atual = null;
  let aspas = null;

  const fecharToken = () => {
    if (atual) tokens.push(atual);
    atual = null;
  };
  const fecharSubcomando = () => {
    fecharToken();
    if (tokens.length) subcomandos.push(tokens);
    tokens = [];
  };

  for (let i = 0; i < comando.length; i++) {
    const c = comando[i];

    if (aspas === "'") {
      if (c === "'") aspas = null;
      else atual.texto += c;
      continue;
    }
    if (aspas === '"') {
      if (c === '\\' && i + 1 < comando.length) atual.texto += comando[++i];
      else if (c === '"') aspas = null;
      else atual.texto += c;
      continue;
    }

    if (c === "'" || c === '"') {
      aspas = c;
      atual ??= { texto: '', citado: false };
      atual.citado = true;
      continue;
    }
    if (c === '\\' && i + 1 < comando.length) {
      atual ??= { texto: '', citado: false };
      atual.texto += comando[++i];
      continue;
    }
    if (c === '#' && atual === null) {
      // Comentário: ignora até o fim da linha.
      while (i + 1 < comando.length && comando[i + 1] !== '\n') i++;
      continue;
    }
    if ('\n;|&()`'.includes(c)) {
      fecharSubcomando();
      continue;
    }
    if (/\s/.test(c)) {
      fecharToken();
      continue;
    }
    atual ??= { texto: '', citado: false };
    atual.texto += c;
  }

  if (aspas) return null;
  fecharSubcomando();
  return subcomandos;
}

// Opções (tokens que começam com "-") de uma lista de argumentos, sem os valores
// de `comValor` e sem nada que estivesse entre aspas.
function opcoesDe(args, comValor = []) {
  const opcoes = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a.citado) continue;
    if (a.texto === '--') break;
    if (comValor.includes(a.texto)) {
      k++;
      continue;
    }
    if (a.texto.startsWith('-')) opcoes.push(a.texto);
  }
  return opcoes;
}

// Devolve a descrição do que foi bloqueado, ou null se o subcomando é permitido.
function analisar(tokens) {
  let i = 0;
  while (
    i < tokens.length &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i].texto) || PREFIXOS.has(tokens[i].texto))
  ) {
    i++;
  }
  if (i >= tokens.length || !/(^|[\\/])git(\.exe)?$/i.test(tokens[i].texto)) return null;

  i++;
  while (i < tokens.length && !tokens[i].citado && tokens[i].texto.startsWith('-')) {
    i += OPCOES_GLOBAIS_COM_VALOR.has(tokens[i].texto) ? 2 : 1;
  }
  if (i >= tokens.length) return null;

  const sub = tokens[i].texto;
  const args = tokens.slice(i + 1);

  switch (sub) {
    case 'rebase':
    case 'filter-branch':
    case 'filter-repo':
      return `git ${sub}`;
    case 'commit':
      return opcoesDe(args, COMMIT_OPCOES_COM_VALOR).includes('--amend') ? 'git commit --amend' : null;
    case 'reset':
      return opcoesDe(args).includes('--hard') ? 'git reset --hard' : null;
    case 'merge':
      return opcoesDe(args).includes('--squash') ? 'git merge --squash' : null;
    case 'push': {
      const forca = opcoesDe(args).some(
        (o) =>
          o === '--force' ||
          o.startsWith('--force-with-lease') ||
          (/^-[A-Za-z]+$/.test(o) && o.includes('f')),
      );
      const refspecForcado = args.some((a) => a.texto.startsWith('+') && a.texto.length > 1);
      return forca || refspecForcado ? 'git push com força' : null;
    }
    default:
      return null;
  }
}

// Plano B para comando com aspas desbalanceadas: busca grosseira no texto todo.
// Prefere bloquear a mais (falso positivo) a deixar passar uma reescrita.
function analisarTextoBruto(comando) {
  const padrao =
    /\bgit\b[^;&|\n]*(\brebase\b|\bfilter-branch\b|\bfilter-repo\b|--amend\b|--force\b|--force-with-lease\b|--squash\b|reset\s+--hard\b)/i;
  const achado = padrao.exec(comando);
  return achado ? achado[0].slice(0, 60) : null;
}

const entrada = lerEntrada();
const comando = entrada?.tool_input?.command;
if (typeof comando !== 'string' || comando.trim() === '') process.exit(0);

let bloqueado = null;
const subcomandos = dividirEmSubcomandos(comando);
if (subcomandos === null) {
  bloqueado = analisarTextoBruto(comando);
} else {
  for (const tokens of subcomandos) {
    bloqueado = analisar(tokens);
    if (bloqueado) break;
  }
}

if (bloqueado) {
  process.stderr.write(`${MENSAGEM}\n(detectado: ${bloqueado})\n`);
  process.exit(2);
}
process.exit(0);
