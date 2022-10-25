import { DebugSession, EVENT_TARGET_STOPPED, IBreakpointInfo, TargetStopReason } from './dbgmits';
import * as dbg from './dbgmits';
import * as vscode from 'vscode';
import { readFileSync } from 'fs';
import * as os from 'os';
import path = require('path');
import {Client, ClientChannel, SFTPWrapper} from 'ssh2';
import { setExtractFullNameFunction } from './dbgmits/extractors';
import { ILaunchRequestArguments } from './argments';
import * as util from './util';
import * as crypto from "crypto";

const SSH_MAP_KEY='BY:';
const SSH_KEY_KEY='BY:SSHKEY';
var ssh_password:Map<string,string>=new Map<string,string>;

export class BeyDbgSessionSSH extends DebugSession {

  private major_version:number;
  private sshclient:Client;
  private clientChannel?:ClientChannel;
  private hostAddress?:string;
  private workspacepath:string;
  private passwordType:String;
  /**
   *
   */
  constructor(private miVersion: string = 'mi') {
    super();
    this.sshclient=new Client();
    this.on(dbg.EVENT_THREAD_GROUP_STARTED,(e)=>{
    });
    this.sshclient.on('error', () => {
      vscode.window.showErrorMessage('Fail to connect to '+this.hostAddress+'. ');
      if(this.hostAddress){
        ssh_password.delete(this.hostAddress);
        if(this.passwordType==='InputAndSave'){
          util.extensionContext.workspaceState.update(this.getHostKey(this.hostAddress),undefined);
        }
      }
      this.emit(EVENT_TARGET_STOPPED, { reason: TargetStopReason.Exited });
    });
  }
  private getAESIVandKey():[Buffer,Buffer]{
    let initVector:Buffer;
    let Securitykey:Buffer;
    let key=util.extensionContext.globalState.get<Buffer>(SSH_KEY_KEY);
    if(!key){
      // generate 16 bytes of random data
      initVector = crypto.randomBytes(16);

      Securitykey= crypto.randomBytes(32);
      key=Buffer.concat([initVector,Securitykey]);
      util.extensionContext.globalState.update(SSH_KEY_KEY,key);
    }else{
      initVector =Buffer.from(key).subarray(0,16);
      Securitykey= Buffer.from(key).subarray(16);
    }
    return [initVector,Securitykey];
  }
  private doEncrypt(message:string):string
  {
    try {
      const algorithm = "aes-256-cbc"; 

      let [initVector,Securitykey]= this.getAESIVandKey();

      // the cipher function
      const cipher = crypto.createCipheriv(algorithm, Securitykey, initVector);

      // encrypt the message
      // input encoding
      // output encoding
      let encryptedData = cipher.update(message, 'utf8','hex');

      encryptedData += cipher.final("hex");

      //console.log("Encrypted message: " + encryptedData);

      return encryptedData;
    } catch (error) {
      return "";
    }
    
  }
  private doDecrypt(message:string):string
  {
    try {
      const algorithm = "aes-256-cbc"; 
      let [initVector,Securitykey]= this.getAESIVandKey();
      // the cipher function
      const cipher = crypto.createDecipheriv(algorithm, Securitykey, initVector);
  
      // encrypt the message
      // input encoding
      // output encoding
      let decryptedData = cipher.update(message,'hex','utf8');
  
      decryptedData += cipher.final("utf8");
  
      //console.log("Decrypted message: " + decryptedData);
  
      return decryptedData;
    } catch (error) {
      return '';
    }
   
  }
  private getHostKey(addr:string):string{
    let md5=crypto.createHash('md5');
    let key=SSH_MAP_KEY+ md5.update(addr).digest('hex'); 
    return key;
  }
  private getPassword(address:string, withsave:boolean):string|null{
    let password=ssh_password.get(address);
    if(password){
      return this.doDecrypt(password);
    };
    if(withsave){
      let key=this.getHostKey(address);
      let password= util.extensionContext.workspaceState.get<string>(key);
      if(password){
        return this.doDecrypt(password);
      }
    }
    return null;
  }
  public async waitForStart():Promise<void>{ 
    return new Promise<void>((resolve,reject)=>{
      if(this.isStarted){
        resolve();
      }else{
        this.once(dbg.EVENT_SESSION_STARTED,()=>{
          resolve();
        });
        this.sshclient.on('close',()=>{
          reject();
        });
      }     
    });
  }
  public async startIt(args:ILaunchRequestArguments) {
    return new Promise<void>((resolve, reject): void => {
  
      this.workspacepath=vscode.workspace.workspaceFolders[0].uri.fsPath;
      if (args.ssh?.remoteSrcPrefix){
        let rdir=args.ssh.remoteSrcPrefix;
        let ldir=args.ssh.localSrcPrefix?args.ssh.localSrcPrefix:vscode.workspace.workspaceFolders[0].uri.path;
        setExtractFullNameFunction((input)=>{
          return input.replace(rdir,ldir);
        });
      }
  
      this.hostAddress=args.ssh.address;
     

      this.sshclient.on("close",()=>{
        this.logger.log('close');
        this.end();
        reject();
      }).on("ready",()=>{
        if (args.ssh.transfer) {
          this.sshclient.sftp((err: Error | undefined, sftp: SFTPWrapper)=>{
            for (const trans of args.ssh.transfer) {
              vscode.window.showInformationMessage(`uploading : ${trans.from}`,);
              this.emit(dbg.EVENT_DBG_CONSOLE_OUTPUT,`upload : ${trans.from}\n`);
              sftp.fastPut(trans.from,trans.to,{},(e)=>{
                vscode.window.showErrorMessage(e.message);
              });
            }
          });
        }
        
        this.sshclient.exec('gdb --interpreter mi',(error,channel)=>{
          this.clientChannel=channel;
          this.start(channel, channel);
          //this.emit('started');
          resolve();
        });
      }).on('error',()=>{
        //vscode.window.showErrorMessage(e.message);
        reject();
      });
      let address= args.ssh.address.split(':');
     
      let host=address[0];
      let port=22;
      if(address.length>1){
        try {
          port=Number.parseInt(address[1]);
        } catch (error) {
          vscode.window.showErrorMessage('Address for SSH is incorrect!');
          reject();
        }
      }
      let passtype=args.ssh.passwordType;
      this.passwordType=passtype;
      if(passtype.startsWith('Input')){
        let password=this.getPassword(args.ssh.address,passtype==='InputAndSave');
        if(password){
          this.sshclient.connect({host:host,port:port,username:args.ssh.username,password:password, timeout:args.ssh.timeout});          
          return ;
        }
        vscode.window.showInputBox({password:true,ignoreFocusOut:true,placeHolder:'password for ssh'})
        .then((v)=>{
          if(v==undefined){
            reject();
          }else{
            let p=this.doEncrypt(v);
            ssh_password.set(this.hostAddress,p);
            if(passtype==='InputAndSave'){              
              util.extensionContext.workspaceState.update(this.getHostKey(this.hostAddress),p);
            }
            this.sshclient.connect({host:host,port:port,username:args.ssh.username,password:v, timeout:args.ssh.timeout});
          }
        });
      }else{
        let pkey=args.ssh.privatekey;
        if(!pkey){
          pkey=path.join(os.homedir(),'.ssh', 'id_rsa');
        }
        
        this.sshclient.connect({host:host,port:port,username:args.ssh.username,privateKey:readFileSync(pkey), timeout:args.ssh.timeout});        
      }

      
     

    });

  }

  public pause(){
    return new Promise<void>((resolve, reject): void => {
      if(this.clientChannel){
        this.clientChannel.signal("SIGINT");
        resolve();
      }else{
        reject();
      }
      this.once(EVENT_TARGET_STOPPED,()=>{
        resolve();
      });
    });
  }
  public kill():Promise<void>{
    
    return new Promise<void>((resolve, reject) => {
      try {
        this.sshclient.end();
        resolve();
      } catch (error) {
        reject();
      } 
      //resolve();
      this.once("close",()=>{
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
    return this.kill();
  }

  public async attach(pid:number){
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
    
    location= location.replace(this.workspacepath+path.sep,'');
    return super.addBreakpoint(location,options);
  }

}