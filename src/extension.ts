/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';
import * as Net from 'net';
import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { platform } from 'process';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import { logger } from '@vscode/debugadapter';

import { BeyDebug } from './beyDebug';
import { LogLevel } from '@vscode/debugadapter/lib/logger';
import { TextEncoder } from 'util';
import { pathToFileURL } from 'url';
import * as memview from './beyMemoryView';
import { createMcpManager } from './mcp';
/*
 * The compile time flag 'runMode' controls how the debug adapter is run.
 * Please note: the test suite only supports 'external' mode.
 */
const runMode: 'server' | 'inline' = 'inline';
const byMemoryViewSchema = 'bymv';
import * as util from "./util";
import { NativeAttachItemsProviderFactory } from './nativeAttach';
import { AttachItemsProvider, AttachPicker } from './attachToProcess';
export function activate(context: vscode.ExtensionContext) {

	// Activate Process Picker Commands
	//const attachItemsProvider: AttachItemsProvider = NativeAttachItemsProviderFactory.Get();
	//const attacher: AttachPicker = new AttachPicker(attachItemsProvider);
	//context.subscriptions.push(vscode.commands.registerCommand('extension.pickNativeProcess', () => attacher.ShowAttachEntries()));

	let outchannel = vscode.window.createOutputChannel('BeyondDebug');
	logger.init((e) => {
		outchannel.appendLine(e.body.output);
	}, undefined, true);
	logger.setup(LogLevel.Log);
	util.setExtensionContext(context);

	// Initialize MCP Manager
	const mcpManager = createMcpManager(context);
	context.subscriptions.push(mcpManager);

	// Initialize MCP functionality
	mcpManager.initialize().catch(error => {
		console.error('Failed to initialize MCP:', error);
	});

	// Register MCP related commands
	context.subscriptions.push(
		vscode.commands.registerCommand('beyondDebug.mcp.start', async () => {
			try {
				await mcpManager.restart();
				vscode.window.showInformationMessage('MCP Server started');
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to start MCP server: ${error.message}`);
			}
		}),

		vscode.commands.registerCommand('beyondDebug.mcp.stop', async () => {
			try {
				await mcpManager.dispose();
				vscode.window.showInformationMessage('MCP Server stopped');
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to stop MCP server: ${error.message}`);
			}
		}),

		vscode.commands.registerCommand('beyondDebug.mcp.restart', async () => {
			try {
				await mcpManager.restart();
				vscode.window.showInformationMessage('MCP Server restarted');
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to restart MCP server: ${error.message}`);
			}
		}),

		vscode.commands.registerCommand('beyondDebug.mcp.status', () => {
			const status = mcpManager.getMcpStatus();
			const message = `MCP Status:
- Supported: ${status.supported}
- Enabled: ${status.enabled}  
- Running: ${status.running}
- API Available: ${status.apiAvailable}
${status.serverInfo ? `- Server URL: ${status.serverInfo.url}` : ''}`;
			vscode.window.showInformationMessage(message);
		})
	);

	// register a configuration provider for 'hi-gdb' debug type
	const provider = new HiDebugConfigurationProvider();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('by-gdb', provider));


	context.subscriptions.push(
		vscode.commands.registerTextEditorCommand('bydebug.ViewMemory', memview.cmdViewMemoryWithHexEdit)
	);


	// debug adapters can be run in different ways by using a vscode.DebugAdapterDescriptorFactory:
	let factory: vscode.DebugAdapterDescriptorFactory;
	switch (runMode) {
		case 'server':
			// run the debug adapter as a server inside the extension and communicate via a socket
			factory = new HiDebugAdapterServerDescriptorFactory();
			break;


		case 'inline':
			// run the debug adapter inside the extension and directly talk to it
			factory = new InlineDebugAdapterFactory(mcpManager);
			break;
	}

	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('by-gdb', factory));
	// if ('dispose' in factory) {
	// 	context.subscriptions.push(factory);
	// }

}

export function deactivate() {
	// nothing to do
}

class HiDebugConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				config.type = 'by-gdb';
				config.name = 'Launch(gdb)';
				config.request = 'launch';
				config.program = '${fileBasenameNoExtension}';
				config['cwd'] = '${workspaceFolder}';
			}
		}

		if (!config.program && config.request != 'attach') {
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return undefined;	// abort launch
			});
		}

		return config;
	}
}



class HiDebugAdapterServerDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {

	private server?: Net.Server;

	createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {

		if (!this.server) {
			// start listening on a random port
			this.server = Net.createServer(socket => {
				const session = new BeyDebug();
				session.setRunAsServer(true);
				session.start(socket as NodeJS.ReadableStream, socket);
			}).listen(0);
		}

		// make VS Code connect to debug server
		return new vscode.DebugAdapterServer((this.server.address() as Net.AddressInfo).port);
	}

	dispose() {
		if (this.server) {
			this.server.close();
		}
	}
}


class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
	private mcpManager: any;

	constructor(mcpManager: any) {
		this.mcpManager = mcpManager;
	}

	createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
		let dbg = new BeyDebug();
		memview.setCurrentDebugSession(dbg.getBeyDbgSession());

		// Notify MCP Manager about debug session start
		if (this.mcpManager) {
			this.mcpManager.onDebugSessionStart(dbg);
		}

		// Create a wrapper to handle session end
		const originalDispose = dbg.dispose;
		dbg.dispose = () => {
			// Notify MCP Manager about debug session end
			if (this.mcpManager) {
				this.mcpManager.onDebugSessionEnd();
			}
			if (originalDispose) {
				originalDispose.call(dbg);
			}
		};

		return new vscode.DebugAdapterInlineImplementation(dbg);
	}
}
