import { DebugSession, TargetStopReason, EVENT_TARGET_STOPPED, IDebugSessionEvent } from './dbgmits';
import * as dbg from './dbgmits';
import { spawn, ChildProcess, exec, execSync } from 'child_process';
import * as vscode from 'vscode';
import { SIGINT, SIGQUIT } from 'constants';
import { promises, fstat } from 'fs';
import * as process from 'process';
import * as os from 'os';
import { getExtensionFilePath } from './util';
import path = require('path');
import { match } from 'assert';
import { LogLevel } from '@vscode/debugadapter/lib/logger';
import { IAttachRequestArguments, ILaunchRequestArguments } from './argments';

export declare class  BeyDbgSession extends DebugSession{
  constructor(miVersion: string);
  public startIt(args:ILaunchRequestArguments|IAttachRequestArguments):Promise<void>;
  public pause();
  public dbgexit();
  public attach(pid:number);
  public kill():Promise<void>;
  public waitForStart():Promise<void>;

}
export class BeyDbgSessionNormal extends DebugSession {

  private debuggerProcess?: ChildProcess;
  private target_pid?:number;
  private winbreakpath?:string;
  private major_version:number;
  private gdb_arch?:string;
  private is_win64:boolean=false;

  /**
   *
   */
  constructor(private miVersion: string = 'mi') {
    super();
    this.on(dbg.EVENT_THREAD_GROUP_STARTED,(e)=>{
      this.target_pid=Number.parseInt(e.pid);
      
    })
  }

  public async waitForStart(){
    return new Promise<void>((resolve,reject)=>{
      if(this.isStarted){
        resolve();
      }else{
        this.once(dbg.EVENT_SESSION_STARTED,()=>{
          resolve();
        });
        this.debuggerProcess.on('close',()=>{
          reject();
        });
      }     
    });
  }
  public async startIt(args:ILaunchRequestArguments|IAttachRequestArguments) {
    let debuggerArgs: string[] = args.debuggerArgs ? args.debuggerArgs : [];
    this.target_pid=null;
    const debuggerFilename = args.debuggerPath ? args.debuggerPath : 'gdb';
    
    debuggerArgs = debuggerArgs.concat(['--interpreter', this.miVersion]);
    this.debuggerProcess = spawn(debuggerFilename, debuggerArgs);
    let check_version=(out:string)=>{
      if(out.startsWith('GNU gdb')){
        let matchs=out.match(/\(GDB\).*?(\d+)/);
        if(matchs){
          this.major_version=Number.parseInt(matchs[1]);
        }
      }else if(out.startsWith('This GDB was configured as')){
        let matchs=out.match(/This GDB was configured as "(.*?)"/);
        if(matchs){
          this.gdb_arch=matchs[1];
          if(this.gdb_arch.startsWith('x86_64-w64')){
            this.is_win64=true;
            this.winbreakpath=getExtensionFilePath('bin/win/winbreak64.exe');
          }else{
            this.is_win64=false;
            this.winbreakpath=getExtensionFilePath('bin/win/winbreak32.exe');
          }

        }
        this.removeListener(dbg.EVENT_DBG_CONSOLE_OUTPUT,check_version);
      }
    }

    this.on(dbg.EVENT_DBG_CONSOLE_OUTPUT,check_version);
    this.start(this.debuggerProcess.stdout!, this.debuggerProcess.stdin!);

    if(process.platform==='win32'){
      
      await this.executeCommand('gdb-set new-console on',null);
    }else if (process.platform==='linux' || process.platform==='darwin'){
      this.winbreakpath=null;
      //create terminal and it's tty
      let tm=vscode.window.terminals.find((value,index,obj)=>{
        return value.name==='BeyondDebug';
      });
      if(!tm){
         tm=vscode.window.createTerminal({name: "BeyondDebug", shellPath: "/bin/cat", isTransient: true});
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
    return new Promise<void>((resolve, reject): void => {
      try {
        if(os.platform() === 'win32'){
          if(this.winbreakpath){
           
            let proc = spawn(path.basename(this.winbreakpath), [this.target_pid.toString()], { cwd: path.dirname(this.winbreakpath) });
            proc.on('close', (code) => {
              if(code==0){
                //this.emit(EVENT_TARGET_STOPPED);
                resolve();
              }else{
                reject();
              }
              
              //console.log(`child process exited with code ${code}`);
            });   
            //resolve();
          }else{
            process.kill(this.debuggerProcess.pid,"SIGINT");
          }
        }else{
          process.kill(this.debuggerProcess.pid,"SIGINT");
        }      
      } catch (error) {
        //this.logger.error("pause failure. "+this.debuggerProcess.toString()+error);
        reject();
      } 
      //resolve();
      this.once(EVENT_TARGET_STOPPED,(e)=>{
        resolve();
      });
    });
  }
  public kill():Promise<void>{
    return new Promise<void>((resolve, reject) => {
      try {
        process.kill(this.debuggerProcess.pid);
        resolve();
      } catch (error) {
        reject();
      } 
      //resolve();
      this.once(EVENT_TARGET_STOPPED,(e)=>{
        resolve();
      });
    });
  }
  startInferior(
    options?: { threadGroup?: string; stopAtStart?: boolean }): Promise<void> {
      if(options.stopAtStart){
        if(this.major_version>7){
          return this.execNativeCommand('starti');
        }
      }
      return super.startInferior(options);
  }
  public async dbgexit(){ 
    await this.end(true);
  }

  public async attach(pid:number){
    await this.targetAttach(pid);
    this.target_pid=pid;
  }
}