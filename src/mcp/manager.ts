import * as vscode from 'vscode';
import { DebugMcpServer } from './server';
import { BeyDebug } from '../beyDebug';
import { McpErrorHandler, McpErrorType } from './errorHandler';

interface McpServerConfig {
    enabled: boolean;
    port: number;
    host: string;
    autoRegister: boolean;
}

interface McpStatus {
    supported: boolean;
    enabled: boolean;
    running: boolean;
    apiAvailable: boolean;
    serverInfo?: any;
    lastError?: string;
    configValid: boolean;
}

export class McpManager implements vscode.Disposable {
    private mcpServer: DebugMcpServer | null = null;
    private context: vscode.ExtensionContext;
    private workspaceRoot: string;
    private currentDebugSession: BeyDebug | null = null;
    private config: McpServerConfig;
    private configurationDisposable: vscode.Disposable | null = null;
    private didChangeEmitter = new vscode.EventEmitter<void>();
    private lastError: string | null = null;
    public readonly onDidChange = this.didChangeEmitter.event;

    constructor(context: vscode.ExtensionContext, workspaceRoot: string) {
        this.context = context;
        this.workspaceRoot = workspaceRoot;
        this.config = this.loadAndValidateConfig();
        
        // Listen for configuration changes
        this.configurationDisposable = vscode.workspace.onDidChangeConfiguration(
            this.onConfigurationChanged.bind(this)
        );
    }

    async initialize(): Promise<void> {
        try {
            // Only start MCP server if enabled and supported
            if (this.config.enabled && this.isMcpSupported()) {
                await this.startMcpServer();
                
                if (this.config.autoRegister) {
                    await this.registerServer();
                }
            }
        } catch (error) {
            this.handleError('Failed to initialize MCP manager', error);
        }
    }

    private loadAndValidateConfig(): McpServerConfig {
        try {
            const vsConfig = vscode.workspace.getConfiguration('beyondDebug.mcp');
            
            const config: McpServerConfig = {
                enabled: vsConfig.get<boolean>('enabled', false),
                port: vsConfig.get<number>('port', 0),
                host: vsConfig.get<string>('host', 'localhost'),
                autoRegister: vsConfig.get<boolean>('autoRegister', false)
            };

            // Validate configuration
            this.validateConfig(config);
            
            this.lastError = null; // Clear any previous config errors
            return config;
        } catch (error) {
            this.handleConfigurationError(error);
            // Return default config on error
            return {
                enabled: false,
                port: 0,
                host: 'localhost',
                autoRegister: false
            };
        }
    }

    private validateConfig(config: McpServerConfig): void {
        if (config.port < 0 || config.port > 65535) {
            throw new Error(`Invalid port number: ${config.port}. Must be between 0 and 65535.`);
        }

        if (!config.host || config.host.trim() === '') {
            throw new Error('Host cannot be empty');
        }

        // Validate host format (basic check)
        const hostRegex = /^[a-zA-Z0-9.-]+$/;
        if (!hostRegex.test(config.host)) {
            throw new Error(`Invalid host format: ${config.host}`);
        }
    }

    private handleConfigurationError(error: unknown): void {
        const mcpError = McpErrorHandler.handleConfigurationError(error, {
            configSection: 'beyondDebug.mcp'
        });
        this.lastError = mcpError.message;
    }

    private handleError(message: string, error: unknown): void {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.lastError = `${message}: ${errorMessage}`;
        console.error(this.lastError);
    }

    private async startMcpServer(): Promise<void> {
        if (this.mcpServer) {
            return;
        }

        try {
            this.mcpServer = new DebugMcpServer(
                this.workspaceRoot,
                this.currentDebugSession || undefined,
                this.config.port,
                this.config.host
            );
            
            await this.mcpServer.start();
            
            this.lastError = null; // Clear any previous errors
            
            vscode.window.showInformationMessage(
                `Debug MCP Server started on ${this.mcpServer.getServerUrl()}`
            );
            
            this.didChangeEmitter.fire();
        } catch (error) {
            const mcpError = McpErrorHandler.handleServerStartError(error, {
                port: this.config.port,
                host: this.config.host,
                workspaceRoot: this.workspaceRoot
            });
            this.lastError = mcpError.message;
            throw error;
        }
    }

    private async stopMcpServer(): Promise<void> {
        if (this.mcpServer) {
            await this.mcpServer.stop();
            this.mcpServer = null;
            this.didChangeEmitter.fire();
        }
    }

    private async onConfigurationChanged(event: vscode.ConfigurationChangeEvent): Promise<void> {
        if (event.affectsConfiguration('beyondDebug.mcp')) {
            try {
                const oldConfig = this.config;
                this.config = this.loadAndValidateConfig();
                
                // Check if restart is needed
                const needsRestart = this.configRequiresRestart(oldConfig, this.config);
                
                if (this.config.enabled && this.isMcpSupported()) {
                    if (needsRestart) {
                        await this.restart();
                    }
                } else {
                    await this.stopMcpServer();
                }
                
                this.reportConfigurationStatus();
            } catch (error) {
                this.handleError('Failed to handle configuration change', error);
            }
        }
    }

    private configRequiresRestart(oldConfig: McpServerConfig, newConfig: McpServerConfig): boolean {
        return (
            oldConfig.enabled !== newConfig.enabled ||
            oldConfig.port !== newConfig.port ||
            oldConfig.host !== newConfig.host
        );
    }

