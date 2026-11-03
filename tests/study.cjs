const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('node:http');
const {readFile}=require('node:fs/promises');
const {join}=require('node:path');
const {chromium}=require('playwright');
let browser,server,url;
before(async()=>{
    server=createServer(async(req,res)=>{
        const name=req.url==='/'?'index.html':req.url.slice(1);
        if(!['index.html','style.css','script.js','config.js','reading-preferences.js'].includes(name)) return res.writeHead(404).end();
        res.setHeader('Content-Type',(name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html')+'; charset=utf-8');
        res.end(await readFile(join(__dirname,'..',name)));
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${server.address().port}`;
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
});
after(async()=>{await browser?.close();await new Promise(r=>server?.close(r));});
async function page(){
    const p=await browser.newPage();
    await p.route('https://fonts.googleapis.com/**',r=>r.abort());
    await p.route('https://fonts.gstatic.com/**',r=>r.abort());
    await p.addInitScript(()=>{
        window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
        speechSynthesis.speak=u=>{window.testUtterance=u;};speechSynthesis.cancel=()=>{};
    });
    await p.goto(url);return p;
}
async function txt(p,text,name='estudo.txt'){
    await p.locator('#file-input').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(text)});
    await p.locator('#reading-area').waitFor({state:'visible'});
}
test('TXT preserves paragraphs and original visual numbers; spoken normalization is separate',async()=>{
    const p=await page();
    await txt(p,'1. Introdução\n\nCusto: R$ 1.250,50. Data: 21/10/2026.\n\n25 participantes concluíram o estudo.');
    assert.equal(await p.locator('#reading-inner h2').count(),1);
    assert.equal(await p.locator('#reading-inner p').count(),2);
    assert.match(await p.locator('#reading-inner').innerText(),/R\$ 1\.250,50/);
    assert.equal(await p.locator('#chapter-select option').count(),1);
    await p.locator('#s-1').click();await p.locator('#btn-play').click();
    assert.match(await p.evaluate(()=>window.testUtterance.text),/reais/);
    await p.close();
});
test('filtered PDF blocks render headings, styles and non-narrated references with source page',async()=>{
    const p=await page();
    const segment=(texto,indice_frase,trechos=[])=>({texto,indice_frase,trechos});
    const data={filename:'exemplo.pdf',sentences:['1. Introdução','Texto importante.'],
        estrutura:[{tipo:'paragrafo',texto:'PROPAGANDA QUE NÃO DEVE APARECER'}],
        blocos_leitura:[
            {id:'b0',tipo:'titulo',nivel:1,pagina:0,segmentos:[segment('1. Introdução',0)]},
            {id:'b1',tipo:'paragrafo',pagina:0,segmentos:[segment('Texto importante.',1,[{texto:'Texto ',negrito:false},{texto:'importante.',negrito:true,italico:true}])]},
            {id:'b2',tipo:'paragrafo',pagina:1,segmentos:[segment('https://universidade.example/artigo',null)]},
        ]};
    await p.route('**/upload-pdf-progress/**',r=>r.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'result',data})+'\n'}));
    await p.locator('#file-input').setInputFiles({name:'exemplo.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-sintetico')});
    await p.locator('#reading-area').waitFor({state:'visible'});
    assert.equal(await p.locator('#reading-inner h2').innerText(),'1. Introdução');
    assert.equal(await p.locator('#reading-inner strong em').innerText(),'importante.');
    assert.equal(await p.locator('.sent').count(),2);
    assert.match(await p.locator('#reading-inner').innerText(),/https:\/\/universidade.example\/artigo/);
    assert.doesNotMatch(await p.locator('#reading-inner').innerText(),/PROPAGANDA/);
    assert.equal(await p.locator('#chapter-select option').innerText(),'1. Introdução');
    assert.match(await p.locator('#source-page').innerText(),/1/);
    for(const width of [320,375,1280]){
        await p.setViewportSize({width,height:812});
        assert.equal(await p.evaluate(()=>document.body.scrollWidth>innerWidth||document.querySelector('#reading-area').scrollWidth>document.querySelector('#reading-area').clientWidth),false);
    }
    await p.close();
});
test('old API response renders only filtered sentences, never raw structure',async()=>{
    const p=await page();
    await p.evaluate(()=>processText('raw hidden content','antigo.pdf',['Texto aprovado.']));
    assert.equal(await p.locator('#reading-inner').innerText(),'Texto aprovado.');
    await p.close();
});
test('pause, voice/speed change resume at last word boundary; replay starts after completion',async()=>{
    const p=await page();await txt(p,'Uma frase suficientemente longa para testar a retomada. Outra frase completa.');
    await p.locator('#btn-play').click();
    await p.evaluate(()=>window.testUtterance.onboundary({charIndex:10,name:'word'}));
    await p.locator('#btn-play').click();await p.locator('#btn-play').click();
    assert.equal(await p.evaluate(()=>window.testUtterance.text),'suficientemente longa para testar a retomada.');
    await p.locator('#btn-spd').selectOption('1.25');
    assert.equal(await p.evaluate(()=>window.testUtterance.text),'suficientemente longa para testar a retomada.');
    await p.evaluate(()=>{goTo(state.sentences.length-1);window.testUtterance.onend();});
    await p.locator('#btn-play').click();
    assert.equal(await p.locator('.sent.reading').getAttribute('id'),'s-0');
    assert.equal(await p.locator('#btn-play').getAttribute('aria-pressed'),'true');
    await p.close();
});
test('missing word boundaries give explicit fallback and speed saves immediately',async()=>{
    const p=await page();await txt(p,'Primeira frase demonstrativa. Segunda frase demonstrativa.');
    await p.locator('#btn-play').click();await p.locator('#btn-play').click();
    assert.match(await p.locator('#playback-status').innerText(),/frase/);
    await p.locator('#btn-spd').selectOption('1.25');
    assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem(state.storageKey)).rate),1.25);
    await p.close();
});
test('position slider and paragraph navigation work with keyboard',async()=>{
    const p=await page();await txt(p,'Primeiro parágrafo tem uma frase.\n\nOutro parágrafo tem duas. Aqui está a outra.');
    const slider=p.getByRole('slider',{name:'Posição da leitura'});
    await slider.focus();await p.keyboard.press('End');
    assert.equal(await p.locator('.sent.reading').getAttribute('id'),'s-2');
    await p.keyboard.press('Home');
    assert.equal(await p.locator('.sent.reading').getAttribute('id'),'s-0');
    await p.locator('#reading-area').focus();await p.keyboard.press('Alt+ArrowDown');
    assert.equal(await p.locator('.sent.reading').getAttribute('id'),'s-1');
    await p.close();
});
test('same filename never shares progress with different content; exact content resumes',async()=>{
    const p=await page();const a='Primeiro conteúdo de aula. Segunda frase para continuar.';
    const b='Outro conteúdo de aula. Segunda frase diferente.';
    await txt(p,a,'aula.txt');await p.locator('#s-1').click();
    const keyA=await p.evaluate(()=>state.storageKey);
    await p.reload();await txt(p,b,'aula.txt');
    assert.equal(await p.locator('.sent.reading').getAttribute('id'),'s-0');
    assert.notEqual(await p.evaluate(()=>state.storageKey),keyA);
    await p.reload();await txt(p,a,'aula.txt');
    assert.equal(await p.locator('.sent.reading').getAttribute('id'),'s-1');
    const record=await p.evaluate(()=>JSON.parse(localStorage.getItem(state.storageKey)));
    assert.equal(record.version,2);assert.ok(record.anchor.hash);assert.ok(record.documentId);
    assert.doesNotMatch(JSON.stringify(record),/Primeiro conteúdo|Segunda frase/);
    await p.close();
});
test('content anchor survives changed segmentation index and legacy progress asks before reuse',async()=>{
    const p=await page();const text='Primeira frase. Segunda frase. Terceira frase.';
    await txt(p,text);await p.locator('#s-2').click();
    await p.evaluate(()=>{const saved=JSON.parse(localStorage.getItem(state.storageKey));saved.currentIdx=0;localStorage.setItem(state.storageKey,JSON.stringify(saved));state.storageKey=null;});
    await p.reload();await txt(p,text);
    assert.equal(await p.locator('.sent.reading').getAttribute('id'),'s-2');
    await p.evaluate(()=>{localStorage.clear();localStorage.setItem('audiolivro_v1_estudo.txt',JSON.stringify({title:'estudo.txt',currentIdx:2,total:3,rate:1,date:Date.now()}));state.storageKey=null;});
    await p.reload();let confirmed=false;
    p.once('dialog',async d=>{assert.equal(d.type(),'confirm');confirmed=true;await d.dismiss();});
    await txt(p,text);assert.equal(confirmed,true);
    assert.equal(await p.locator('.sent.reading').getAttribute('id'),'s-0');
    await p.close();
});
test('backend rejection shows specific message; cancelling a request leaves library usable',async()=>{
    const p=await page();let message;
    p.once('dialog',async d=>{message=d.message();await d.dismiss();});
    await p.route('**/upload-pdf-progress/**',r=>r.fulfill({status:413,contentType:'application/json',body:JSON.stringify({detail:'O PDF excede o limite de 25 MB.'})}));
    await p.locator('#file-input').setInputFiles({name:'grande.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF')});
    await p.waitForFunction(()=>document.querySelector('#loading-overlay').hidden);
    assert.match(message,/25 MB/);
    await p.unroute('**/upload-pdf-progress/**');
    await p.route('**/upload-pdf-progress/**',()=>{});
    await p.locator('#file-input').setInputFiles({name:'espera.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF')});
    await p.getByRole('button',{name:'Cancelar importação'}).click();
    await p.waitForFunction(()=>document.querySelector('#loading-overlay').hidden);
    assert.equal(await p.locator('#screen-import').evaluate(e=>e.inert),false);
    assert.equal(await p.locator('#screen-reader').evaluate(e=>e.hidden),true);
    await p.close();
});
test('paragraph pauses respect structure and are cancelled when playback is paused',async()=>{
    const p=await page();await txt(p,'1. Introdução\n\nPrimeiro parágrafo completo.\n\nSegundo parágrafo completo.');
    await p.clock.install();
    await p.locator('#btn-play').click();
    await p.evaluate(()=>window.testUtterance.onend());
    assert.equal(await p.evaluate(()=>window.testUtterance.text),'1. Introdução');
    await p.clock.runFor(400);
    assert.equal(await p.evaluate(()=>window.testUtterance.text),'Primeiro parágrafo completo.');
    await p.evaluate(()=>window.testUtterance.onend());await p.locator('#btn-play').click();
    await p.clock.runFor(400);
    assert.equal(await p.evaluate(()=>window.testUtterance.text),'Primeiro parágrafo completo.');
    assert.equal(await p.locator('#btn-play').getAttribute('aria-pressed'),'false');
    await p.close();
});
test('a stalled PDF request times out with a useful message and releases import UI',async()=>{
    const p=await page();let message;
    p.once('dialog',async d=>{message=d.message();await d.dismiss();});
    await p.addInitScript(()=>{
        class StalledXHR {
            constructor(){this.upload={};}
            open(){}setRequestHeader(){}
            send(){queueMicrotask(()=>this.ontimeout());}
        }
        window.XMLHttpRequest=StalledXHR;
    });
    await p.reload();
    await p.locator('#file-input').setInputFiles({name:'lento.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF')});
    await p.waitForFunction(()=>document.querySelector('#loading-overlay').hidden);
    assert.match(message,/3 minutos/);
    assert.equal(await p.locator('#screen-import').evaluate(e=>e.inert),false);
    await p.close();
});
test('superseded file hashes cannot start another upload or share document identity',async()=>{
    const p=await page();
    await p.addInitScript(()=>{
        const digest=crypto.subtle.digest.bind(crypto.subtle);
        window.pendingDigests=[];
        crypto.subtle.digest=(...args)=>new Promise(resolve=>window.pendingDigests.push(()=>digest(...args).then(resolve)));
    });await p.reload();
    const requests=[];
    let receiveB;
    const receivedB=new Promise(resolve=>{receiveB=resolve;});
    await p.route('**/upload-pdf-progress/**',r=>{requests.push(r);if(r.request().postData().includes('filename="B.pdf"')) receiveB();});
    await p.locator('#file-input').setInputFiles({name:'A.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-A')});
    await p.waitForFunction(()=>window.pendingDigests.length===1);
    await p.locator('#file-input').setInputFiles({name:'B.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-B')});
    await p.waitForFunction(()=>window.pendingDigests.length===2);
    await p.evaluate(async()=>{await window.pendingDigests[0]();await window.pendingDigests[1]();});
    await receivedB;
    assert.equal(requests.length,1,'only the latest selection may upload');
    await requests[0].fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'result',data:{filename:'B.pdf',sentences:['Texto do arquivo B.']}})+'\n'});
    await p.locator('#reading-area').waitFor({state:'visible'});
    const expected=require('node:crypto').createHash('sha256').update('%PDF-B').digest('hex');
    assert.equal(await p.evaluate(()=>state.documentId),expected);
    assert.equal(await p.evaluate(()=>state.title),'B.pdf');
    await p.close();
});
test('storage denial is visible and never prevents reading',async()=>{
    const p=await page();
    await p.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError');}});});
    await p.reload();await txt(p,'Leitura continua disponível. Outra frase completa.');
    assert.match(await p.locator('#playback-status').innerText(),/progresso.*salv/i);
    await p.close();
});
test('highlight avoids a full sentence scan; delegated styled clicks preserve jumps and selection',async()=>{
    const p=await page();await txt(p,Array.from({length:1000},(_,i)=>`Frase de teste ${i+1} completa.`).join(' '));
    const scans=await p.evaluate(()=>{
        const original=document.querySelectorAll.bind(document);let scans=0;
        document.querySelectorAll=selector=>{if(selector==='.sent')scans++;return original(selector);};
        try{goTo(200);goTo(201);goTo(900);goTo(50);}finally{document.querySelectorAll=original;}
        return scans;
    });
    assert.equal(scans,0);
    assert.equal(await p.locator('.sent.reading').getAttribute('id'),'s-50');
    assert.notEqual(await p.locator('#s-49').evaluate(e=>getComputedStyle(e).color),await p.locator('#s-51').evaluate(e=>getComputedStyle(e).color));
    await p.locator('#s-52').click();assert.equal(await p.locator('.sent.reading').getAttribute('id'),'s-52');
    await p.evaluate(()=>{const selection=getSelection();const range=document.createRange();range.selectNodeContents(document.querySelector('#s-1'));selection.removeAllRanges();selection.addRange(range);document.querySelector('#s-1').click();});
    assert.equal(await p.locator('.sent.reading').getAttribute('id'),'s-52','text selection must not seek');
    await p.close();
});
test('direct speed selection, compact voice labels and recent-first study library',async()=>{
    const p=await page();
    await p.addInitScript(()=>{speechSynthesis.getVoices=()=>[{name:'Microsoft Daniel - Portuguese (Brazil)',lang:'pt-BR'}];});
    await p.reload();await txt(p,'Material para estudar. Outra frase completa.');
    await p.locator('#btn-play').click();
    await p.getByRole('combobox',{name:'Velocidade da narração'}).selectOption('2');
    assert.equal(await p.evaluate(()=>window.testUtterance.rate),2);
    assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem(state.storageKey)).rate),2);
    assert.equal(await p.locator('#voice-select option').textContent(),'Daniel · BR');
    assert.match(await p.locator('#voice-select').getAttribute('title'),/Microsoft Daniel/);
    await p.getByRole('button',{name:'Sair da leitura e voltar à biblioteca',exact:true}).click();
    assert.match(await p.locator('#library-title').innerText(),/estud/i);
    assert.equal(await p.evaluate(()=>!!(document.querySelector('#saved-section').compareDocumentPosition(document.querySelector('.library-import'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
    await p.setViewportSize({width:320,height:568});
    await p.locator('#screen-import').evaluate(e=>{e.scrollTop=200;});
    const overlap=await p.evaluate(()=>{
        const a=document.querySelector('#theme-toggle').getBoundingClientRect();const b=document.querySelector('#saved-section').getBoundingClientRect();
        return a.bottom>b.top&&a.top<b.bottom;
    });assert.equal(overlap,false);
    await p.close();
});
test('reader has a named main and document heading; narrow reflow and maximum font keep controls usable',async()=>{
    const p=await page();await txt(p,'1. Introdução\n\nPrimeiro parágrafo de estudo. Segunda frase.\n\nOutro parágrafo de estudo.');
    assert.equal(await p.getByRole('main',{name:'Leitura e narração'}).count(),1);
    assert.equal(await p.getByRole('heading',{level:1,name:'estudo.txt'}).count(),1);
    for(const colorScheme of ['light','dark']){
        await p.emulateMedia({colorScheme,reducedMotion:'reduce'});
        for(const width of [320,375,640,1280]){
            await p.setViewportSize({width,height:720});
            await p.locator('#btn-appearance').click();
            await p.getByRole('slider',{name:'Tamanho do texto'}).focus();await p.keyboard.press('End');await p.keyboard.press('Escape');
            const checks=await p.evaluate(()=>{
                const area=document.querySelector('#reading-area').getBoundingClientRect();
                const player=document.querySelector('.player').getBoundingClientRect();
                const labels=[...document.querySelectorAll('#screen-reader button,#screen-reader select,[role=slider]')].filter(e=>e.getClientRects().length).every(e=>!!(e.getAttribute('aria-label')||e.textContent.trim()));
                return {overflow:document.body.scrollWidth>innerWidth,clearance:area.bottom<=player.top,labels};
            });
            assert.equal(checks.overflow,false);assert.equal(checks.clearance,true);assert.equal(checks.labels,true);
        }
    }
    await p.close();
});
test('background progress save does not duplicate speech or lose word position',async()=>{
    const p=await page();await txt(p,'Uma frase suficientemente longa para continuar depois. Outra frase completa.');
    await p.locator('#btn-play').click();
    const before=await p.evaluate(()=>{
        window.testUtterance.onboundary({charIndex:10,name:'word'});
        const current=window.testUtterance;
        Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});
        document.dispatchEvent(new Event('visibilitychange'));
        return {same:current===window.testUtterance,offset:JSON.parse(localStorage.getItem(state.storageKey)).speechOffset};
    });assert.equal(before.same,true);assert.equal(before.offset,10);
    await p.locator('#btn-play').click();await p.reload();await txt(p,'Uma frase suficientemente longa para continuar depois. Outra frase completa.');
    await p.locator('#btn-play').click();assert.match(await p.evaluate(()=>window.testUtterance.text),/^suficientemente/);
    await p.close();
});
