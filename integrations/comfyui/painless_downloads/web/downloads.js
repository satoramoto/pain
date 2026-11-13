import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';

// Use the pinned frontend's folder-aware host hook, not DOM interception.
app.registerExtension({
  name: 'painless.modelDownloads',
  setup() {
    if (window.__comfyDesktop2) return;
    const host=document.createElement('section');
    host.setAttribute('aria-label','Model downloads');
    Object.assign(host.style,{position:'fixed',bottom:'20px',left:'20px',zIndex:'1000',maxWidth:'min(440px, calc(100vw - 40px))',color:'var(--fg-color, #eee)',font:'13px sans-serif'});
    const toggle=document.createElement('button');toggle.textContent='Downloads';toggle.setAttribute('aria-expanded','false');
    const panel=document.createElement('div');panel.hidden=true;
    Object.assign(panel.style,{marginBottom:'8px',padding:'12px',borderRadius:'8px',background:'var(--comfy-menu-bg, #222)',boxShadow:'0 2px 12px #0008',maxHeight:'60vh',overflowY:'auto'});
    const heading=document.createElement('strong');heading.textContent='Model downloads';
    const note=document.createElement('p');note.textContent='Downloads run in ComfyUI. Cancel keeps the partial file so you can resume later.';
    const error=document.createElement('p');error.setAttribute('role','alert');error.hidden=true;
    const list=document.createElement('div');
    panel.append(heading,note,error,list);host.append(panel,toggle);document.body.append(host);
    const rows=new Map(), dismissed=new Set(), refreshed=new Set();
    let loading=false;
    function open() {panel.hidden=false;toggle.setAttribute('aria-expanded','true');}
    toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));void refresh();};
    const size=bytes=>bytes>=1073741824?`${(bytes/1073741824).toFixed(1)} GB`:`${Math.round(bytes/1048576)} MB`;
    function fail(reason) {error.textContent=reason.message || String(reason);error.hidden=false;open();}
    async function request(path,options={}) {
      const result=await api.fetchApi(path,options);
      if(!result.ok)throw new Error(await result.text());
      return result.json();
    }
    async function act(path,method) {
      try {error.hidden=true;await request(path,{method});await refresh();}catch(reason){fail(reason);}
    }
    function button(label,action) {
      const button=document.createElement('button');button.textContent=label;button.style.marginRight='6px';button.onclick=action;return button;
    }
    function render(jobs) {
      const visible=jobs.filter(job=>!dismissed.has(job.id));
      toggle.textContent=`Downloads${visible.length?` (${visible.length})`:''}`;
      for(const [id,row] of rows)if(!visible.some(job=>job.id===id)){row.root.remove();rows.delete(id);}
      if(!visible.length){list.textContent='No downloads.';return;}
      if(!rows.size)list.replaceChildren();
      for(const job of visible) {
        let row=rows.get(job.id);
        if(!row){
          const root=document.createElement('div');root.style.cssText='padding:10px 0;border-top:1px solid #7776;overflow-wrap:anywhere';
          const name=document.createElement('div'),status=document.createElement('div'),controls=document.createElement('div');
          status.style.margin='6px 0';name.textContent=`${job.directory}/${job.name}`;
          root.append(name,status,controls);list.append(root);row={root,status,controls,state:''};rows.set(job.id,row);
        }
        const amount=job.total?`${size(job.received)} / ${size(job.total)}`:size(job.received);
        row.status.textContent=job.status==='downloading'?`Downloading · ${amount}`:job.status==='queued'?'Queued':job.status==='cancelling'?'Stopping…':job.status==='complete'?`Saved · ${amount}`:job.status==='error'?`Failed: ${job.error}`:`Stopped · ${amount} kept`;
        if(row.state!==job.status){
          row.state=job.status;row.controls.replaceChildren();
          if(['queued','downloading'].includes(job.status))row.controls.append(button('Cancel',()=>act(`/painless/downloads/${job.id}/cancel`,'POST')));
          if(['paused','error'].includes(job.status)){
            row.controls.append(button('Resume',()=>downloadModel(job.url,job.name,job.directory)));
            row.controls.append(button('Remove partial',()=>{
              row.controls.replaceChildren(button('Keep file',()=>{row.state='';void refresh();}),button('Delete partial file',()=>act(`/painless/downloads/${job.id}`,'DELETE')));
            }));
          }
          if(job.status==='complete')row.controls.append(button('Dismiss',()=>{dismissed.add(job.id);void refresh();}));
        }
        if(job.status==='complete'&&!refreshed.has(job.id)){refreshed.add(job.id);void app.refreshComboInNodes?.();}
      }
    }
    async function refresh() {
      if(loading)return;
      loading=true;
      try{render(await request('/painless/downloads'));}catch(reason){fail(reason);}finally{loading=false;}
    }
    async function downloadModel(url,name,directory) {
      open();error.hidden=true;
      try{
        const job=await request('/painless/downloads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,name,directory})});
        dismissed.delete(job.id);refreshed.delete(job.id);await refresh();return true;
      }catch(reason){fail(reason);return false;}
    }
    window.__comfyDesktop2={downloadModel};
    void refresh();setInterval(refresh,1500);
  }
});
