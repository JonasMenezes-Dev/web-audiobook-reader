// Benchmark reproduzível local; não é teste de velocidade de dispositivo físico.
const {createServer}=require('node:http');
const {readFile,writeFile,mkdir}=require('node:fs/promises');
const {join}=require('node:path');
const {chromium}=require('playwright');
async function main(){
    const root=join(__dirname,'..');
    const server=createServer(async(req,res)=>{
        const name=req.url==='/'?'index.html':req.url.slice(1);
        if(!['index.html','script.js','style.css','config.js','reading-preferences.js'].includes(name)) return res.writeHead(404).end();
        res.setHeader('Content-Type',(name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html')+'; charset=utf-8');
        res.end(await readFile(join(root,name)));
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
    const results=[];
    try{
        for(const count of [3500,14000]){
            const runs=[];
            for(let run=0;run<3;run++){
                const page=await browser.newPage({viewport:{width:375,height:812}});
                await page.route('https://fonts.googleapis.com/**',r=>r.abort());await page.route('https://fonts.gstatic.com/**',r=>r.abort());
                await page.goto(`http://127.0.0.1:${server.address().port}`);
                const metrics=await page.evaluate(async count=>{
                    const sentences=Array.from({length:count},(_,i)=>`Trecho ${i+1}: evidências e conceitos para comparação acadêmica.`);
                    const blocks=Array.from({length:Math.ceil(count/5)},(_,i)=>({id:`p${i}`,tipo:'paragrafo',pagina:Math.floor(i/7),segmentos:sentences.slice(i*5,i*5+5).map((texto,j)=>({texto,indice_frase:i*5+j,trechos:[]}))}));
                    const start=performance.now();processText('', 'Benchmark sintético', sentences,blocks);
                    document.querySelector('#reading-inner').getBoundingClientRect();
                    const importMs=performance.now()-start;
                    const samples=[];
                    for(const index of [1,2,3,Math.floor(count/2),count-1,Math.floor(count/2),0]){
                        const t=performance.now();state.currentIdx=index;highlight(false,true);
                        document.querySelector('.sent.reading').getBoundingClientRect();
                        samples.push(performance.now()-t);
                    }
                    // Inclui rolagem, medição de layout e pintura após um salto.
                    const t=performance.now();goTo(Math.floor(count/2));
                    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
                    const jumpPaintMs=performance.now()-t;
                    return {importMs,highlightMs:samples,jumpPaintMs,heapBytes:performance.memory?.usedJSHeapSize||null,sentences:document.querySelectorAll('.sent').length,overflow:document.body.scrollWidth>innerWidth};
                },count);
                runs.push(metrics);await page.close();
            }
            results.push({count,runs});
        }
    }finally{await browser.close();await new Promise(r=>server.close(r));}
    const label=process.argv[2]||'measurement';
    const dir=join(root,'docs/melhorias-fases-4-6');await mkdir(dir,{recursive:true});
    await writeFile(join(dir,`performance-${label}.json`),JSON.stringify({browser:'Chrome headless',viewport:'375x812',fonts:'fallback local',runs:results},null,2));
    const median=a=>a.toSorted((x,y)=>x-y)[Math.floor(a.length/2)];
    console.log(JSON.stringify(results.map(r=>({count:r.count,importMs:median(r.runs.map(x=>x.importMs)),highlightMs:median(r.runs.flatMap(x=>x.highlightMs)),jumpPaintMs:median(r.runs.map(x=>x.jumpPaintMs)),heapBytes:median(r.runs.map(x=>x.heapBytes))})),null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
