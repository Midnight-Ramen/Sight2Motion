import {createRoot} from 'react-dom/client';
import {useRef,useState} from 'react';
import {NumericInput} from '../../src/components/NumericInput';
function Fixture(){ const [value,setValue]=useState(30),[command,setCommand]=useState(0);const latest=useRef(value);latest.current=value;
 return <><NumericInput aria-label="Action value" value={value} min={0} max={100} onChange={e=>setValue(+e.target.value)}/>
 <button onPointerDown={e=>{e.currentTarget.focus();setCommand(latest.current);}}>Action</button><output>{command}</output></>; }
createRoot(document.getElementById('root')!).render(<Fixture/>);