    private reportConfigurationStatus(): void {
        const status = this.getMcpStatus();
        
        if (!status.configValid && this.lastError) {
            vscode.window.showWarningMessage(
                `MCP configuration issue: ${this.lastError}`
            );
        } else if (status.enabled && !status.running && status.supported) {
            vscode.window.showWarningMessage(
                'MCP is enabled but server is not running. Check configuration.'
            );
        }
    }

    async dispose(): Promise<void> {
        if (this.configurationDisposable) {
            this.configurationDisposable.dispose();
        }
        // MCP server shuts down with extension
        await this.stopMcpServer();
        this.didChangeEmitter.dispose();
    }

    isRunning(): boolean {
        return this.mcpServer?.isRunning() || false;
    }

    async restart(): Promise<void> {
        await this.stopMcpServer();
        await this.startMcpServer();
        
        if (this.config.autoRegister) {
            await this.registerServer();
        }
    }
    
    private isMcpApiAvailable(): boolean {
        // Check if VS Code MCP API is available
        return typeof (vscode as any).mcp !== 'undefined';
    }

    public isMcpSupported(): boolean {
        return this.isMcpApiAvailable();
    }

    public getMcpStatus(): McpStatus {
        return {
            supported: this.isMcpSupported(),
            enabled: this.config.enabled,
            running: this.isRunning(),
            apiAvailable: this.isMcpApiAvailable(),
            serverInfo: this.mcpServer?.getServerStatus(),
            lastError: this.lastError || undefined,
            configValid: this.lastError === null
        };
    }

    public getConfig(): McpServerConfig {
        return { ...this.config };
    }

    public async updateConfig(newConfig: Partial<McpServerConfig>): Promise<void> {
        try {
            const vsConfig = vscode.workspace.getConfiguration('beyondDebug.mcp');
            
            if (newConfig.enabled !== undefined) {
                await vsConfig.update('enabled', newConfig.enabled, vscode.ConfigurationTarget.Workspace);
            }
            if (newConfig.port !== undefined) {
                await vsConfig.update('port', newConfig.port, vscode.ConfigurationTarget.Workspace);
            }
            if (newConfig.host !== undefined) {
                await vsConfig.update('host', newConfig.host, vscode.ConfigurationTarget.Workspace);
            }
            if (newConfig.autoRegister !== undefined) {
                await vsConfig.update('autoRegister', newConfig.autoRegister, vscode.ConfigurationTarget.Workspace);
            }
            
            // Configuration change event will be triggered automatically
        } catch (error) {
            this.handleError('Failed to update configuration', error);
            throw error;
        }
    }

    async registerServer(): Promise<void> {
        if (!this.mcpServer || !this.isRunning()) {
            const error = new Error('MCP server is not running');
            McpErrorHandler.handleValidationError(error.message, {
                serverRunning: this.isRunning(),
                hasServer: this.mcpServer !== null
            });
            throw error;
        }

        try {
            await this.registerMcpServer();
            vscode.window.showInformationMessage('MCP server registered successfully');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to register MCP server: ${errorMessage}`);
            throw error;
        }
    }
    
    private async registerMcpServer(): Promise<void> {
        if (!this.mcpServer) return;
        
        const serverInfo = {
            name: 'beyond-debug-server',
            url: this.mcpServer.getMcpEndpointUrl(),
            description: 'Beyond Debug MCP Server for GDB debugging tools'
        };
        
        // Register with VS Code MCP API if available
        if (this.isMcpApiAvailable()) {
            await (vscode as any).mcp.registerServer(serverInfo);
        }
        
        // Also write to a configuration file for external tools
        const configPath = this.context.globalStorageUri.fsPath;
        // Write server configuration for external access
        // This could be implemented later if needed
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
    }

    async stopServer(): Promise<void> {
        await this.stopMcpServer();
    }

    getServer(): DebugMcpServer | null {
        return this.mcpServer;
    }

    // Enhanced error reporting methods
    getErrorHistory(): any[] {
        return McpErrorHandler.getErrorHistory();
    }

    getErrorStats(): Record<string, number> {
        return McpErrorHandler.getErrorStats();
    }

    clearErrors(): void {
        McpErrorHandler.clearErrorHistory();
        this.lastError = null;
    }

    // Health check methods
    async performHealthCheck(): Promise<{
        healthy: boolean;
        issues: string[];
        serverStatus?: any;
    }> {
        const issues: string[] = [];
        
        try {
            // Check if server is running
            if (this.config.enabled && !this.isRunning()) {
                issues.push('MCP server is enabled but not running');
            }

            // Check configuration validity
            if (this.lastError) {
                issues.push(`Configuration error: ${this.lastError}`);
            }

            // Check server health if running
            let serverStatus;
            if (this.mcpServer && this.isRunning()) {
                serverStatus = this.mcpServer.getServerStatus();
                
                if (!serverStatus.health?.isHealthy) {
                    issues.push('Server health check failed');
                }

                if (!serverStatus.compatibility?.compatible) {
                    issues.push(`Debug session compatibility issues: ${serverStatus.compatibility.issues.join(', ')}`);
                }
            }

            return {
                healthy: issues.length === 0,
                issues,
                serverStatus
            };
        } catch (error) {
            issues.push(`Health check failed: ${error instanceof Error ? error.message : String(error)}`);
            return {
                healthy: false,
                issues
            };
        }
    }

    // Diagnostic information for troubleshooting
    getDiagnosticInfo(): {
        config: McpServerConfig;
        status: McpStatus;
        errorHistory: any[];
        healthCheck: any;
    } {
        return {
            config: this.getConfig(),
            status: this.getMcpStatus(),
            errorHistory: this.getErrorHistory().slice(0, 5), // Last 5 errors
            healthCheck: this.performHealthCheck()
        };
    }
}