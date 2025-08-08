import * as vscode from 'vscode';
import { BeyDebug } from '../beyDebug';

export interface DebugSessionStatus {
    hasActiveSession: boolean;
    isRunning: boolean;
    isAttached: boolean;
    sessionType?: string;
    targetProgram?: string;
    workspaceRoot: string;
    lastUpdate: Date;
}

export interface ServerHealthStatus {
    isHealthy: boolean;
    uptime: number;
    requestCount: number;
    errorCount: number;
    lastError?: string;
    memoryUsage?: NodeJS.MemoryUsage;
}

export class StatusManager {
    private debugSession: BeyDebug | null = null;
    private workspaceRoot: string;
    private serverStartTime: Date;
    private requestCount: number = 0;
    private errorCount: number = 0;
    private lastHealthCheck: Date;
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private statusChangeEmitter = new vscode.EventEmitter<DebugSessionStatus>();
    
    public readonly onStatusChange = this.statusChangeEmitter.event;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.serverStartTime = new Date();
        this.lastHealthCheck = new Date();
        
        // Start periodic health checks
        this.startHealthChecks();
    }

    setDebugSession(session: BeyDebug | null): void {
        const oldStatus = this.getDebugSessionStatus();
        this.debugSession = session;
        const newStatus = this.getDebugSessionStatus();
        
        // Emit status change if session state changed
        if (oldStatus.hasActiveSession !== newStatus.hasActiveSession) {
            this.statusChangeEmitter.fire(newStatus);
        }
    }

    getDebugSessionStatus(): DebugSessionStatus {
        const status: DebugSessionStatus = {
            hasActiveSession: this.debugSession !== null,
            isRunning: false,
            isAttached: false,
            workspaceRoot: this.workspaceRoot,
            lastUpdate: new Date()
        };

        if (this.debugSession) {
            try {
                // Try to get session state using reflection since properties might be private
                const sessionAny = this.debugSession as any;
                
                status.isRunning = sessionAny._isRunning || false;
                status.isAttached = sessionAny._isAttached || false;
                status.sessionType = 'gdb';
                
                // Try to get target program if available
                if (sessionAny._targetProgram) {
                    status.targetProgram = sessionAny._targetProgram;
                }
            } catch (error) {
                // If reflection fails, use safe defaults
                console.error('Failed to get debug session details:', error);
            }
        }

        return status;
    }

    validateDebugSession(): boolean {
        const status = this.getDebugSessionStatus();
        
        if (!status.hasActiveSession) {
            console.warn('No active debug session');
            return false;
        }

        // Additional validation checks
        if (this.debugSession) {
            try {
                // Check if the debug session is still valid
                const sessionAny = this.debugSession as any;
                
                // Check if session has required methods
                if (typeof sessionAny.getBeyDbgSession !== 'function') {
                    console.error('Debug session is missing required methods');
                    return false;
                }

                return true;
            } catch (error) {
                console.error('Debug session validation failed:', error);
                return false;
            }
        }

        return false;
    }

    getServerHealthStatus(): ServerHealthStatus {
        const now = new Date();
        const uptime = now.getTime() - this.serverStartTime.getTime();
        
        return {
            isHealthy: this.isServerHealthy(),
            uptime: Math.floor(uptime / 1000), // in seconds
            requestCount: this.requestCount,
            errorCount: this.errorCount,
            lastError: this.getLastError(),
            memoryUsage: process.memoryUsage()
        };
    }

    private isServerHealthy(): boolean {
        const errorRate = this.requestCount > 0 ? this.errorCount / this.requestCount : 0;
        const maxErrorRate = 0.1; // 10% error rate threshold
        
        return errorRate <= maxErrorRate;
    }

    private getLastError(): string | undefined {
        // Since we removed the complex error handler, return simple error tracking
        return undefined; // Can be enhanced later if needed
    }

    incrementRequestCount(): void {
        this.requestCount++;
    }

    incrementErrorCount(): void {
        this.errorCount++;
    }

    private startHealthChecks(): void {
        // Perform health check every 30 seconds
        this.healthCheckInterval = setInterval(() => {
            this.performHealthCheck();
        }, 30000);
    }

    private performHealthCheck(): void {
        this.lastHealthCheck = new Date();
        
        const health = this.getServerHealthStatus();
        
        // Log health status if there are issues
        if (!health.isHealthy) {
            console.warn('[MCP Health Check] Server health degraded', {
                errorCount: health.errorCount,
                requestCount: health.requestCount,
                uptime: health.uptime,
                lastError: health.lastError
            });
        }

        // Check debug session health
        if (this.debugSession) {
            try {
                this.validateDebugSession();
            } catch (error) {
                console.error('Debug session health check failed:', error);
            }
        }
    }

    checkDebugSessionCompatibility(): { compatible: boolean; issues: string[] } {
        const issues: string[] = [];
        
        if (!this.debugSession) {
            return { compatible: false, issues: ['No debug session available'] };
        }

        try {
            const sessionAny = this.debugSession as any;
            
            // Check for required methods
            const requiredMethods = ['getBeyDbgSession'];
            for (const method of requiredMethods) {
                if (typeof sessionAny[method] !== 'function') {
                    issues.push(`Missing required method: ${method}`);
                }
            }

            // Check if we can get the underlying debug session
            try {
                const dbgSession = sessionAny.getBeyDbgSession();
                if (!dbgSession) {
                    issues.push('Unable to access underlying debug session');
                }
            } catch (error) {
                issues.push(`Error accessing debug session: ${error instanceof Error ? error.message : String(error)}`);
            }

        } catch (error) {
            issues.push(`Session compatibility check failed: ${error instanceof Error ? error.message : String(error)}`);
        }

        return {
            compatible: issues.length === 0,
            issues
        };
    }

    getDetailedStatus(): {
        debugSession: DebugSessionStatus;
        serverHealth: ServerHealthStatus;
        compatibility: { compatible: boolean; issues: string[] };
        errorStats: Record<string, number>;
    } {
        return {
            debugSession: this.getDebugSessionStatus(),
            serverHealth: this.getServerHealthStatus(),
            compatibility: this.checkDebugSessionCompatibility(),
            errorStats: { requestCount: this.requestCount, errorCount: this.errorCount }
        };
    }

    dispose(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        this.statusChangeEmitter.dispose();
    }

    // Utility methods for external monitoring
    resetCounters(): void {
        this.requestCount = 0;
        this.errorCount = 0;
        this.serverStartTime = new Date();
    }

    getUptimeString(): string {
        const uptime = this.getServerHealthStatus().uptime;
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        
        return `${hours}h ${minutes}m ${seconds}s`;
    }
}