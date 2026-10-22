const fs = require('fs');

function checkHtmlFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  
  // Extrai IDs
  const idRegex = /id=["']([^"']+)["']/g;
  const ids = new Map();
  let match;
  while ((match = idRegex.exec(raw)) !== null) {
    const id = match[1];
    ids.set(id, (ids.get(id) || 0) + 1);
  }
  const duplicates = [];
  for (const [id, count] of ids.entries()) {
    if (count > 1) duplicates.push({ id, count });
  }

  // Remove comentários HTML
  const content = raw.replace(/<!--[\s\S]*?-->/g, '');
  const voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9\-]*)([^>]*)>/g;
  const stack = [];
  while ((match = tagRegex.exec(content)) !== null) {
    const isClosing = match[0].startsWith('</');
    const isSelfClosing = match[0].endsWith('/>');
    const tagName = match[1].toLowerCase();
    if (voidTags.has(tagName) || isSelfClosing) continue;
    if (isClosing) {
      if (stack.length > 0 && stack[stack.length - 1] === tagName) {
        stack.pop();
      }
    } else {
      stack.push(tagName);
    }
  }

  return { duplicates, unclosedCount: stack.length, unclosedTags: stack };
}

const htmlFiles = [
  'index.html',
  'medicao.html',
  'medicao_mensal.html',
  'financeiro/faturamento.html',
  'financeiro/comissoes.html',
  'financeiro/intermediacao.html',
  'financeiro/locacoes.html',
  'financeiro/impostos.html',
  'financeiro/config.html',
  'bpo-financeiro-pgmei/public/index.html'
];

let allOk = true;
htmlFiles.forEach(f => {
  if (fs.existsSync(f)) {
    const res = checkHtmlFile(f);
    if (res.duplicates.length > 0 || res.unclosedCount > 0) {
      allOk = false;
      console.error(`❌ ${f}: Duplicates: ${JSON.stringify(res.duplicates)}, Unclosed: ${res.unclosedCount} (${res.unclosedTags.join(', ')})`);
    } else {
      console.log(`✅ ${f}: OK (0 IDs duplicados, 0 tags desbalanceadas)`);
    }
  }
});

if (!allOk) process.exit(1);
