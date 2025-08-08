import * as vscode from 'vscode';

export interface DebugToolResponse {
    // Allow additional fields as MCP schemas include index signatures
    [key: string]: unknown;
    _meta?: Record<string, unknown>;
    content: Array<{
        type: "text";
        text: string;
    }>;
}

export enum McpErrorType {
    SERVER_START_FAILED = 'SERVER_START_FAILED',
    TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',
    DEBUG_SESSION_UNAVAILABLE = 'DEBUG_SESSION_UNAVAILABLE',
    CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
    NETWORK_ERROR = 'NETWORK_ERROR',
    VALIDATION_ERROR = 'VALIDATION_ERROR'
}

export interface McpError {
    type: McpErrorType;
    message: string;
    originalError?: Error;
    timestamp: Date;
    context?: Record<string, any>;
}

export class McpErrorHandler {
    private static errorHistory: McpError[] = [];
    private static readonly MAX_ERROR_HISTORY = 50;

    static handleServerStartError(error: unknown, context?: Record<string, any>): McpError {
        const mcpError = this.createError(
            McpErrorType.SERVER_START_FAILED,
            'Failed to start MCP server',
            error,
            context
        );

        this.logError(mcpError);
        vscode.window.showErrorMessage(`Failed to start MCP server: ${mcpError.message}`);

        return mcpError;
    }

    static handleToolError(toolName: string, error: unknown, context?: Record<string, any>): DebugToolResponse {
        const mcpError = this.createError(
            McpErrorType.TOOL_EXECUTION_FAILED,
            `Failed to execute tool '${toolName}'`,
            error,
            { toolName, ...context }
        );

        this.logError(mcpError);

        return {
            content: [{
                type: "text",
                text: `Error executing ${toolName}: ${mcpError.message}`
            }]
        };
    }

    static handleNoDebugSession(toolName?: string): DebugToolResponse {
        const mcpError = this.createError(
            McpErrorType.DEBUG_SESSION_UNAVAILABLE,
            'No active debug session available',
            undefined,
            { toolName }
        );

        this.logError(mcpError);

        return {
            content: [{
                type: "text",
                text: "No active debug session. Please start debugging first."
            }]
        };
    }

    static handleConfigurationError(error: unknown, context?: Record<string, any>): McpError {
        const mcpError = this.createError(
            McpErrorType.CONFIGURATION_ERROR,
            'MCP configuration error',
            error,
            context
        );

        this.logError(mcpError);
        vscode.window.showWarningMessage(
            `MCP configuration error: ${mcpError.message}. Using defaults.`
        );

        return mcpError;
    }

    static handleNetworkError(error: unknown, context?: Record<string, any>): McpError {
        const mcpError = this.createError(
            McpErrorType.NETWORK_ERROR,
            'Network error in MCP server',
            error,
            context
        );

        this.logError(mcpError);

        return mcpError;
    }

    static handleValidationError(message: string, context?: Record<string, any>): McpError {
        const mcpError = this.createError(
            McpErrorType.VALIDATION_ERROR,
            message,
            undefined,
            context
        );

        this.logError(mcpError);

        return mcpError;
    }

    private static createError(
        type: McpErrorType,
        message: string,
        originalError?: unknown,
        context?: Record<string, any>
    ): McpError {
        const errorMessage = originalError instanceof Error
            ? originalError.message
            : typeof originalError === 'string'
                ? originalError
                : message;

        return {
            type,
            message: errorMessage,
            originalError: originalError instanceof Error ? originalError : undefined,
            timestamp: new Date(),
            context
        };
    }

    private static logError(error: McpError): void {
        // Add to error history
        this.errorHistory.unshift(error);
        if (this.errorHistory.length > this.MAX_ERROR_HISTORY) {
            this.errorHistory = this.errorHistory.slice(0, this.MAX_ERROR_HISTORY);
        }

        // Log to console with context
        const logMessage = `[MCP ${error.type}] ${error.message}`;
        console.error(logMessage, {
            timestamp: error.timestamp,
            context: error.context,
            originalError: error.originalError
        });
    }

    static getErrorHistory(): McpError[] {
        return [...this.errorHistory];
    }

    static getRecentErrors(count: number = 10): McpError[] {
        return this.errorHistory.slice(0, count);
    }

    static clearErrorHistory(): void {
        this.errorHistory = [];
    }

    static getErrorStats(): Record<McpErrorType, number> {
        const stats: Record<McpErrorType, number> = {
            [McpErrorType.SERVER_START_FAILED]: 0,
            [McpErrorType.TOOL_EXECUTION_FAILED]: 0,
            [McpErrorType.DEBUG_SESSION_UNAVAILABLE]: 0,
            [McpErrorType.CONFIGURATION_ERROR]: 0,
            [McpErrorType.NETWORK_ERROR]: 0,
            [McpErrorType.VALIDATION_ERROR]: 0
        };

        this.errorHistory.forEach(error => {
            stats[error.type]++;
        });

        return stats;
    }

    static formatErrorForDisplay(error: McpError): string {
        const timeStr = error.timestamp.toLocaleTimeString();
        let message = `[${timeStr}] ${error.type}: ${error.message}`;

        if (error.context) {
            const contextStr = Object.entries(error.context)
                .map(([key, value]) => `${key}=${value}`)
                .join(', ');
            message += ` (${contextStr})`;
        }

        return message;
    }

    static isRecoverableError(error: McpError): boolean {
        switch (error.type) {
            case McpErrorType.NETWORK_ERROR:
            case McpErrorType.DEBUG_SESSION_UNAVAILABLE:
                return true;
            case McpErrorType.SERVER_START_FAILED:
            case McpErrorType.CONFIGURATION_ERROR:
                return false;
            case McpErrorType.TOOL_EXECUTION_FAILED:
            case McpErrorType.VALIDATION_ERROR:
                return true;
            default:
                return false;
        }
    }
}