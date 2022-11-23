import { DebugSession, EVENT_TARGET_STOPPED, IBreakpointInfo, TargetStopReason } from './dbgmits';
import * as dbg from './dbgmits';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import path = require('path');
import { Channel, Client, ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2';
import { setExtractFullNameFunction } from './dbgmits/extractors';
import { ILaunchRequestArguments } from './argments';
import * as util from './util';
import * as crypto from "crypto";
import { promisify } from 'util';
import { exec } from 'child_process';
import { throws } from 'assert';
import { Message } from '@vscode/debugadapter/lib/messages';

const SSH_MAP_KEY = 'BY:';
const SSH_KEY_KEY = 'BY:SSHKEY';
var ssh_clients: Map<string, BySSHClient> = new Map<string, BySSHClient>;
class SSHTerminal implements vscode.Pseudoterminal, vscode.TerminalExitStatus {

  constructor(private channel: Channel,public sshclient:BySSHClient) {
  
    this.channel.on("data", (buf: Buffer) => {
      this.writeEmitter.fire(buf.toString());
    });
    this.channel.on("close", () => {
      this.closeEmitter.fire(0);
    });
  }
  private writeEmitter = new vscode.EventEmitter<string>();
  onDidWrite: vscode.Event<string> = this.writeEmitter.event;
  private closeEmitter = new vscode.EventEmitter<number>();
  onDidClose: vscode.Event<number> = this.closeEmitter.event;

  code: number;
  reason: vscode.TerminalExitReason;

  onDidOverrideDimensions?: vscode.Event<vscode.TerminalDimensions>;
  onDidChangeName?: vscode.Event<string>;
  open(initialDimensions: vscode.TerminalDimensions): void {

  }
  close(): void {
    this.channel.close();
    //vscode.window.showInformationMessage("closed");
  }
  handleInput?(data: string): void {
    this.channel.stdin.write(data);
  }
  setDimensions?(dimensions: vscode.TerminalDimensions): void {
  }
}

class BySSHClient extends Client {
  private hostAddress?: string;
  private passwordType: String;
  public tty?: string;
  constructor() {
    super();
  }

  public async doConnect(args: ILaunchRequestArguments, is_shell = false): Promise<void> {
    return new Promise<void>((resolve, reject): void => {

      this.on("ready", () => {
        if (is_shell) {
          this.shell(async (err, channel) => {
            if (err) { return; }
            let pty = new SSHTerminal(channel,this);

            let tm = vscode.window.terminals.find((value, index, obj) => {
              return value.name === this.hostAddress;
            });
            if (!tm) {
              tm = vscode.window.createTerminal({ name: this.hostAddress,pty});
            }
            tm.show(true);
            let on_data = (buf: Buffer) => {
              if (buf.toString().startsWith("/dev/")) {
                this.tty = buf.toString().trim();
                channel.off("data", on_data);
                resolve();
              }
            };
            channel.on("data", on_data);
            channel.on("error", () => {
              reject();
            });
            channel.on("exit", () => {
              ssh_clients.delete(this.hostAddress);
              this.end();
            });
            channel.stdin.write("tty\n");

          });
        } else {
          resolve();
        }
      })


      this.once("error", (e) => {
        if (this.passwordType === 'inputandsave') {
          vscode.window.showErrorMessage('Fail to connect to ' + this.hostAddress + '. ' + e.message, 'Reset', 'Cancel')
            .then((value) => {
              if (value === 'Reset') {
                util.extensionContext.workspaceState.update(this.getHostKey(this.hostAddress), undefined);
              }
            })
        } else {
          vscode.window.showErrorMessage('Fail to connect to ' + this.hostAddress + '. ' + e.message);
        }
        reject();
      })

      this.hostAddress = args.ssh.address;
      let address = args.ssh.address.split(':');

      let host = address[0];
      let port = 22;
      if (address.length > 1) {
        try {
          port = Number.parseInt(address[1]);
        } catch (error) {
          vscode.window.showErrorMessage('Address for SSH is incorrect!');
          reject();
        }
      }
      let passtype = args.ssh.passwordType.toLowerCase();
      this.passwordType = passtype;
      if (passtype == 'plaintext') {
        this.connect({ host: host, port: port, username: args.ssh.username, password: args.ssh.password, timeout: args.ssh.timeout });
      } else if (passtype.startsWith('input')) {
        if (passtype === 'input') {
          util.extensionContext.workspaceState.update(this.getHostKey(this.hostAddress), undefined);
        }
        let password = this.getPassword(args.ssh.address, passtype === 'inputandsave');
        if (password) {
          this.connect({ host: host, port: port, username: args.ssh.username, password: password, timeout: args.ssh.timeout });
          return;
        }
        vscode.window.showInputBox({ password: true, ignoreFocusOut: true, placeHolder: 'password for ssh' })
          .then((v) => {
            if (v == undefined) {
              reject();
            } else {
              let p = this.doEncrypt(v);
              if (passtype === 'inputandsave') {
                util.extensionContext.workspaceState.update(this.getHostKey(this.hostAddress), p);
              }
              this.connect({ host: host, port: port, username: args.ssh.username, password: v, timeout: args.ssh.timeout });
            }
          });
      } else {
        let pkey = args.ssh.privatekey;
        if (!pkey) {
          pkey = path.join(os.homedir(), '.ssh', 'id_rsa');
        }
        this.connect({ host: host, port: port, username: args.ssh.username, privateKey: fs.readFileSync(pkey), timeout: args.ssh.timeout });
      }
    });

  }



  private getAESIVandKey(): [Buffer, Buffer] {
    let initVector: Buffer;
    let Securitykey: Buffer;
    let key = util.extensionContext.globalState.get<Buffer>(SSH_KEY_KEY);
    if (!key) {
      // generate 16 bytes of random data
      initVector = crypto.randomBytes(16);

      Securitykey = crypto.randomBytes(32);
      key = Buffer.concat([initVector, Securitykey]);
      util.extensionContext.globalState.update(SSH_KEY_KEY, key);
    } else {
      initVector = Buffer.from(key).subarray(0, 16);
      Securitykey = Buffer.from(key).subarray(16);
    }
    return [initVector, Securitykey];
  }
  private doEncrypt(message: string): string {
    try {
      const algorithm = "aes-256-cbc";

      let [initVector, Securitykey] = this.getAESIVandKey();

      // the cipher function
      const cipher = crypto.createCipheriv(algorithm, Securitykey, initVector);

      // encrypt the message
      // input encoding
      // output encoding
      let encryptedData = cipher.update(message, 'utf8', 'hex');

      encryptedData += cipher.final("hex");

      //console.log("Encrypted message: " + encryptedData);

      return encryptedData;
    } catch (error) {
      return "";
    }

  }
  private doDecrypt(message: string): string {
    try {
      const algorithm = "aes-256-cbc";
      let [initVector, Securitykey] = this.getAESIVandKey();
      // the cipher function
      const cipher = crypto.createDecipheriv(algorithm, Securitykey, initVector);

      // encrypt the message
      // input encoding
      // output encoding
      let decryptedData = cipher.update(message, 'hex', 'utf8');

      decryptedData += cipher.final("utf8");

      //console.log("Decrypted message: " + decryptedData);

      return decryptedData;
    } catch (error) {
      return '';
    }

  }
  private getHostKey(addr: string): string {
    let md5 = crypto.createHash('md5');
    let key = SSH_MAP_KEY + md5.update(addr).digest('hex');
    return key;
  }
  private getPassword(address: string, withsave: boolean): string | null {
    if (withsave) {
      let key = this.getHostKey(address);
      let password = util.extensionContext.workspaceState.get<string>(key);
      if (password) {
        return this.doDecrypt(password);
      }
    }
    return null;
  }
}

export class BeyDbgSessionSSH extends DebugSession {

  private major_version: number;
  private args: ILaunchRequestArguments;
  private sshclient: BySSHClient;
  private clientChannel?: ClientChannel;
  private hostAddress: string;
  private workspacepath: string;
  private passwordType: String;
  private prodess: vscode.TaskProcessEndEvent;
  /**
   *
   */
  constructor(private miVersion: string = 'mi') {
    super();
    this.sshclient = new BySSHClient();
    this.sshclient.on('error', (e) => {
      this.emit(EVENT_TARGET_STOPPED, { reason: TargetStopReason.Exited });
    });
  }

  public async waitForStart(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.isStarted) {
        resolve();
      } else {
        this.sshclient.once('ready',()=>{ resolve})
        this.once(dbg.EVENT_SESSION_STARTED, () => {
          resolve();
        });
        this.sshclient.once('error', () => {
          reject();
        });
      }
    });
  }

  public async startIt(args: ILaunchRequestArguments) {
    this.args = args;
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification
    }, this.doStartIt.bind(this));
    //vscode.window.showInformationMessage("started");
  }

  private async doStartIt(process: vscode.Progress<{ message?: string; increment?: number }>) {
    let key = this.args.ssh.address;
    if (!this.args.ssh.timeout) { this.args.ssh.timeout = 1000; }
    if (!this.args.ssh.passwordType) { this.args.ssh.passwordType = "none"; }
    this.hostAddress = this.args.ssh.address;
    let tm = vscode.window.terminals.find((value, index, obj) => {
      return value.name === this.hostAddress;
    });
    var tty = undefined;
    process.report({ message: `Connect to ${this.hostAddress}` });
    if (!tm) {
      let ssh = new BySSHClient();
      ssh.on('error', (e) => {
        this.emit('error', e);
        return new Promise<void>((_,reject)=>{return reject()});
      });
      await ssh.doConnect(this.args, true);
      if (!ssh.tty) {
        return new Promise<void>((resolve) => { return resolve() });
      }
      tty = ssh.tty;
    }else{
      let pty:SSHTerminal= (tm.creationOptions as vscode.ExtensionTerminalOptions).pty as SSHTerminal;
      tty=pty.sshclient.tty;

    }
    
    await this.sshclient.doConnect(this.args);
    return new Promise<void>((resolve, reject): void => {
      if (!tty) {
        //vscode.window.showErrorMessage("No TTY");
        reject();
      }
      this.workspacepath = vscode.workspace.workspaceFolders[0].uri.fsPath;
      if (this.args.ssh?.remoteSrcPrefix) {
        let rdir = this.args.ssh.remoteSrcPrefix;
        let ldir = this.args.ssh.localSrcPrefix ? this.args.ssh.localSrcPrefix : this.workspacepath;
        setExtractFullNameFunction((input) => {
          if(input.startsWith(rdir)){
            return input.replace(rdir, ldir);
          }else{
            return input;
          }
          
        });
      }
      if (this.args.ssh.transfer) {

        this.sshclient.sftp(async (err: Error | undefined, sftp: SFTPWrapper) => {
          for (const trans of this.args.ssh.transfer) {

            this.emit(dbg.EVENT_DBG_CONSOLE_OUTPUT, `upload : ${trans.from}\n`);

            let from = path.basename(trans.from);
            if (!fs.existsSync(trans.from)) {
              vscode.window.showErrorMessage(`File not exist. ${trans.from}`);
              reject();
              return;
            }
            var stat = fs.lstatSync(trans.from);
            var mode=stat.mode;
            var f_key = SSH_MAP_KEY + "file://" + trans.from;
            let is_same = await new Promise<boolean>((_resolve, _reject) => {
              sftp.stat(trans.to, (err, stats) => {
                if(stats){
                  mode=stats.mode;
                  if (stat.size = stats.size) {

                    let f_mtime = util.extensionContext.workspaceState.get<number>(f_key);
  
                    if (Math.abs(stat.mtimeMs - f_mtime) < Number.EPSILON) {
                      return _resolve(true);
                    }
                  }
                }else{
                  if(os.platform() === 'win32'){
                    if(this.args.program.endsWith( path.basename(trans.to)))
                    {
                      mode=755;
                    }
                  }
                }   
                return _resolve(false);
              });
            });
            if (!is_same) {
              let ret = await new Promise<boolean>((_resolve, _reject) => {
                sftp.fastPut(trans.from, trans.to, {
                  concurrency: 4, mode: mode, step: (total, nb, fsize) => {
                    process.report({ message: `upload ${from} ${(total / 1024).toFixed(2)}k / ${(fsize / 1024).toFixed(2)}k` });
                  }
                }, (e) => {
                  if (e) {
                    vscode.window.showErrorMessage(`upload fail: ${trans.to} ${e.message}`);
                    this.emit(dbg.EVENT_DBG_CONSOLE_OUTPUT, `upload fail: ${trans.to} ${e.message}\n`);
                    _reject(false);
                    return reject();
                  } else {
                    util.extensionContext.workspaceState.update(f_key, stat.mtimeMs);
                    this.emit(dbg.EVENT_DBG_CONSOLE_OUTPUT, `upload success: ${trans.to}\n`);
                    _resolve(true);
                  }
                });
              });
              if (!ret) {
                reject();
                return;
              }
            }


          }
          this.sshclient.exec(`gdb --interpreter mi`, (error, channel) => {
            this.clientChannel = channel;
            this.start(channel, channel);
            this.executeCommand(`inferior-tty-set ${tty}`);
            resolve();
          });
        });
      } else {
        this.sshclient.exec(`gdb --interpreter mi`, (error, channel) => {
          this.clientChannel = channel;
          this.start(channel, channel);
          this.executeCommand(`inferior-tty-set ${tty}`);
          resolve();
        });
      }

    });

  }

  public pause() {
    return new Promise<void>((resolve, reject): void => {
      if (this.clientChannel) {
        this.clientChannel.signal("SIGINT");
        resolve();
      } else {
        reject();
      }
      this.once(EVENT_TARGET_STOPPED, () => {
        resolve();
      });
    });
  }
  public kill(): Promise<void> {

    return new Promise<void>((resolve, reject) => {
      try {

        this.clientChannel.end();
        //this.sshclient.end();
        resolve();
      } catch (error) {
        reject();
      }
      //resolve();
      this.once("close", () => {
        resolve();
      });
    });
  }
  startInferior(
    options?: { threadGroup?: string; stopAtStart?: boolean }): Promise<void> {
    if (options.stopAtStart) {
      if (this.major_version > 7) {
        return this.execNativeCommand('starti');
      }
    }
    return super.startInferior(options);
  }
  public async dbgexit() {
    this.end();
    return this.kill();
  }

  public async attach(pid: number) {
    await this.targetAttach(pid);
  }


  public addBreakpoint(
    location: string,
    options?: {
      isTemp?: boolean;
      isHardware?: boolean;
      isPending?: boolean;
      isDisabled?: boolean;
      isTracepoint?: boolean;
      condition?: string;
      ignoreCount?: number;
      threadId?: number;
    }
  ): Promise<IBreakpointInfo> {

    location = location.replace(this.workspacepath + path.sep, '');
    return super.addBreakpoint(location, options);
  }

}