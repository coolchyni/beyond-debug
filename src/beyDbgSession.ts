import { DebugSession, TargetStopReason, EVENT_TARGET_STOPPED } from './dbgmits';

import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';
import { SIGINT } from 'constants';
import { promises } from 'fs';

export class BeyDbgSession extends DebugSession {

  private debuggerProcess?: ChildProcess;
  /**
   *
   */
  constructor(private miVersion: string = 'mi') {
    super();
  }


  public startIt(path?: string, args?: string[]) {
    let debuggerArgs: string[] = args ? args : [];

    const debuggerFilename = path ? path : 'gdb';

    debuggerArgs = debuggerArgs.concat(['--interpreter', this.miVersion]);
    this.debuggerProcess = spawn(debuggerFilename, debuggerArgs);
    this.start(this.debuggerProcess.stdout!, this.debuggerProcess.stdin!);

    this.debuggerProcess.on('error', (error: Error) => {
      vscode.debug.activeDebugConsole.appendLine(error.message);
      vscode.window.showErrorMessage(error.message);
      this.emit(EVENT_TARGET_STOPPED, { reason: TargetStopReason.Exited });
    });

    this.debuggerProcess.once('exit',
      () => {
        this.end(false);
      }
    );

  }

  public pause(){
    return new Promise<void>((resolve, reject) => {

      this.debuggerProcess.kill(SIGINT);
      this.once(EVENT_TARGET_STOPPED,(e)=>{
        resolve();
      });
    });
  }


}