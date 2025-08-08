import * as vscode from 'vscode';

// Export main classes
export { DebugMcpServer } from './server';
export { McpManager } from './manager';
export { McpErrorHandler, McpErrorType } from './errorHandler';
export { StatusManager } from './statusManager';

// Import and re-export types for compatibility
import { McpError, DebugToolResponse } from './errorHandler';
import { DebugSessionStatus, ServerHealthStatus } from './statusManager';
import { McpManager } from './manager';

export { McpError, DebugToolResponse, DebugSessionStatus, ServerHealthStatus };

// Extension integration helper
export function createMcpManager(context: vscode.ExtensionContext): McpManager {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    return new McpManager(context, workspaceRoot);
}