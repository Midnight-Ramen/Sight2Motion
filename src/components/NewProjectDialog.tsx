import { useEffect, useRef, useState } from 'react';
export function NewProjectDialog({onCreate,onClose}:{onCreate:(name:string)=>Promise<void>;onClose:()=>void}) {
  const [name,setName]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const form=useRef<HTMLFormElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    return()=>{if(previous?.isConnected)previous.focus();};
  },[]);
  return <div className="modal-backdrop"><form ref={form} className="modal" role="dialog" aria-modal="true" aria-labelledby="new-project-title"
    onKeyDown={event=>{
      if(event.key==='Escape'&&!busy){event.preventDefault();onClose();}
      if(event.key==='Tab'){
        const items=Array.from(form.current!.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)'));
        const first=items[0],last=items[items.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    }}
    onKeyUp={event=>{if(event.code==='Space'&&event.target instanceof HTMLButtonElement){event.preventDefault();if(!event.target.disabled)event.target.click();}}}
    onSubmit={async event=>{
      event.preventDefault();if(busy||!name.trim())return;
      setBusy(true);setError('');
      try{await onCreate(name.trim());}catch{setError('Could not create the project. Your current work has been kept.');setBusy(false);}
    }}>
    <h2 id="new-project-title">Create a new project?</h2>
    <label>Project name<input autoFocus required maxLength={100} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label>
    <div className="new-project-actions"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={busy||!name.trim()}>{busy?'Creating…':'Create project'}</button></div>
    {error&&<p role="alert">{error}</p>}
  </form></div>;
}
