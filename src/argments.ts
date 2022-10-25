import { DebugProtocol } from 'vscode-debugprotocol';

/**
 * This interface describes the hi-debug specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the hi-debug extension.
 * The interface should always match this schema.
 */
export interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "program" to debug. */
	debuggerPath?: string;
	debuggerArgs?: string[];
	program: string;
	programArgs?: string;
	cwd?: string;
	commandsBeforeExec?: string[];
	varUpperCase: boolean;
	defaultStringCharset?: string;
	stopAtEntry: boolean;
	remote?: {
		enabled: boolean;
		address: string;
		mode: string;
		execfile: string;
		transfer: [{ from: string; to: string; }];
	};
	ssh?: {
		enabled: boolean;
		address: string;
		username: string;
		passwordType?: string;
		timeout:number;
		privatekey?: string;
		remoteSrcPrefix?: string;
		localSrcPrefix?: string;
		transfer: [{ from: string; to: string; }];
	};
}
export interface IAttachRequestArguments extends DebugProtocol.AttachRequestArguments {
	/** An absolute path to the "program" to debug. */
	program: string;
	/** Traget process id to attach. */
	processId: number;
	debuggerPath?: string;
	debuggerArgs?: string[];
	cwd?: string;
	commandsBeforeExec?: string[];
	varUpperCase: boolean;
	defaultStringCharset?: string;
}
