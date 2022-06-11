import { DebugSession, TargetStopReason, EVENT_TARGET_STOPPED } from './dbgmits';

import { spawn, ChildProcess, exec, execSync } from 'child_process';
import * as vscode from 'vscode';
import { SIGINT, SIGQUIT } from 'constants';
import { promises, fstat } from 'fs';
import { kill } from 'process';

export class BeyDbgSession extends DebugSession {

  private debuggerProcess?: ChildProcess;
  /**
   *
   */
  constructor(private miVersion: string = 'mi') {
    super();
  }


  public async startIt(path?: string, args?: string[]) {
    let debuggerArgs: string[] = args ? args : [];

    const debuggerFilename = path ? path : 'gdb';
    
    debuggerArgs = debuggerArgs.concat(['--interpreter', this.miVersion]);
    this.debuggerProcess = spawn(debuggerFilename, debuggerArgs);
    this.start(this.debuggerProcess.stdout!, this.debuggerProcess.stdin!);
    if(process.platform==='win32'){
      await this.executeCommand('gdb-set new-console on',null);
    }else if (process.platform==='linux' || process.platform==='darwin'){
      //create terminal and it's tty
      let tm=vscode.window.terminals.find((value,index,obj)=>{
        return value.name==='BeyondDebug';
      });
      if(!tm){
         tm=vscode.window.createTerminal('BeyondDebug');
      }
      tm.show(true);
      let pid=await tm.processId;
      var tty='/dev/pts/0';
      exec(`ps h -o tty -p ${pid}|tail -n 1`,(error, stdout, stderr)=>{
        if(!error){
          tty='/dev/'+stdout;
        }
        this.executeCommand(`inferior-tty-set ${tty}`);
      });
    }
    this.debuggerProcess.on('error', (error: Error) => {
      vscode.window.showErrorMessage(error.message);
      this.emit(EVENT_TARGET_STOPPED, { reason: TargetStopReason.Exited });
    });

    this.debuggerProcess.once('exit',
      () => {
        this.end(false);
      }
    );

    this.debuggerProcess.on('SIGINT',()=>{
      this.logger.log('process: SIGINT');
    });

  }

  public pause(){
    return new Promise<void>((resolve, reject) => {
      try {
        
        kill(this.debuggerProcess.pid,"SIGINT");
        // if(!){
        //     this.logger.error("Send SIGINT failue!");
        //   reject();  
        // }
      } catch (error) {
        this.logger.error(error);
        reject();
      } 
      this.once(EVENT_TARGET_STOPPED,(e)=>{
        resolve();
      });
    });
  }

  public async stop(){ 
    await this.end(true);
  }


}