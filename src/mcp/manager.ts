import * as vscode from 'vscode';
import { DebugMcpServer } from './server';
import { BeyDebug } from '../beyDebug';

export class McpManager {
    private mcpServer: DebugMcpServer | null = null;
    private context: vscode.ExtensionContext;
    private workspaceRoot: string;
    private currentDebugSession: BeyDebug | null = null;
    private autoRegisterEnabled: boolean = false;
    private mcpServerDisposable: vscode.Disposable | null = null;
    private didChangeEmitter = new vscode.EventEmitter<void>();

    constructor(context: vscode.ExtensionContext, workspaceRoot: string) {
        this.context = context;
        this.workspaceRoot = workspaceRoot;
        
        // Listen for configuration changes
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(this.onConfigurationChanged.bind(this))
        );
        
        // Read configuration settings
        this.updateConfigSettings();
    }

    async initialize(): Promise<void> {
        // Check if MCP API is available before proceeding
        if (!this.isMcpApiAvailable()) {
            console.log('MCP API not available, skipping MCP initialization');
            return;
        }

        // Check if MCP server should be started based on configuration
        if (this.isMcpEnabled()) {
            await this.startMcpServer();
            // Register the MCP server definition provider
            await this.registerServer();
        }
    }

    private isMcpEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('beyondDebug.mcp');
        return config.get<boolean>('enabled', false);
    }
    
    private updateConfigSettings(): void {
        const config = vscode.workspace.getConfiguration('beyondDebug.mcp');
        this.autoRegisterEnabled = config.get<boolean>('autoRegister', false);
    }

    private async startMcpServer(): Promise<void> {
        if (this.mcpServer) {
            return; // Already running
        }

        try {
            // Read port settings from configuration, default to 0 (auto-assign)
            const config = vscode.workspace.getConfiguration('beyondDebug.mcp');
            const preferredPort = config.get<number>('port', 0);
            const host = config.get<string>('host', 'localhost');
            
            this.mcpServer = new DebugMcpServer(
                this.workspaceRoot,
                this.currentDebugSession || undefined,
                preferredPort,
                host
            );
            await this.mcpServer.start();
            
            console.log(`Beyond Debug MCP Server started on ${this.mcpServer.getServerUrl()}`);
            
            // Trigger server definitions update
            this.didChangeEmitter.fire();
            
            // Show information message
            vscode.window.showInformationMessage(
                `Beyond Debug MCP Server started on ${this.mcpServer.getServerUrl()}`
            );
            
        } catch (error) {
            console.error('Failed to start Beyond Debug MCP Server:', error);
            vscode.window.showErrorMessage(`Failed to start Beyond Debug MCP Server: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async stopMcpServer(): Promise<void> {
        if (!this.mcpServer) {
            return; // Not running
        }

        try {
            await this.mcpServer.stop();
            this.mcpServer = null;
            
            console.log('Beyond Debug MCP Server stopped successfully');
            vscode.window.showInformationMessage('Beyond Debug MCP Server stopped');
            
            // Trigger server definitions update
            this.didChangeEmitter.fire();
            
        } catch (error) {
            console.error('Failed to stop Beyond Debug MCP Server:', error);
            vscode.window.showErrorMessage(`Failed to stop Beyond Debug MCP Server: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async onConfigurationChanged(event: vscode.ConfigurationChangeEvent): Promise<void> {
        // Update all configuration settings
        if (event.affectsConfiguration('beyondDebug.mcp')) {
            this.updateConfigSettings();
        }
        
        // Handle MCP server enable/disable
        if (event.affectsConfiguration('beyondDebug.mcp.enabled')) {
            const mcpEnabled = this.isMcpEnabled();
            
            if (mcpEnabled && !this.mcpServer) {
                // MCP was enabled, start server
                await this.startMcpServer();
                await this.registerServer();
            } else if (!mcpEnabled && this.mcpServer) {
                // MCP was disabled, stop server
                await this.stopMcpServer();
            }
        }
        
        // Handle auto-registration changes
        if (event.affectsConfiguration('beyondDebug.mcp.autoRegister') && this.mcpServer) {
            if (this.autoRegisterEnabled && this.isMcpApiAvailable()) {
                await this.registerServer();
            }
        }
        
        // Handle port/host changes - restart server if configuration changed
        if ((event.affectsConfiguration('beyondDebug.mcp.port') || 
             event.affectsConfiguration('beyondDebug.mcp.host')) && this.mcpServer) {
            await this.restart();
        }
    }

    async dispose(): Promise<void> {
        if (this.mcpServerDisposable) {
            this.mcpServerDisposable.dispose();
            this.mcpServerDisposable = null;
        }
        
        this.didChangeEmitter.dispose();
        
        if (this.mcpServer) {
            await this.stopMcpServer();
        }
    }

    isRunning(): boolean {
        return this.mcpServer !== null && this.mcpServer.isRunning();
    }

    async restart(): Promise<void> {
        if (this.mcpServer) {
            await this.stopMcpServer();
        }
        
        if (this.isMcpEnabled() && this.isMcpApiAvailable()) {
            await this.startMcpServer();
            await this.registerServer();
        }
    }
    
    /**
     * Check if MCP API is available in current VS Code version
     */
    private isMcpApiAvailable(): boolean {
        return typeof vscode.lm?.registerMcpServerDefinitionProvider === 'function';
    }

    /**
     * Public method to check if MCP is supported in current environment
     */
    public isMcpSupported(): boolean {
        return this.isMcpApiAvailable();
    }

    /**
     * Get MCP status information
     */
    public getMcpStatus(): { supported: boolean; enabled: boolean; running: boolean; apiAvailable: boolean; serverInfo?: any } {
        return {
            supported: this.isMcpApiAvailable(),
            enabled: this.isMcpEnabled(),
            running: this.isRunning(),
            apiAvailable: this.isMcpApiAvailable(),
            serverInfo: this.mcpServer?.getServerStatus()
        };
    }

    /**
     * Register the MCP server with VS Code
     */
    async registerServer(): Promise<void> {
        // Check if MCP API is available
        if (!this.isMcpApiAvailable()) {
            console.warn('MCP API is not available in this VS Code version. MCP server registration skipped.');
            vscode.window.showWarningMessage(
                'MCP functionality requires a newer version of VS Code. Please update VS Code to use MCP features.',
                'Learn More'
            ).then(selection => {
                if (selection === 'Learn More') {
                    vscode.env.openExternal(vscode.Uri.parse('https://code.visualstudio.com/updates'));
                }
            });
            return;
        }

        try {
            this.mcpServerDisposable = vscode.lm.registerMcpServerDefinitionProvider('beyond-debug.mcp-server', {
                onDidChangeMcpServerDefinitions: this.didChangeEmitter.event,
                provideMcpServerDefinitions: async () => {
                    let servers: vscode.McpServerDefinition[] = [];

                    // Only register when server is running
                    if (this.mcpServer && this.mcpServer.isRunning()) {
                        const mcpEndpoint = this.mcpServer.getMcpEndpointUrl();
                        if (mcpEndpoint) {
                            servers.push(new vscode.McpHttpServerDefinition(
                                'beyond-debug-mcp-server',
                                vscode.Uri.parse(mcpEndpoint),
                                {
                                    'Content-Type': 'application/json',
                                    'User-Agent': 'BeyondDebug-Extension'
                                },
                                "1.0.0"
                            ));
                        }
                    }

                    return servers;
                },
                resolveMcpServerDefinition: async (server: vscode.McpServerDefinition) => {
                    if (server.label === 'beyond-debug-mcp-server') {
                        // Ensure server is running
                        if (!this.mcpServer || !this.mcpServer.isRunning()) {
                            throw new Error('Beyond Debug MCP Server is not running');
                        }
                    }
                    return server;
                }
            });
            
            this.context.subscriptions.push(this.mcpServerDisposable);
        } catch (error) {
            console.error('Failed to register MCP server definition provider:', error);
            vscode.window.showErrorMessage(`Failed to register MCP server: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    onDebugSessionStart(debugSession: BeyDebug): void {
        this.currentDebugSession = debugSession;
        if (this.mcpServer) {
            this.mcpServer.setDebugSession(debugSession);
        }
    }

    onDebugSessionEnd(): void {
        this.currentDebugSession = null;
        if (this.mcpServer) {
            this.mcpServer.setDebugSession(null);
        }
    }

    // Public methods for external control
    async startServer(): Promise<void> {
        await this.startMcpServer();
        if (this.autoRegisterEnabled) {
            await this.registerServer();
        }
    }

    async stopServer(): Promise<void> {
        await this.stopMcpServer();
    }

    getServer(): DebugMcpServer | null {
        return this.mcpServer;
    }
}