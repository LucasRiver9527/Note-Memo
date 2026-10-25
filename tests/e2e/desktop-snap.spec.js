const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const ROOT=path.resolve(__dirname,'../..');
test('V128-05C desktop snap: production hooks, exact physical preview, cancellation and persisted toggle',async()=>{
  test.skip(process.platform!=='win32','Windows native integration');
  const userData=await fs.mkdtemp(path.join(os.tmpdir(),'mynotes-snap-e2e-'));
  const version=require(path.join(ROOT,'package.json')).version;
  await fs.writeFile(path.join(userData,'notes-data.json'),JSON.stringify({notes:[{id:'snap-test',title:'Snap test',content:'Isolated note',x:40,y:40,w:300,h:240,color:'#93f1ce'}],groups:[],settings:{lastSeenVersion:version,desktopSnap:true,desktopMica:true}}));
  const packaged=process.env.MYNOTES_SNAP_PACKAGED_EXE;
  const app=await electron.launch({executablePath:packaged||undefined,cwd:ROOT,args:packaged?['--disable-gpu']:['.','--disable-gpu'],env:{...process.env,MYNOTES_USER_DATA:userData}});
  let nativeLogs=''; app.process().stderr.on('data',chunk=>{nativeLogs=(nativeLogs+chunk).slice(-4000);});
  try{
    const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(()=>typeof window.api?.pinToDesktop==='function' && typeof window.state==='object');
    await app.evaluate(({BrowserWindow,screen})=>{
      const d=screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      global.__snapCursor={x:d.workArea.x+300,y:d.workArea.y+300};
      screen.getCursorScreenPoint=()=>global.__snapCursor;
      const original=BrowserWindow.prototype.hookWindowMessage;
      global.__snapHooks=new Map();
      BrowserWindow.prototype.hookWindowMessage=function(id,fn){
        let hooks=global.__snapHooks.get(this.id);if(!hooks){hooks=new Map();global.__snapHooks.set(this.id,hooks);}hooks.set(id,fn);
        return original.call(this,id,fn);
      };
    });
    expect(await page.evaluate(()=>window.api.pinToDesktop('snap-test'))).toBe(true);
    await app.evaluate(({BrowserWindow,app})=>{
      const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');
      const path=require('path'),root=app.getAppPath();
      global.__snapNative=require(path.join(root,'desktop-snap-native.js'))();
      global.__snapNote=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('note.html'));
    });
    const drive=async(action)=>app.evaluate(async({BrowserWindow,screen},action)=>{
      const note=global.__snapNote,native=global.__snapNative,hooks=global.__snapHooks.get(note.id);
      const tick=()=>new Promise(r=>setImmediate(r));
      if(action==='begin'){
        const cursor=screen.getCursorScreenPoint(),d=screen.getDisplayNearestPoint(cursor);
        // Test-only cursor coordinates; no physical mouse input is generated.
        global.__snapDisplay=d;
        const b=native.physicalBounds(note),size={width:b.width,height:b.height};
        native.moveToPhysical(note,screen.dipToScreenPoint({x:d.workArea.x+200,y:d.workArea.y+200}));
        global.__snapStart=native.physicalBounds(note);hooks.get(0x0231)();note.emit('will-move');
        native.moveToPhysical(note,screen.dipToScreenPoint({x:d.workArea.x+200,y:Math.round(d.workArea.y+d.workArea.height-8-size.height/d.scaleFactor-9)}));note.emit('move');
        return size;
      }
      const preview=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('snap-preview.html'));
      if(action==='preview')return preview?{visible:preview.isVisible(),pixels:native.physicalBounds(preview),focused:preview.isFocused(),options:preview.webContents.getLastWebPreferences()}:null;
      if(action==='release')hooks.get(0x0232)();
      if(action==='escape'){native.moveToPhysical(note,global.__snapStart);hooks.get(0x0232)();}
      if(action==='resize'){note.emit('will-resize');hooks.get(0x0232)();}
      if(action==='screen-change'){screen.emit('display-metrics-changed',{},global.__snapDisplay,['workArea']);hooks.get(0x0232)();}
      if(action==='destroy'){note.suppressUnpin=true;note.destroy();}
      await tick();return {note:note.isDestroyed()?null:native.physicalBounds(note),start:global.__snapStart,previewVisible:preview&&!preview.isDestroyed()?preview.isVisible():false,previewDestroyed:!preview||preview.isDestroyed()};
    },action);
    await app.evaluate(({app})=>{
      const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json');
      const koffi=require('koffi'),user=koffi.load('user32.dll'),gdi=koffi.load('gdi32.dll'),dwm=koffi.load('dwmapi.dll');
      const create=gdi.func('void * __stdcall CreateRectRgn(int left,int top,int right,int bottom)');
      const read=user.func('int __stdcall GetWindowRgn(void *window,void *region)');
      const inside=gdi.func('bool __stdcall PtInRegion(void *region,int x,int y)');
      const box=gdi.func('int __stdcall GetRgnBox(void *region,void *rect)');
      const del=gdi.func('bool __stdcall DeleteObject(void *region)');
      const attr=dwm.func('int32_t __stdcall DwmGetWindowAttribute(void *window,uint32_t attribute,void *value,uint32_t length)');
      global.__readCorner=()=>{
        const w=global.__snapNote,buffer=w.getNativeWindowHandle(),handle=buffer.length===8?buffer.readBigUInt64LE():BigInt(buffer.readUInt32LE());
        const region=create(0,0,0,0),bounds=global.__snapNative.physicalBounds(w),rect=Buffer.alloc(16),material=Buffer.alloc(4);
        try{
          const kind=read(handle,region);box(region,rect);
          const result=attr(handle,38,material,4);
          const preference=Buffer.alloc(4);attr(handle,33,preference,4);
          return {kind,bounds,cornerPreference:preference.readUInt32LE(),cornerPoints:[[0,0],[bounds.width-1,0],[0,bounds.height-1],[bounds.width-1,bounds.height-1]].map(([x,y])=>inside(region,x,y)),center:inside(region,Math.floor(bounds.width/2),Math.floor(bounds.height/2)),regionWidth:rect.readInt32LE(8),regionHeight:rect.readInt32LE(12),material:result===0?material.readInt32LE():null};
        }finally{del(region);}
      };
    });
    const notePage=app.windows().find(p=>p.url().includes('note.html'));
    const originalSize=await app.evaluate(()=>global.__readCorner().bounds);
    for(const radius of [0,28,12]){
      await page.evaluate(radius=>{window.state.settings.noteRadius=radius;window.applyTheme();},radius);
      await expect.poll(async()=>await notePage.evaluate(()=>getComputedStyle(document.getElementById('note')).borderTopLeftRadius)).toBe('0px');
      const region=await app.evaluate(()=>global.__readCorner());
      expect(region.kind).toBe(0);expect(region.cornerPreference).toBe(radius===0?1:2);expect(region.material).toBe(3);
      expect(region.bounds.width).toBe(originalSize.width);expect(region.bounds.height).toBe(originalSize.height);
    }
    for(const size of [[420,280],[260,190]]){
      await app.evaluate((_,size)=>global.__snapNote.setSize(...size),size);
      // Windows may clamp the GDI region to the exact window edge (or retain +1).
      await expect.poll(async()=>await app.evaluate(()=>{const r=global.__readCorner();return r.kind===0&&r.cornerPreference===2;})).toBe(true);
    }
    for(const enabled of [false,true]){
      await page.evaluate(enabled=>{window.state.settings.desktopMica=enabled;window.applyTheme();},enabled);
      await expect.poll(async()=>await app.evaluate(()=>global.__readCorner().material)).toBe(enabled?3:1);
      expect((await app.evaluate(()=>global.__readCorner())).cornerPreference).toBe(2);
    }

    const size=await drive('begin');
    await expect.poll(async()=>{const p=await drive('preview');return p?.visible;}).toBe(true);
    const preview=await drive('preview');expect(preview.focused).toBe(false);expect(preview.options.nodeIntegration).toBe(false);expect(preview.options.preload).toBeUndefined();
    const landed=await drive('release');expect(landed.note).toEqual(preview.pixels);expect(landed.note.width).toBe(size.width);expect(landed.note.height).toBe(size.height);expect(landed.previewVisible).toBe(false);
    for(const action of ['escape','resize','screen-change']){
      await drive('begin');await expect.poll(async()=>{const p=await drive('preview');return p?.visible;}).toBe(true);
      const result=await drive(action);expect(result.previewVisible).toBe(false);if(action==='escape')expect(result.note).toEqual(result.start);
    }
    await drive('begin');await expect.poll(async()=>{const p=await drive('preview');return p?.visible;}).toBe(true);
    await page.evaluate(()=>{const el=document.getElementById('desktopSnapToggle');el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));});
    await expect.poll(async()=>{const p=await drive('preview');return p?.visible;}).toBe(false);
    await page.evaluate(()=>window.saveNow());
    expect((await page.evaluate(()=>window.api.loadData())).data.settings.desktopSnap).toBe(false);
    await drive('release');await drive('begin');expect((await drive('preview')).visible).toBe(false);
    const closed=await drive('destroy');expect(closed.previewDestroyed).toBe(true);
  }catch(error){console.error('Snap integration process status:',app.process().exitCode,app.process().signalCode,nativeLogs);throw error;}finally{await app.close().catch(()=>{});await fs.rm(userData,{recursive:true,force:true}).catch(()=>{});}
});
