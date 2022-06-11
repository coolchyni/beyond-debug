import * as vscode from 'vscode';
import { TextEncoder } from 'util';
import {BeyDebug} from './beyDebug';
import { BeyDbgSession } from './beyDbgSession';
import * as Events from './dbgmits/events';
import { exit } from 'process';

var currentDebugSession:BeyDbgSession;
export function setCurrentDebugSession(dbg:BeyDbgSession){
  currentDebugSession=dbg;
}
function memtextToUint8Array(memtext:string,mcount:number):any{
  let lines=memtext.split('\n');
  if(lines.length<1){
    return [0,undefined];
  }
  
  var buf=new Uint8Array(mcount);

  let headidx=lines[0].indexOf(':');
 
  let baseAddress= lines[0].substring(0,headidx);
  let  k=0;
  for (let i = 0; i < lines.length; i++) {
    const e = lines[i].substring(headidx+2).split('\t');
    
    for (let j = 0; j < e.length; j++) {

      buf[k]= Number.parseInt(e[j]); 
      k++;
    }    
  }
 
  
  return [baseAddress,buf];
}
export async function cmdViewMemoryWithHexEdit(te:vscode.TextEditor){

  let enc = new TextEncoder();
  let text=te.document.getText(te.selection);
  if(text.length===0){
    text=await vscode.window.showInputBox({prompt:'Please input memory address:'});
    if(text===undefined || text===''){ return ;}
  }
  let mcount=128;
  if(text.indexOf(':')>0){
    let lines= text.split(':');
    text=lines[0];
    mcount=Number.parseInt(lines[1]);
  }
  let memdata='';
  let dbg=currentDebugSession;
  let handleEvent=(data)=>{
    memdata=memdata+data;
  };
  dbg.addListener(Events.EVENT_DBG_CONSOLE_OUTPUT,handleEvent);
  
  await dbg.execNativeCommand('x/'+mcount+'xb '+text);
  let ext=vscode.extensions.getExtension('ms-vscode.hexeditor');
  if(ext===undefined) {return;}
  dbg.removeListener(Events.EVENT_DBG_CONSOLE_OUTPUT,handleEvent);
  let v=memtextToUint8Array(memdata,mcount);
  let baseAddress=v[0];
  let data=v[1];
  let newUri = vscode.Uri.parse('file:'+vscode.workspace.rootPath + '/.memory.hex?baseAddress='+baseAddress);

  vscode.workspace.fs.writeFile(newUri, data).then
    (
      () => vscode.commands.executeCommand("vscode.openWith", newUri, "hexEditor.hexedit", {viewColumn:2, preview: false })
    
    );
}
