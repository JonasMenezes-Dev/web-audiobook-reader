// Executa funções originais isoladas, sem navegador ou voz simulada apresentada como áudio real.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../script.js'), 'utf8');
function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\n}', start) + 2;
    if (start < 0 || end < 2) throw new Error(name);
    return source.slice(start, end);
}
const result = {};
const nodes = new Map();
const node = key => {
    if (!nodes.has(key)) nodes.set(key, {textContent:'',style:{},setAttribute(){},classList:{add(){},remove(){}}});
    return nodes.get(key);
};
const store = new Map();
const spoken = [];
const context = vm.createContext({
    document: {getElementById:node,querySelector:node,querySelectorAll:()=>[]},
    localStorage:{setItem:(k,v)=>store.set(k,v)},
    window:{speechSynthesis:{speak:u=>spoken.push(u),cancel:()=>{}},matchMedia:()=>({matches:false})},
    SpeechSynthesisUtterance: function(text){this.text=text;},
    state:{title:'estudo.txt',sentences:['Uma frase completa.', 'Outra frase completa.'],currentIdx:0,rate:1,playing:false,chapters:[]},
    SPEEDS:[1,1.25,1.5,2,0.7],STORAGE_KEY:'audiolivro_v1',speechGeneration:0,
    getBestVoice:()=>({lang:'pt-BR'}),log(){},highlight(){},Date,console
});
for (const name of ['normalizeText','numeroParaTexto','splitIntoSentences','detectChapters','saveProgress','cycleSpeed','cancelSpeech','speak','togglePlay']) vm.runInContext(extract(name),context);
result.abbreviations = vm.runInContext("splitIntoSentences('O Prof. Silva consultou a p. 25. A Dra. Souza concordou.')",context);
result.false_chapters = vm.runInContext("detectChapters(['25 e comparou 3,14 com 2.5.', '1. Introdução'])",context);
result.txt_visual_transform = vm.runInContext("normalizeText('Custo: R$ 1.250,50. Data: 21/10/2026. Amostra: 25%. Seção 1.234.')",context);
vm.runInContext('saveProgress(); cycleSpeed()',context);
result.speed_immediate_persistence = {selected:context.state.rate,saved:JSON.parse(store.get('audiolivro_v1_estudo.txt')).rate};
vm.runInContext('togglePlay();togglePlay();togglePlay()',context);
result.pause_resume = {utterances:spoken.map(u=>({text:u.text,rate:u.rate})),index:context.state.currentIdx};
context.state.currentIdx = context.state.sentences.length;
context.state.playing = false;
vm.runInContext('togglePlay()',context);
result.play_after_completion = {playing:context.state.playing,utteranceCount:spoken.length};
fs.writeFileSync(path.join(__dirname,'evidencias-leitor.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
