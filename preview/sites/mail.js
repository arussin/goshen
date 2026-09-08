/* Fictional UI only. No mail provider or account is used. */
let stressRun = null;
document.addEventListener('change',event=>{if(event.target.matches('tr.zA input[type="checkbox"]'))event.target.closest('tr').classList.toggle('x7',event.target.checked);});
document.addEventListener('click',event=>{if(event.target.closest('[data-mail-compose]'))document.querySelector('.mail-compose').hidden=false;if(event.target.closest('[data-mail-close]'))document.querySelector('.mail-compose').hidden=true;const link=event.target.closest('.TO a');if(link){document.querySelectorAll('.TO').forEach(n=>n.classList.remove('nZ'));link.closest('.TO').classList.add('nZ');}});
document.addEventListener('click',event=>{
  if(!event.target.closest('[data-mail-stress]'))return;
  stressRun={started:performance.now(),rows:document.querySelectorAll('tr.zA').length+500,completed:null};
  delete document.documentElement.dataset.qaStressMs;
  const fragment=document.createDocumentFragment();
  for(let index=0;index<500;index++){
    const row=document.createElement('tr');row.className=index%3?'zA yO':'zA zE';row.setAttribute('role','row');
    row.innerHTML='<td><input type="checkbox" aria-label="Select mock row"></td><td>Fictional sender</td><td>A synthetic performance test row</td><td><button aria-label="Mock row action"><svg viewBox="0 0 24 24" aria-hidden="true">'+Array.from({length:12},(_,n)=>`<path d="M${n+2} 4h1v16h-1z"/>`).join('')+'</svg></button></td>';
    fragment.append(row);
  }
  document.querySelector('tbody').append(fragment);
});
let healthAt=performance.now(),worstDelay=0,beats=0;
setInterval(()=>{
  const now=performance.now();worstDelay=Math.max(worstDelay,now-healthAt-250);healthAt=now;beats+=1;
  const metrics=globalThis.GoshenUniversal?.diagnostics?.();
  if(stressRun && stressRun.completed===null && metrics && !metrics.queuedRoots && !metrics.activeWalkers && !metrics.errors && document.querySelectorAll('tr.zA[data-gt-gmail-region]').length===stressRun.rows){
    stressRun.completed=Math.round(now-stressRun.started);
    document.documentElement.dataset.qaStressMs=String(stressRun.completed);
  }
  if(beats%4!==0)return;
  const output=document.querySelector('[data-mail-health]');
  if(!output)return;
  const scanner=metrics?` · theme: ${metrics.scanned} visits, ${metrics.queuedRoots} queued / ${metrics.activeWalkers} active, ${metrics.maxSliceMs} ms max slice, ${metrics.errors} errors`:'';
  const stress=stressRun?` · 500-row check: ${stressRun.completed===null?'in progress':stressRun.completed+' ms (250 ms sampling)'}`:'';
  output.textContent=`UI beats: ${beats} · largest delay: ${Math.round(worstDelay)} ms${scanner}${stress}`;
},250);
