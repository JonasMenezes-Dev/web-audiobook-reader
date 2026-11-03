const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../script.js'),'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    return source.slice(start,source.indexOf('\n}',start)+2);
}
test('academic abbreviations, initials, addresses and DOI remain intact',()=>{
    const ctx=vm.createContext({}); vm.runInContext(extract('splitIntoSentences'),ctx);
    for(const [input,expected] of [
        ['O Prof. Silva consultou a p. 25. A Dra. Souza concordou.',['O Prof. Silva consultou a p. 25.','A Dra. Souza concordou.']],
        ['A. B. Silva publicou os dados. Outra frase.',['A. B. Silva publicou os dados.','Outra frase.']],
        ['https://universidade.example/artigo',['https://universidade.example/artigo']],
        ['https://universidade.example/busca?q=metodo&ano=2026',['https://universidade.example/busca?q=metodo&ano=2026']],
        ['DOI: 10.1234/estudo.2026.12. Outra frase.',['DOI: 10.1234/estudo.2026.12.','Outra frase.']],
    ]) assert.deepEqual(Array.from(ctx.splitIntoSentences(input)),expected);
});
