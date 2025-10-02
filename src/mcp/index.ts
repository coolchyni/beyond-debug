import * as vscode from 'vscode';

// Export main classes
export { DebugMcpServer } from './server';
export { McpManager } from './manager';
export { StatusManager } from './statusManager';

// Import classes for helper function
import { McpManager } from './manager';

// Import types for re-export
import { DebugSessionStatus, ServerHealthStatus } from './statusManager';

export { DebugSessionStatus, ServerHealthStatus };

// Extension integration helper
export function createMcpManager(context: vscode.ExtensionContext): McpManager {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    return new McpManager(context, workspaceRoot);
}