const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseVideoId, fitDimensions, logoPlacement, fetchThumbnail, mount } = require('../youtube-thumbnail.js');
const id = 'dQw4w9WgXcQ';
test('parses supported links and rejects unrelated hosts and malformed IDs', () => {
    for (const value of [id, `https://youtu.be/${id}?t=10`, `https://www.youtube.com/watch?v=${id}&list=x`,
        `youtube.com/shorts/${id}`, `https://m.youtube.com/live/${id}`, `https://www.youtube-nocookie.com/embed/${id}`]) assert.equal(parseVideoId(value), id);
    for (const value of ['', 'short', `https://youtube.com.evil.test/watch?v=${id}`, `https://evil.test/${id}`,
        `https://youtube.com/playlist?list=${id}`, `https://youtube.com@evil.test/watch?v=${id}`, `https://youtu.be/${id}/extra`]) assert.throws(() => parseVideoId(value));
});
test('caps the long side, preserves portrait ratio, never upscales', () => {
    assert.deepEqual(fitDimensions(1920,1080,1280), {width:1280,height:720});
    assert.deepEqual(fitDimensions(2160,3840,1280), {width:720,height:1280});
    assert.deepEqual(fitDimensions(640,480,1280), {width:640,height:480});
    assert.throws(() => fitDimensions(0,480,1280));
});
test('keeps oversized logos inside all four corners', () => {
    for (const p of ['bottom-right','bottom-left','top-right','top-left']) {
        const r=logoPlacement(320,180,4000,500,p);
        assert.ok(r.x>=0 && r.y>=0 && r.x+r.width<=320 && r.y+r.height<=180);
    }
});
test('falls back on HTTP errors and 120px placeholders', async () => {
    const calls=[];
    const image=await fetchThumbnail(id, null, async url => {
        calls.push(url);
        if (url.includes('maxres')) throw new Error('404');
        return url.includes('sddefault') ? {naturalWidth:120,naturalHeight:90} : {naturalWidth:480,naturalHeight:360};
    });
    assert.equal(calls.length,3); assert.equal(image.naturalWidth,480);
    await assert.rejects(fetchThumbnail(id,null,async()=>({naturalWidth:120,naturalHeight:90})),/無法取得/);
});
test('aborted requests stop before trying another image', async () => {
    const c=new AbortController(); c.abort(); let calls=0;
    await assert.rejects(fetchThumbnail(id,c.signal,async()=>{calls++;}), {name:'AbortError'});
    assert.equal(calls,0);
});
// Canvas rendering integration can run with the optional installed @napi-rs/canvas package.
let canvasPackage;
try { canvasPackage=require('@napi-rs/canvas'); } catch {}
test('renders, applies optional logo, exports real JPG and clears stale results', {skip:!canvasPackage}, async () => {
    const {createCanvas, Image}=canvasPackage;
    const elements=new Map();
    function element(name) {
        if (elements.has(name)) return elements.get(name);
        const e=name==='youtubePreview'?createCanvas(1,1):{};
        Object.assign(e,{value:'',checked:false,hidden:false,disabled:false,textContent:'',files:[],handlers:{},
            addEventListener(event,fn){this.handlers[event]=fn;},async emit(event){return this.handlers[event]?.({preventDefault(){}});}});
        elements.set(name,e); return e;
    }
    global.document={getElementById:element};
    const bg=createCanvas(1920,1080); bg.getContext('2d').fillStyle='blue'; bg.getContext('2d').fillRect(0,0,1920,1080);
    const logoCanvas=createCanvas(100,100); logoCanvas.getContext('2d').fillStyle='red'; logoCanvas.getContext('2d').fillRect(0,0,100,100);
    const logo=new Image(); logo.src=logoCanvas.toBuffer('image/png'); await logo.decode();
    global.Image=class {
        constructor(){this.naturalWidth=1920;this.naturalHeight=1080;}
        set src(value){if(value)queueMicrotask(()=>this.onload?.());}
    };
    element('youtubeOpacity').value='100'; element('youtubePosition').value='bottom-right'; element('youtubeLogoSource').value='ada';
    element('youtubeUrl').value=id;
    let saved;
    const tool=mount({maxSide:1280,scale:(_,w,h)=>{const c=createCanvas(w,h);c.getContext('2d').drawImage(bg,0,0,w,h);return c;},
        getLogo:()=>logo,quality:()=>0.9,filename:()=> 'cover.jpg',save:file=>{saved=file;}});
    const preview=element('youtubePreview');
    preview.toBlob=(callback,type,quality)=>callback(new Blob([preview.toBuffer('image/jpeg',quality*100)],{type}));
    await element('youtubeForm').emit('submit');
    assert.equal(preview.width,1280); assert.equal(preview.height,720); assert.equal(preview.hidden,false);
    assert.deepEqual([...preview.getContext('2d').getImageData(0,0,1,1).data], [0,0,0,255]);
    assert.deepEqual([...preview.getContext('2d').getImageData(1200,650,1,1).data], [0,0,255,255]);
    element('youtubeAddWatermark').checked=true; await tool.render();
    assert.deepEqual([...preview.getContext('2d').getImageData(1200,650,1,1).data], [255,0,0,255]);
    assert.deepEqual([...preview.getContext('2d').getImageData(1279,719,1,1).data], [0,0,0,255]);
    await element('youtubeDownload').emit('click');
    assert.equal(saved.type,'image/jpeg'); assert.equal(saved.name,'cover.jpg');
    const exported=new Image(); exported.src=Buffer.from(await saved.arrayBuffer()); await exported.decode();
    assert.equal(exported.width,1280); assert.equal(exported.height,720);
    element('youtubeUrl').value='invalid'; await element('youtubeUrl').emit('input');
    assert.equal(preview.hidden,true); assert.equal(element('youtubeDownload').disabled,true);
});
