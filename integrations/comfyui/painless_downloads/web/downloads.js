import { app } from '../../../scripts/app.js';
import { api } from '../../../scripts/api.js';

// ComfyUI frontend 1.58.5 passes URL, filename and logical model category to
// this host hook. Keep the normal missing-model buttons; do not scrape the DOM.
app.registerExtension({
  name: 'painless.modelDownloads',
  setup() {
    if (window.__comfyDesktop2) return; // Never replace a real desktop host.
    const active = new Map();
    const panel = document.createElement('section');
    panel.setAttribute('aria-label', 'Model downloads');
    Object.assign(panel.style, {position:'fixed',bottom:'20px',left:'20px',zIndex:'1000',maxWidth:'440px',padding:'12px',borderRadius:'8px',background:'var(--comfy-menu-bg, #222)',color:'var(--fg-color, #eee)',boxShadow:'0 2px 12px #0008',font:'13px sans-serif',display:'none'});
    document.body.append(panel);
    const rows = new Map();
    function show(name, message, finished=false) {
      panel.style.display='block';
      let row=rows.get(name);
      if (!row) { row=document.createElement('div');row.style.margin='6px 0';rows.set(name,row);panel.append(row); }
      row.replaceChildren();
      const label=document.createElement('span');label.textContent=`${name}: ${message}`;label.setAttribute('role','status');row.append(label);
      if(finished) { const close=document.createElement('button');close.textContent='Dismiss';close.style.marginLeft='8px';close.onclick=()=>{row.remove();rows.delete(name);if(!rows.size)panel.style.display='none';};row.append(close); }
    }
    async function downloadModel(url,name,directory) {
      const key=`${directory}/${name}`;
      if(active.has(key)) return active.get(key);
      const promise=(async()=>{
        try {
          show(name,'Queued');
          const response=await api.fetchApi('/painless/downloads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,name,directory})});
          if(!response.ok)throw new Error(await response.text());
          let job=await response.json();
          while(!['complete','error'].includes(job.status)) {
            show(name,job.status==='queued'?'Queued':job.total?`${Math.floor(job.received/job.total*100)}%`:`${Math.round(job.received/1048576)} MB`);
            await new Promise(resolve=>setTimeout(resolve,1000));
            const state=await api.fetchApi(`/painless/downloads/${job.id}`);
            if(!state.ok)throw new Error('Connection lost. Click Download again to resume.');
            job=await state.json();
          }
          if(job.status==='error')throw new Error(job.error);
          show(name,`Saved to ${directory}. Refresh model lists to use it.`,true);
          await app.refreshComboInNodes?.();
          return true;
        } catch(error) {
          show(name,`${error.message} Click Download to retry.`,true);
          return false;
        } finally {active.delete(key);}
      })();
      active.set(key,promise);
      return promise;
    }
    window.__comfyDesktop2 = { downloadModel };
  }
});
