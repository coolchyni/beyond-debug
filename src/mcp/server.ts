import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as http from 'http';
import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { BeyDebug } from '../beyDebug';
import * as dbg from '../dbgmits';
import { StatusManager } from './statusManager';

// MCP tool response type
interface McpToolResponse {
    content: Array<{
        type: "text";
        text: string;
    }>;
}

export class DebugMcpServer {
    private server: McpServer;
    private transport: StreamableHTTPServerTransport | null = null;
    private httpServer: http.Server | null = null;
    private debugSession: BeyDebug | null = null;
    private workspaceRoot: string;
    private port: number = 0; // 0 means auto-assign
    private host: string = 'localhost';
    private statusManager: StatusManager;

    constructor(workspaceRoot: string, debugSession?: BeyDebug, port?: number, host?: string) {
        this.workspaceRoot = workspaceRoot;
        this.debugSession = debugSession || null;
        this.port = port || 0;
        this.host = host || 'localhost';
        
        // Initialize status manager
        this.statusManager = new StatusManager(workspaceRoot);
        this.statusManager.setDebugSession(this.debugSession);
        
        this.server = new McpServer(
            {
                name: "beyond-debug-server",
                version: "1.0.0",
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );
        
        this.registerTools();
    }

    private registerTools() {
        // Register tools using SDK helper API
        this.server.tool(
            "get_variables",
            "Get current debug session variables",
            {
                frameId: z.number().int().nonnegative().optional().describe("Stack frame ID (optional)")
            },
            async ({ frameId }) => {
                const res = await this.getVariables({ frameId: frameId ?? 0 });
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(res, null, 2)
                    }]
                };
            }
        );

        this.server.tool(
            "set_breakpoint",
            "Set a breakpoint at specified location",
            {
                file: z.string().describe("File path"),
                line: z.number().int().positive().describe("Line number")
            },
            async ({ file, line }) => {
                const res = await this.setBreakpoint({ file, line });
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(res, null, 2)
                    }]
                };
            }
        );

        this.server.tool(
            "execute_gdb_command",
            "Execute a GDB command",
            {
                command: z.string().describe("GDB command to execute")
            },
            async ({ command }) => {
                const res = await this.executeGdbCommand({ command });
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(res, null, 2)
                    }]
                };
            }
        );

        this.server.tool(
            "get_debug_status",
            "Get current debug session status",
            {},
            async () => {
                const res = await this.getDebugStatus();
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(res, null, 2)
                    }]
                };
            }
        );

        this.server.tool(
            "start_debugging",
            "Start a debugging session",
            {
                program: z.string().describe("Program path to debug"),
                args: z.string().optional().describe("Program arguments (optional)"),
                cwd: z.string().optional().describe("Working directory (optional)")
            },
            async ({ program, args, cwd }) => {
                const res = await this.startDebugging({ program, args, cwd });
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(res, null, 2)
                    }]
                };
            }
        );

        this.server.tool(
            "stop_debugging",
            "Stop the current debugging session",
            {},
            async () => {
                const res = await this.stopDebugging();
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(res, null, 2)
                    }]
                };
            }
        );
    }

    async start(): Promise<void> {
        try {
            // Create StreamableHTTPServerTransport with session support
            this.transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => randomBytes(16).toString('hex'),
                onsessioninitialized: (sessionId: string) => {
                    console.log(`MCP session initialized: ${sessionId}`);
                },
                onsessionclosed: (sessionId: string) => {
                    console.log(`MCP session closed: ${sessionId}`);
                },
                enableJsonResponse: false,
                allowedHosts: ['localhost', '127.0.0.1'],
                allowedOrigins: ['*'],
                enableDnsRebindingProtection: false
            });

            // Hook events
            this.transport.onclose = () => {
                console.log('MCP transport connection closed');
            };
            this.transport.onerror = (error: Error) => {
                console.error('MCP transport error:', error);
            };

            // Connect the server to the transport
            await this.server.connect(this.transport);

            // Create HTTP server and forward requests to transport
            this.httpServer = http.createServer((req, res) => {
                // CORS headers
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Session-Id');

                if (req.method === 'OPTIONS') {
                    res.writeHead(200);
                    res.end();
                    return;
                }

                if (req.method === 'POST') {
                    let body = '';
                    req.on('data', chunk => { body += chunk.toString(); });
                    req.on('end', () => {
                        try {
                            const parsed = JSON.parse(body);
                            this.transport!.handleRequest(req as any, res as any, parsed);
                        } catch {
                            this.transport!.handleRequest(req as any, res as any);
                        }
                    });
                } else {
                    this.transport!.handleRequest(req as any, res as any);
                }
            });

            // Listen on available port
            await new Promise<void>((resolve, reject) => {
                this.httpServer!.listen(this.port, this.host, () => {
                    const address = this.httpServer!.address();
                    if (address && typeof address === 'object') {
                        this.port = address.port;
                        console.log(`Beyond Debug MCP Server running on http://${this.host}:${this.port}`);
                    }
                    resolve();
                });

                this.httpServer!.on('error', (error: any) => {
                    if (error && error.code === 'EADDRINUSE') {
                        console.error(`Port ${this.port} in use, retrying on random port...`);
                        this.port = 0;
                        this.httpServer!.listen(0, this.host);
                    } else {
                        console.error('HTTP server error:', error);
                        reject(error);
                    }
                });
            });
        } catch (error) {
            console.error('Failed to start MCP server:', error);
            throw error;
        }
    }

    async stop(): Promise<void> {
        try {
            if (this.server && this.server.isConnected()) {
                await this.server.close();
            }
            if (this.transport) {
                await this.transport.close();
                this.transport = null;
            }
            if (this.httpServer) {
                await new Promise<void>((resolve) => {
                    this.httpServer!.close(() => {
                        this.httpServer = null;
                        resolve();
                    });
                });
            }
            this.statusManager.dispose();
        } catch (error) {
            console.error('Failed to stop MCP server:', error);
            throw error;
        }
    }

    getPort(): number {
        return this.port;
    }

    getServerUrl(): string {
        return `http://${this.host}:${this.port}`;
    }

    getMcpEndpointUrl(): string {
        return `${this.getServerUrl()}/mcp`;
    }

    isRunning(): boolean {
        return this.httpServer !== null && this.server.isConnected();
    }

    setDebugSession(session: BeyDebug | null) {
        this.debugSession = session;
        this.statusManager.setDebugSession(session);
    }

    getServerStatus() {
        const detailedStatus = this.statusManager.getDetailedStatus();
        
        return {
            running: this.isRunning(),
            port: this.port,
            host: this.host,
            url: this.getServerUrl(),
            mcpEndpoint: this.getMcpEndpointUrl(),
            hasDebugSession: this.debugSession !== null,
            uptime: this.statusManager.getUptimeString(),
            health: detailedStatus.serverHealth,
            debugSessionStatus: detailedStatus.debugSession,
            compatibility: detailedStatus.compatibility,
            errorStats: detailedStatus.errorStats
        };
    }

    // Tool implementation methods
    private async getVariables(args: any): Promise<any> {
        // Check debug session status
        if (!this.statusManager.validateDebugSession()) {
            return {
                success: false,
                error: 'No active debug session',
                message: 'Please start a debug session first'
            };
        }
        
        try {
            const frameId = args.frameId || 0;
            
            // Validate frame ID
            if (typeof frameId !== 'number' || frameId < 0) {
                return {
                    success: false,
                    error: 'Invalid frame ID',
                    message: `Frame ID must be a non-negative number, got: ${frameId}`
                };
            }

            const sessionAny = this.debugSession as any;
            const beyDbgSession = sessionAny?.getBeyDbgSession?.();
            
            if (!beyDbgSession) {
                return {
                    success: false,
                    error: 'Debug session access error',
                    message: 'Unable to access debug session internals'
                };
            }
            
            // Get variables from debug session
            const variables = await beyDbgSession.getStackFrameVariables(dbg.VariableDetailLevel.Simple, {
                frameLevel: frameId
            });
            
            const result = {
                frameId: frameId,
                arguments: variables.args.map((v: any) => ({
                    name: v.name,
                    value: v.value || '<not available>',
                    type: v.type || 'unknown'
                })),
                locals: variables.locals.map((v: any) => ({
                    name: v.name,
                    value: v.value || '<not available>',
                    type: v.type || 'unknown'
                }))
            };
            
            return {
                success: true,
                result: result,
                frameId: frameId,
                variableCount: result.arguments.length + result.locals.length
            };
        } catch (error) {
            return {
                success: false,
                error: 'Failed to get variables',
                message: error instanceof Error ? error.message : String(error),
                frameId: args.frameId
            };
        }
    }

    private async setBreakpoint(args: any): Promise<McpToolResponse> {
        // Check debug session status
        if (!this.statusManager.validateDebugSession()) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: 'No active debug session',
                        message: 'Please start a debug session first'
                    }, null, 2)
                }]
            };
        }
        
        try {
            const { file, line } = args;
            
            // Validate arguments
            if (!file || typeof file !== 'string') {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            error: 'Invalid arguments',
                            message: 'File path is required and must be a string'
                        }, null, 2)
                    }]
                };
            }
            
            if (!line || typeof line !== 'number' || line <= 0) {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            error: 'Invalid arguments',
                            message: 'Line number is required and must be a positive number'
                        }, null, 2)
                    }]
                };
            }
            
            const dbgSession = this.debugSession!.getBeyDbgSession();
            
            // Add breakpoint using the debug session
            const breakpoint = await dbgSession.addBreakpoint(`${file}:${line}`, {
                isPending: true
            });
            
            return {
                content: [{ 
                    type: "text", 
                    text: `Breakpoint set at ${file}:${line} (ID: ${breakpoint.id})` 
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: 'Failed to set breakpoint',
                        message: error instanceof Error ? error.message : String(error)
                    }, null, 2)
                }]
            };
        }
    }

    private async executeGdbCommand(args: any): Promise<McpToolResponse> {
        // Check debug session status
        if (!this.statusManager.validateDebugSession()) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: 'No active debug session',
                        message: 'Please start a debug session first'
                    }, null, 2)
                }]
            };
        }
        
        try {
            const { command } = args;
            
            // Validate command
            if (!command || typeof command !== 'string') {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            error: 'Invalid arguments',
                            message: 'Command is required and must be a string'
                        }, null, 2)
                    }]
                };
            }
            
            // Check for potentially dangerous commands
            const dangerousCommands = ['quit', 'kill', 'detach', 'file'];
            const commandLower = command.toLowerCase().trim();
            
            if (dangerousCommands.some(dangerous => commandLower.startsWith(dangerous))) {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            error: 'Command not allowed',
                            message: `Command '${command}' is not allowed for security reasons`
                        }, null, 2)
                    }]
                };
            }
            
            const dbgSession = this.debugSession!.getBeyDbgSession();
            
            // Execute native GDB command
            const result = await dbgSession.execNativeCommand(command);
            
            return {
                content: [{ 
                    type: "text", 
                    text: result || "Command executed successfully" 
                }]
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: 'Failed to execute command',
                        message: error instanceof Error ? error.message : String(error)
                    }, null, 2)
                }]
            };
        }
    }

    private async getDebugStatus(): Promise<McpToolResponse> {
        try {
            // Get comprehensive status from status manager
            const detailedStatus = this.statusManager.getDetailedStatus();
            
            const status = {
                debugSession: detailedStatus.debugSession,
                serverHealth: detailedStatus.serverHealth,
                compatibility: detailedStatus.compatibility,
                workspaceRoot: this.workspaceRoot,
                serverInfo: {
                    running: this.isRunning(),
                    port: this.port,
                    host: this.host,
                    uptime: this.statusManager.getUptimeString()
                }
            };
            
            return {
                content: [{ type: "text", text: JSON.stringify(status, null, 2) }]
            };
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: 'Failed to get debug status',
                        message: error instanceof Error ? error.message : String(error)
                    }, null, 2)
                }]
            };
        }
    }

    private async startDebugging(args: any): Promise<McpToolResponse> {
        try {
            const { program, args: programArgs, cwd } = args;
            
            // Validate program path
            if (!program || typeof program !== 'string') {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            error: 'Invalid arguments',
                            message: 'Program path is required and must be a string'
                        }, null, 2)
                    }]
                };
            }
            
            // Check if there's already an active debug session
            if (vscode.debug.activeDebugSession) {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            error: 'Debug session already active',
                            message: 'A debug session is already active. Stop it first.'
                        }, null, 2)
                    }]
                };
            }
            
            // Start debugging session using VS Code debug API
            const debugConfig = {
                type: 'by-gdb',
                request: 'launch',
                name: 'MCP Debug Session',
                program: program,
                programArgs: programArgs,
                cwd: cwd || this.workspaceRoot
            };
            
            const started = await vscode.debug.startDebugging(undefined, debugConfig);
            
            if (started) {
                return {
                    content: [{ type: "text", text: `Debug session started for ${program}` }]
                };
            } else {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            error: 'Failed to start debugging',
                            message: 'VS Code returned false when attempting to start debug session'
                        }, null, 2)
                    }]
                };
            }
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: 'Failed to start debugging',
                        message: error instanceof Error ? error.message : String(error)
                    }, null, 2)
                }]
            };
        }
    }

    private async stopDebugging(): Promise<McpToolResponse> {
        try {
            if (vscode.debug.activeDebugSession) {
                const sessionName = vscode.debug.activeDebugSession.name;
                await vscode.debug.stopDebugging(vscode.debug.activeDebugSession);
                
                return {
                    content: [{ type: "text", text: `Debug session '${sessionName}' stopped` }]
                };
            } else {
                return {
                    content: [{ type: "text", text: "No active debug session to stop" }]
                };
            }
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: 'Failed to stop debugging',
                        message: error instanceof Error ? error.message : String(error)
                    }, null, 2)
                }]
            };
        }
    }
}