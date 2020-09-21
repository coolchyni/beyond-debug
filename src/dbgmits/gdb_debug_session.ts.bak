// Copyright (c) 2015-2016 Vadim Macagon
// MIT License, see LICENSE file for full terms.

import DebugSession from './debug_session';
import * as Events from './events';
import * as pty from 'unix-pty';

/**
 * Uses a pseudo-terminal to forward target stdout when doing local debugging.
 *
 * GDB only forwards stdout from the target via async notifications when remote debugging,
 * when doing local debugging it expects the front-end to read the target stdout via a
 * pseudo-terminal. This distinction between remote/local debugging seems annoying, so when
 * debugging a local target this class automatically creates a pseudo-terminal, reads the target
 * stdout, and emits the text via [[EVENT_TARGET_OUTPUT]]. In this way the front-end using this
 * library doesn't have to bother creating pseudo-terminals when debugging local targets.
 */
export default class GDBDebugSession extends DebugSession {
  /** `true` if this is a remote debugging session. */
  private isRemote: boolean = false;
  /** Pseudo-terminal used in a local debugging session, not available if [[isRemote]] is `false`. */
  private terminal: pty.Terminal;

  end(notifyDebugger: boolean = true): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.terminal) {
        this.terminal.destroy();
        this.terminal = null;
      }
      resolve();
    })
    .then(() => super.end(notifyDebugger));
  }

  canEmitFunctionFinishedNotification(): boolean {
    return true;
  }

  connectToRemoteTarget(host: string, port: number): Promise<void> {
    return super.connectToRemoteTarget(host, port)
    .then(() => { this.isRemote = true; });
  }

  startInferior(options?: { threadGroup?: string; stopAtStart?: boolean }): Promise<void> {
    if (this.isRemote) {
      return super.startInferior(options);
    } else {
      return new Promise<void>((resolve, reject) => {
        if (this.terminal) {
          this.terminal.destroy();
          this.terminal = null;
        }
        const ptyModule: typeof pty = require('unix-pty');
        this.terminal = ptyModule.open();
        this.terminal.on('data', (data: string) => {
          this.emit(Events.EVENT_TARGET_OUTPUT, data);
        });
        resolve();
      })
      .then(() => this.setInferiorTerminal(this.terminal.pty))
      .then(() => super.startInferior(options));
    }
  }
}
