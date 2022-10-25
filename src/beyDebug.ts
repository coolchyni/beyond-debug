/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {
	logger,
	InitializedEvent, TerminatedEvent, StoppedEvent, OutputEvent,
	ProgressStartEvent, ProgressUpdateEvent, ProgressEndEvent,
	Thread, StackFrame, Source, Handles, Breakpoint, DebugSession, ContinuedEvent
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import *  as dbg from './dbgmits';

import * as vscode from 'vscode';
import { BeyDbgSession, BeyDbgSessionNormal } from './beyDbgSession';
import { TerminalEscape, TE_Style } from './terminalEscape';
import { TargetStopReason, IVariableInfo, IStackFrameInfo, IWatchInfo, IThreadInfo } from './dbgmits';
import * as iconv from 'iconv-lite';
import {showQuickPick} from './attachQuickPick';
import {NativeAttachItemsProviderFactory} from './nativeAttach';
import { AttachItemsProvider } from './attachToProcess';
import path = require('path');
import { BeyDbgSessionSSH } from './beyDbgSessionSSH';
import { ILaunchRequestArguments,IAttachRequestArguments } from './argments';

function timeout(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function isFrameSame(f1?: IStackFrameInfo, f2?: IStackFrameInfo) {
	return (f1?.level === f2?.level) && (f1?.fullname === f2?.fullname) && (f1?.func === f2?.func);
}
enum EMsgType {
	info,	//black
	error,
	alert,
	info2,
	info3,
}
const EVENT_CONFIG_DOWN='configdown';

export class BeyDebug extends DebugSession {

	private _variableHandles = new Handles<string>();

	private _configurationDone:boolean = false;

	private _cancelationTokens = new Map<number, boolean>();
	private _isRunning = false;
	private _isAttached = false;


	private _progressId = 10000;
	private _cancelledProgressId: string | undefined = undefined;
	private _isProgressCancellable = true;

	private _breakPoints = new Map<string, DebugProtocol.Breakpoint[]>();

	private _locals: { frame?: IStackFrameInfo, vars: IVariableInfo[], watch: IWatchInfo[] } = { frame: null, vars: [], watch: [] };

	private _watchs: Map<string, IWatchInfo> = new Map();

	private _currentFrameLevel = 0;
	private _currentThreadId?: IThreadInfo;

	private dbgSession: BeyDbgSession;

	private varUpperCase:boolean=false;

	//current language  of debugged program
	private language:string;

	//default charset 
	private defaultStringCharset?:string;
	

	private sendMsgToDebugConsole(msg: string, itype: EMsgType = EMsgType.info) {
		let style = [TE_Style.Blue];
		// todo:vscode.window.activeColorTheme.kind is proposed-api in low version 
		// if (vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark) {

		// 	style = [TE_Style.BrightWhite];
		// 	switch (itype) {
		// 		case EMsgType.error:
		// 			style = [TE_Style.Red];
		// 			break;
		// 		case EMsgType.info2:
		// 			style = [TE_Style.Blue];
		// 		case EMsgType.alert:
		// 			style = [TE_Style.Yellow];
		// 		default:
		// 			break;
		// 	}
		// } else {
		//	style = [TE_Style.Black];

			switch (itype) {
				case EMsgType.error:
					style = [TE_Style.Red];
					break;
				case EMsgType.info2:
					style = [TE_Style.Blue];
				case EMsgType.alert:
					style = [TE_Style.Yellow];
				default:
					break;
			}
		//}

		this.sendEvent(new OutputEvent(TerminalEscape.apply({ msg: msg, style: style })));
		
	}

	private waitForConfingureDone():Promise<void>{
		return new Promise<void>((resolve,reject)=>{
			if(this._configurationDone){
				resolve();
			}else{
				this.once(EVENT_CONFIG_DOWN,()=>{
					resolve();
				});
				if(this._configurationDone){
					resolve();
				}
			}
		});
	}
	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor() {
		super(true);
	}
	private initDbSession(is_ssh:boolean){
		if(is_ssh){
			this.dbgSession = new BeyDbgSessionSSH('mi3');
		}else{
			this.dbgSession=new BeyDbgSessionNormal('mi3');
		}
		// this debugger uses zero-based lines and columns
		this.setDebuggerLinesStartAt1(true);
		this.setDebuggerColumnsStartAt1(true);

		this.dbgSession.on(dbg.EVENT_SIGNAL_RECEIVED, (e: dbg.ISignalReceivedEvent) => {
			logger.log(e.reason.toString());
		});
		this.dbgSession.on(dbg.EVENT_DBG_CONSOLE_OUTPUT, (out: string) => {
			this.sendMsgToDebugConsole(out);
		});
		// this.dbgSession.on(dbg.EVENT_DBG_LOG_OUTPUT,(out: string) => {
		// 	this.sendMsgToDebugConsole(out,EMsgType.info2);
		// });
		this.dbgSession.on(dbg.EVENT_TARGET_RUNNING, (out) => {
			this._isRunning = true;
			logger.log(out);
		});
		this.dbgSession.on(dbg.EVENT_TARGET_STOPPED, (e: dbg.ITargetStoppedEvent) => {
			logger.log("stoped:" + e.reason.toString());
			this._isRunning = false;
			this._variableHandles.reset();

			
			switch (e.reason) {
					
				/** A breakpoint was hit. */
				case TargetStopReason.BreakpointHit:
				/** A step instruction finished. */
				case TargetStopReason.EndSteppingRange:
				/** A step-out instruction finished. */
				case TargetStopReason.FunctionFinished:	
				/** The target was signalled. */
				case TargetStopReason.SignalReceived:
				/** The target encountered an exception (this is LLDB specific). */
				case TargetStopReason.ExceptionReceived:
					break;



				/** An inferior terminated because it received a signal. */
				case TargetStopReason.ExitedSignalled:
				/** An inferior terminated (for some reason, check exitCode for clues). */
				case TargetStopReason.Exited:
				/** The target finished executing and terminated normally. */
				case TargetStopReason.ExitedNormally:
					this.sendEvent(new TerminatedEvent(false));
					break;
								
				/** Catch-all for any of the other numerous reasons. */
				case TargetStopReason.Unrecognized:
				default:
					this.sendEvent(new StoppedEvent('Unrecognized', e.threadId));
			}

		});

		//'step', 'breakpoint', 'exception', 'pause', 'entry', 'goto', 'function breakpoint', 'data breakpoint', 'instruction breakpoint'
		this.dbgSession.on(dbg.EVENT_BREAKPOINT_HIT, (e: dbg.IBreakpointHitEvent) => {
			this.sendEvent(new StoppedEvent('breakpoint', e.threadId));
		});
		this.dbgSession.on(dbg.EVENT_STEP_FINISHED, (e: dbg.IStepFinishedEvent) => {
			this.sendEvent(new StoppedEvent('step', e.threadId));
		});
		this.dbgSession.on(dbg.EVENT_FUNCTION_FINISHED, (e: dbg.IStepOutFinishedEvent) => {
			this.sendEvent(new StoppedEvent('function breakpoint', e.threadId));
		});
		this.dbgSession.on(dbg.EVENT_SIGNAL_RECEIVED, (e: dbg.ISignalReceivedEvent) => {
			logger.log('signal_receive:'+e.signalCode);
			let event=new StoppedEvent('signal', e.threadId,e.signalMeaning);
			event.body['text']=e.signalMeaning;
			event.body['description']=e.signalMeaning;
			this.sendEvent(event);
		});
		this.dbgSession.on(dbg.EVENT_EXCEPTION_RECEIVED, (e: dbg.IExceptionReceivedEvent) => {
			this.sendEvent(new StoppedEvent('exception', e.threadId,e.exception));
		});

	}
	private decodeString(value?:string,expressionType?:string):string{

		if (expressionType===undefined){
			return '';
		}
		if (this.defaultStringCharset){
			switch (this.language) {
				case 'c++':
					if(expressionType.endsWith('char *') ){
						let val=value;
						
						val=val.replace(/\\(\d+)/g,(s,args)=>{
							let num= parseInt( args,8);
							return String.fromCharCode(num);
						});
						if (val.endsWith("'")){
							val=val.substring(0,val.length-1);
						}

						let bf=val.split('').map((e)=>{return e.charCodeAt(0);});

						return iconv.decode(Buffer.from(bf),this.defaultStringCharset);
					}
					break;
				case 'pascal':
					if(expressionType==='ANSISTRING'){
						let val=value;
						//remove '' from str
						const regexp = /'(.*?)(?<!')'(?!')/g;
						val=val.replace(regexp,(a,b)=>{return b;}).replace(/''/g,"'");

						val=val.replace(/#(\d+)/g,(s,args)=>{
							let num= parseInt( args,10);
							return String.fromCharCode(num);
						});

						let bf=val.split('').map((e)=>{return e.charCodeAt(0);});
						return iconv.decode(Buffer.from(bf),this.defaultStringCharset);
					}
					break;
				default:
					break;
			}
			

		} 
		return value;
		
	}
	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {



		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDoneRequest.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code to use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = true;

		// make VS Code to show a 'step back' button
		response.body.supportsStepBack = false;

		// make VS Code to support data breakpoints
		response.body.supportsDataBreakpoints = true;

		// make VS Code to support completion in REPL
		//todo 
		response.body.supportsCompletionsRequest = false;
		response.body.completionTriggerCharacters = [".", "["];

		// make VS Code to send cancelRequests
		response.body.supportsCancelRequest = false;

		// make VS Code send the breakpointLocations request
		response.body.supportsBreakpointLocationsRequest = false;

		// make VS Code provide "Step in Target" functionality
		response.body.supportsStepInTargetsRequest = false;

		response.body.supportsTerminateThreadsRequest = true;

		
		response.body.supportsSetVariable=true;
		response.body.supportsSetExpression=true;
		response.body.supportsClipboardContext=true;
		
		response.body.supportsReadMemoryRequest = true;
		//todo
		response.body.supportsExceptionInfoRequest=false;

		this.sendResponse(response);

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());
	}

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);
		this._configurationDone=true;
		this.emit(EVENT_CONFIG_DOWN);
		//notify the launchRequest that configuration has finished

	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: ILaunchRequestArguments) {

		this.initDbSession(args.ssh?true:false);
		vscode.commands.executeCommand('workbench.panel.repl.view.focus');
		this.defaultStringCharset=args.defaultStringCharset;

		// make sure to 'Stop' the buffered logging if 'trace' is not set

		// wait until configuration has finished (and configurationDoneRequest has been called)
		try {
			await this.dbgSession.startIt(args);
			await this.waitForConfingureDone();
			//must wait for configure done. It will get error args without this.
			//await this._startDone.wait(2000);
			await this.dbgSession.waitForStart();	
		} catch (error) {
			this.sendEvent(new TerminatedEvent(false));
			this.sendErrorResponse(response,500);
		}		
		

		//await this.dbgSession.execNativeCommand('-gdb-set mi-async on');
		if (args.cwd) {
			await this.dbgSession.environmentCd(args.cwd);
		}
		this.varUpperCase=args.varUpperCase;
		if (args.commandsBeforeExec){
			for  (const cmd of args.commandsBeforeExec) {
				await this.dbgSession.execNativeCommand(cmd)
				.catch((e)=>{
					this.sendMsgToDebugConsole(e.message,EMsgType.error);
				});
			}
		}
		// start the program 
		let ret = await this.dbgSession.setExecutableFile(args.program).catch((e) => {

			vscode.window.showErrorMessage("Failed to start the debugger." + e.message);
			this.sendEvent(new TerminatedEvent(false));

			this.sendMsgToDebugConsole(e.message, EMsgType.error);

			return 1;
		});
		if (ret > 0) {
			return;
		}

		//set programArgs
		if(args.programArgs){
			await this.dbgSession.setInferiorArguments(args.programArgs);
		}

		if (args.remote?.enabled) {
			if (!args.remote.address) {
				vscode.window.showErrorMessage("Invalid remote addr.");
			}
			let mode: string = args.remote.mode === undefined ? 'remote' : args.remote.mode;
			if (mode === 'remote') {
				let result = await this.dbgSession.connectToRemoteTargetEx(args.remote.address).catch((e) => {
					this.sendMsgToDebugConsole(e.message, EMsgType.error);
					vscode.window.showErrorMessage(e.message);
					return 1;
				});
				if (result > 0) {
					this.sendEvent(new TerminatedEvent(false));
					return;
				}
				this.dbgSession.resumeInferior();
				this.sendResponse(response);
				return;

			} else if (mode === 'extended-remote') {
				let result = await this.dbgSession.connectToRemoteTargetEx(args.remote.address, mode).catch((e) => {
					this.sendMsgToDebugConsole(e.message, EMsgType.error);
					vscode.window.showErrorMessage(e.message);
					return 1;
				});
				if (result > 0) {
					this.sendEvent(new TerminatedEvent(false));
					return;
				}
				if (args.remote.transfer) {
					this.sendMsgToDebugConsole("\n");
					for (const trans of args.remote.transfer) {

						let id = "put" + trans.from;
						const startEvent: DebugProtocol.ProgressStartEvent = new ProgressStartEvent(id, `upload ${trans.from}`);
						startEvent.body.cancellable = false;
						this.sendEvent(startEvent);
						this.sendMsgToDebugConsole(`uploading : ${trans.from}\n`, EMsgType.info2);

						let endMessage = '`file uploaded : ${trans.from}';



						await this.dbgSession.targetFilePut(trans.from, trans.to).catch((e) => {
							vscode.window.showErrorMessage(e.message);
							this.sendEvent(new ProgressEndEvent(id, e.message));
						}).then(() => {
							this.sendMsgToDebugConsole(`file uploaded : ${trans.from}\n`, EMsgType.info2);
							this.sendEvent(new ProgressEndEvent(id, endMessage));
						}
						);
					}
				}


				let execfile = args.remote.execfile ? args.remote.execfile : args.program;
				await this.dbgSession.execNativeCommand(`set remote exec-file ${execfile}`).catch((e) => {
					vscode.window.showErrorMessage("Failed to start the debugger." + e.message);
					this.sendEvent(new TerminatedEvent(false));
					return 1;
				});;

			} else {
				vscode.window.showErrorMessage('Invalid remote mode.');
				this.sendEvent(new TerminatedEvent(false));
				return;

			}


		}
		
		let checklang=(out:string)=>
		{
			if (out.indexOf('language')>0)
			{
				let m=out.match('currently (.*)?"') ;
				if ( m!==null){
					this.language=m[1];
				}
				this.dbgSession.off(dbg.EVENT_DBG_CONSOLE_OUTPUT,checklang);
			}	
		};
		this.dbgSession.on(dbg.EVENT_DBG_CONSOLE_OUTPUT,checklang);

		await this.dbgSession.execNativeCommand('show language');

		await this.dbgSession.startInferior({stopAtStart: args.stopAtEntry}).catch((e) => {
			this.sendMsgToDebugConsole(e.message, EMsgType.error);
			vscode.window.showErrorMessage("Failed to start the debugger." + e.message);
			this.sendEvent(new TerminatedEvent(false));
		});
		this.sendResponse(response);
	}

	protected async attachRequest(response: DebugProtocol.AttachResponse, args: IAttachRequestArguments) {

		this.initDbSession(false);
			//const attacher: AttachPicker = new AttachPicker(attachItemsProvider);
			
			
			// let s=await showQuickPick(()=>{
			// 	return attachItemsProvider.getAttachItems();
			// });
		

	   
		//let s=await attacher.ShowAttachEntries();
		//let prov= NativeAttachItemsProviderFactory.Get();
		//let result=await showQuickPick(prov.getAttachItems);

		vscode.commands.executeCommand('workbench.panel.repl.view.focus');
		this.defaultStringCharset=args.defaultStringCharset;
		
		// wait until configuration has finished (and configurationDoneRequest has been called)
		this.dbgSession.startIt(args);
		await this.waitForConfingureDone();
		//must wait for configure done. It will get error args without this.
		await this.dbgSession.waitForStart();
		//await this.dbgSession.execNativeCommand('-gdb-set mi-async on');
		if (args.cwd) {
			await this.dbgSession.environmentCd(args.cwd);
		}
		this.varUpperCase=args.varUpperCase;
		if (args.commandsBeforeExec){
			for (const  cmd of args.commandsBeforeExec) {
				await this.dbgSession.execNativeCommand(cmd).catch((e)=>{
					this.sendMsgToDebugConsole(e.message,EMsgType.error);
				});
			}
		}

		const attachItemsProvider: AttachItemsProvider = NativeAttachItemsProviderFactory.Get();
		
		
		let plist=await attachItemsProvider.getAttachItems();
		if(args.program){
			let pname=args.program;
			if(args.program.match(/[\\/]/)){
				pname=path.resolve(args.program);
			}
			//let pname=path.basename(args.program);

			plist=plist.filter(
				item=>{
					return (args.processId && item.id==args.processId.toString())||
					(item.detail && item.detail.toLowerCase().indexOf(pname)>-1)
				}
			);
			if(plist.length==0){
				//vscode.window.showErrorMessage(`parogam ${args.program} not found.`);
				this.sendErrorResponse(response,0,`parogam ${args.program} not found.`);
				return;
			}
		}
		if(plist.length==1){
			let pid=plist[0].id;
			args.processId=Number.parseInt(pid);

		}else if(plist.length>1){
			try {
				let pid=await showQuickPick(async  ()=>{return plist;} );
				args.processId=Number.parseInt(pid);
			} catch (error) {
				this.sendErrorResponse(response,0,(error as Error).message);
				return;
			}
			
			
		}

		try {
			await this.dbgSession.attach(args.processId);
		} catch (error) {
			
			//vscode.window.showErrorMessage();
			response.success=false;
			response.command='cancelled';
			response.message='Attach fail. '+(error as Error).message;

			this.sendResponse(response);
			return;
		}
	 	
		await this.dbgSession.resumeInferior();
		this._isAttached=true;
		this.sendResponse(response);
	}

	protected async  pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments, request?: DebugProtocol.Request): Promise<void> {

		await this.dbgSession.pause();
	
		logger.log('pause');
		this.sendResponse(response);

	}


	protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {

		//wait for gdb start
		await this.dbgSession.waitForStart();

		let isPause = false;
		if (this._isRunning) {
			await this.dbgSession.pause();
			isPause = true;
		}
		
		let srcpath = args.source.path as string;
		srcpath=path.normalize(srcpath);
		

		if (this._breakPoints.has(srcpath)) {
			let bps: number[] = [];

			this._breakPoints.get(srcpath).forEach((e) => {
				bps.push(e.id);
			});
			this._breakPoints.set(srcpath, []);
			this.dbgSession.removeBreakpoints(bps);

		}

		const clientLines = args.breakpoints || [];
		const actualBreakpoints = await Promise.all(clientLines.map(async l => {
			let bk = await this.dbgSession.addBreakpoint(srcpath + ":" + this.convertClientLineToDebugger(l.line), {
				isPending: true,
				condition: l.condition
			});
			//console.log(bk);
			const bp = new Breakpoint(false, this.convertDebuggerLineToClient(l.line)) as DebugProtocol.Breakpoint;
			bp.source = args.source;
			bp.verified = true;
			bp.id = bk.id;
			return bp;
		}));
		this._breakPoints.set(srcpath, actualBreakpoints);
		if (isPause) {
			this.dbgSession.resumeAllInferiors(false);
		}
		response.body = {
			breakpoints: actualBreakpoints
		};
		this.sendResponse(response);

	}

	protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {


		if (args.source.path) {
			response.body = {
				breakpoints: []
			};
		} else {
			response.body = {
				breakpoints: []
			};
		}
		this.sendResponse(response);
	}

	protected async threadsRequest(response: DebugProtocol.ThreadsResponse): Promise<void> {

		let threads: Thread[] = [];
		let r = await this.dbgSession.getThreads();
		this._currentThreadId = r.current;
		let idtype=0;
		if(r.current){
			if(r.current.targetId.startsWith('LWP')){
				idtype=1;
			}else if(r.current.targetId.startsWith('Thread')){
				idtype=2;
			}
		}
		r.all.forEach((th) => {
			if(idtype==1){
				let ids=th.targetId.split(' ');
				let tid=Number.parseInt(ids[1]);
				threads.push(new Thread(th.id, `Thread #${tid}`));
		
			}else if(idtype==2){
				let ids=th.targetId.split('.');
				let tid=Number.parseInt(ids[1]);
				threads.push(new Thread(th.id, `Thread #${tid} ${th.name?th.name:''}`));
			}else{
				threads.push(new Thread(th.id, th.targetId));
			}
			
		});
		response.body = {
			threads: threads
		};
		this.sendResponse(response);

	}

	protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): Promise<void> {

		const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
		const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
		const endFrame = startFrame + maxLevels;

		const frames = await this.dbgSession.getStackFrames({ lowFrame: startFrame, highFrame: endFrame });

		//remove watchs 
		for (const watch of this._watchs) {
			await this.dbgSession.removeWatch(watch[1].id).catch(() => { });;
		}
		this._watchs.clear();

		response.body = {
			stackFrames: frames.map(f => {
				return new StackFrame(f.level, f.func, f.filename ? new Source(f.filename!, f.fullname) : null, this.convertDebuggerLineToClient(f.line!));
			}),
			totalFrames: frames.length
		};
		this.sendResponse(response);
	}

	protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments) {

		this._currentFrameLevel = args.frameId;


		response.body = {
			scopes: [
				{
					name: "Locals",
					presentationHint:"locals",
					variablesReference: this._variableHandles.create("locals::"),
					expensive: false
				},
			]
		};
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request) {

		const variables: DebugProtocol.Variable[] = [];

		const id = this._variableHandles.get(args.variablesReference);


		if (id === 'locals::') {
			for (const w of this._locals.watch) {
				await this.dbgSession.removeWatch(w.id).catch(() => { });
			}
			this._locals.watch=[];
			let vals = await this.dbgSession.getStackFrameVariables(dbg.VariableDetailLevel.Simple, {
				frameLevel: this._currentFrameLevel,
				threadId: this._currentThreadId?.id
			});
			this._locals.vars = vals.args.concat(vals.locals);

			for (const v of this._locals.vars) {

				let c = await this.dbgSession.addWatch(v.name, {
					frameLevel: this._currentFrameLevel,
					threadId: this._currentThreadId?.id
				}).catch(() => {

				});
				if (!c) {
					continue;
				}
				
				this._locals.watch.push(c);

				let vid = 0;
				if (c.childCount > 0) {
				  vid = this._variableHandles.create(c.id);
				}
				;
				variables.push({
					name: v.name,
					type: c.expressionType,
					value: this.decodeString(c.value,c.expressionType),
					variablesReference: vid
				});

			}

		} else {
		
			if(id.startsWith('**FLIST**')){  //pascal TStringList
				let vid=id.replace('**FLIST**','');
				let strs=vid.split(':');
				let cnt=strs[strs.length-1];
				
				for(var i=0;i<Number.parseInt(cnt);i++){
					let exp=strs[0]+'.FLIST^['+i+']';
					let val=await this.dbgSession.evaluateExpression(exp);
					let m=val.match(/'(.*?)'/);
					if(m!=null){
						val=m[1];
					}
					if(i>100){
						variables.push({
							name: '[.]',
							type: 'string',
							value: '...',
							variablesReference: 0
						});
						break;
					}else{
						variables.push({
							name: '['+i+']',
							type: 'string',
							value: this.decodeString(val,'ANSISTRING'),
							variablesReference: 0
						});
					}
					
				}

			  //let s=await	this.dbgSession.evaluateExpression(id.replace('**items**',''));
			}else
			{
				let childs = await this.dbgSession.getWatchChildren(id, { detail: dbg.VariableDetailLevel.All }).catch((e) => {
					return [];
				});
				for (const c of childs) {
					let vid = 0;
					if(this.language=='pascal'){
						if(c.expressionType=='PSTRINGITEMLIST' || c.expressionType=='TANSISTRINGITEMLIST'){ //for pascal TStringList
							let exp= await this.dbgSession.getWatchExpression(id);
							let cnt=await this.dbgSession.getWatchValue(id+'.FCOUNT');
							exp=exp.replace('->','.');
							vid = this._variableHandles.create('**FLIST**'+exp+':'+cnt);
							variables.push({
								name:'Strings',
								type:'array',
								value:'Strings['+cnt+']',
								variablesReference:vid
								//evaluateName:id+'.FLIST^[0]'
							});
							continue;
						 }
					}
					
					if (c.childCount > 0) {
					   vid = this._variableHandles.create(c.id);
					}
				   
				   variables.push({
					   name: c.expression,
					   type: c.expressionType,
					   value: this.decodeString(c.value,c.expressionType),
					   variablesReference: vid
				   });
   
			   }
			}
			
		}

		response.body = {
			variables: variables
		};
		this.sendResponse(response);
	}
	protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments, request?: DebugProtocol.Request)
    {
		let ret=args.value;
		let vid= this._variableHandles.get( args.variablesReference);
		try {
			if (vid==='locals::'){
				let watch=await this.dbgSession.addWatch(args.name);
				ret=await this.dbgSession.setWatchValue(watch.id,args.value);
				this.dbgSession.removeWatch(watch.id);
			}else{
				let childs=await this.dbgSession.getWatchChildren(vid,{ detail: dbg.VariableDetailLevel.Simple });
				let watch=childs.find((value,index,obj)=>{
					return value.expression===args.name;
				});
				if (watch){
					ret=await this.dbgSession.setWatchValue(watch.id,args.value);	
				}
	
			}
			response.body={
				value:ret
			};
		} catch (error) {
			response.success=false;
		}
		
	
		this.sendResponse(response);
	}
	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.dbgSession.resumeAllInferiors(false);
		this.sendResponse(response);
	}

	protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments): void {
		this.dbgSession.resumeAllInferiors(true);
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.dbgSession.stepOverLine({ threadId: args.threadId });
		this.sendResponse(response);
	}


	protected stepInTargetsRequest(response: DebugProtocol.StepInTargetsResponse, args: DebugProtocol.StepInTargetsArguments) {
		this.sendResponse(response);
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {

		this.dbgSession.stepIntoLine({ threadId: args.threadId, });
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		this.dbgSession.stepOut({ threadId: args.threadId });
		this.sendResponse(response);
	}

	protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
		if (args.context === 'repl') {
			let val = await this.dbgSession.execNativeCommand(args.expression).catch((e)=>{
				this.sendMsgToDebugConsole(e.message,EMsgType.error);
			});;
		} else { //'watch hover'
			if (this._currentFrameLevel!==args.frameId){
				this.dbgSession.selectStackFrame({frameLevel:args.frameId});

			}
			let key = this._currentThreadId?.id + "_" + args.frameId + "_" + args.expression;
			let watch: void | IWatchInfo = this._watchs.get(key);

			if (!watch) {
				watch = await this.dbgSession.addWatch(this.varUpperCase?args.expression.toUpperCase():args.expression, {
					frameLevel: args.frameId,
					threadId: this._currentThreadId?.id
				}).catch((e) => {

				});;
				if (!watch) {
					response.body = {
						result: '<null>',
						type: undefined,
						variablesReference: 0
					};
					this.sendResponse(response);
					return;
				}

				this._watchs.set(key, watch);

			} else {
				let upd = await this.dbgSession.updateWatch(watch.id, dbg.VariableDetailLevel.Simple)
					.catch(() => { });
				if (upd) {
					if (upd.length > 0) {
						watch.value = upd[0].value;
						watch.expressionType = upd[0].expressionType;
						watch.childCount = upd[0].childCount;
					}
				}
			}

			let vid = 0;
			if (watch.childCount > 0) {
				vid = this._variableHandles.create(watch.id);
			}
			response.body = {
				result: this.decodeString(watch.value,watch.expressionType),
				type: watch.expressionType,
				variablesReference: vid
			};
		}

		this.sendResponse(response);
	}

	private async progressSequence() {

		const ID = '' + this._progressId++;

		await timeout(100);

		const title = this._isProgressCancellable ? 'Cancellable operation' : 'Long running operation';
		const startEvent: DebugProtocol.ProgressStartEvent = new ProgressStartEvent(ID, title);
		startEvent.body.cancellable = this._isProgressCancellable;
		this._isProgressCancellable = !this._isProgressCancellable;
		this.sendEvent(startEvent);
		this.sendEvent(new OutputEvent(`start progress: ${ID}\n`));

		let endMessage = 'progress ended';

		for (let i = 0; i < 100; i++) {
			await timeout(500);
			this.sendEvent(new ProgressUpdateEvent(ID, `progress: ${i}`));
			if (this._cancelledProgressId === ID) {
				endMessage = 'progress cancelled';
				this._cancelledProgressId = undefined;
				this.sendEvent(new OutputEvent(`cancel progress: ${ID}\n`));
				break;
			}
		}
		this.sendEvent(new ProgressEndEvent(ID, endMessage));
		this.sendEvent(new OutputEvent(`end progress: ${ID}\n`));

		this._cancelledProgressId = undefined;
	}

	protected dataBreakpointInfoRequest(response: DebugProtocol.DataBreakpointInfoResponse, args: DebugProtocol.DataBreakpointInfoArguments): void {

		response.body = {
			dataId: null,
			description: "cannot break on data access",
			accessTypes: undefined,
			canPersist: false
		};

		if (args.variablesReference && args.name) {
			const id = this._variableHandles.get(args.variablesReference);
			if (id.startsWith("global_")) {
				response.body.dataId = args.name;
				response.body.description = args.name;
				response.body.accessTypes = ["read"];
				response.body.canPersist = true;
			}
		}

		this.sendResponse(response);
	}

	protected setDataBreakpointsRequest(response: DebugProtocol.SetDataBreakpointsResponse, args: DebugProtocol.SetDataBreakpointsArguments): void {

		this.sendResponse(response);
	}

	protected async completionsRequest(response: DebugProtocol.CompletionsResponse, args: DebugProtocol.CompletionsArguments) {

		//Not realized
		let aval = await this.dbgSession.interpreterExec(`complete ${args.text}`);
		response.body = {
			targets: [
				{
					label: "item 10",
					sortText: "10"
				},
				{
					label: "item 1",
					sortText: "01"
				},
				{
					label: "item 2",
					sortText: "02"
				},
				{
					label: "array[]",
					selectionStart: 6,
					sortText: "03"
				},
				{
					label: "func(arg)",
					selectionStart: 5,
					selectionLength: 3,
					sortText: "04"
				}
			]
		};
		this.sendResponse(response);
	}

	protected cancelRequest(response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments) {
		if (args.requestId) {
			this._cancelationTokens.set(args.requestId, true);
		}
		if (args.progressId) {
			this._cancelledProgressId = args.progressId;
		}
	}
	protected sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments, request?: DebugProtocol.Request): void {
		logger.log(args.source!.path!);
	}


	protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments, request?: DebugProtocol.Request) {
		try {
			if (this._isRunning) {
			
				try {
					await this.dbgSession.pause();
				} catch (error) {
					this.dbgSession.kill();
				}
				
			}
			if(this._isAttached){
				await this.dbgSession.executeCommand('target-detach');
				await this.dbgSession.dbgexit();
			}else{
				//this.dbgSession.kill();
				//await this.dbgSession.execNativeCommand('kill');
				await this.dbgSession.dbgexit();
			}
		} catch (error) {
			await this.dbgSession.kill();
		}

		this.sendResponse(response);
	}

	protected async  restartFrameRequest(response: DebugProtocol.RestartFrameResponse, args: DebugProtocol.RestartFrameArguments, request?: DebugProtocol.Request){
		logger.log(args.frameId.toString());
	}
	protected exceptionInfoRequest(response: DebugProtocol.ExceptionInfoResponse, args: DebugProtocol.ExceptionInfoArguments, request?: DebugProtocol.Request): void{
		
		//todo 
		// response.body={
		// 	exceptionId:'1',
		// 	description:'test',
		// 	breakMode:'always',
		// 	details:{
		// 		message:'test2'
		// 	}

		// };
		this.sendResponse(response);
	}

	protected readMemoryRequest(response: DebugProtocol.ReadMemoryResponse, args: DebugProtocol.ReadMemoryArguments, request?: DebugProtocol.Request){
		
		this.sendResponse(response);

	}
   
	public getBeyDbgSession():BeyDbgSession{
		return this.dbgSession;
	} 
}
