import path = require("path");

import * as vscode from 'vscode';
import * as fs from 'fs';
/**
 * @File   : util.ts
 * @Author :  (coolchyni)
 * @Link   : 
 * @Date   : 2/13/2022, 11:32:21 AM
 * some function copy form https://github.com/microsoft/vscode-cpptools/blob/main/Extension/src/common.ts
 */

 export let extensionPath: string;
 export let extensionContext: vscode.ExtensionContext | undefined;
 export function setExtensionContext(context: vscode.ExtensionContext): void {
     extensionContext = context;
     extensionPath = extensionContext.extensionPath;
 }
 export function setExtensionPath(path: string): void {
     extensionPath = path;
 }

 export function getExtensionFilePath(extensionfile: string): string {
    return path.resolve(extensionPath, extensionfile);
}
export function isVsCodeInsiders(): boolean {
    return extensionPath.includes(".vscode-insiders") ||
        extensionPath.includes(".vscode-server-insiders") ||
        extensionPath.includes(".vscode-exploration") ||
        extensionPath.includes(".vscode-server-exploration");
}

/**
 * Find PowerShell executable from PATH (for Windows only).
 */
 export function findPowerShell(): string | undefined {
    const dirs: string[] = (process.env.PATH || '').replace(/"+/g, '').split(';').filter(x => x);
    const exts: string[] = (process.env.PATHEXT || '').split(';');
    const names: string[] = ['pwsh', 'powershell'];
    for (const name of names) {
        const candidates: string[] = dirs.reduce<string[]>((paths, dir) => [
            ...paths, ...exts.map(ext => path.join(dir, name + ext))
        ], []);
        for (const candidate of candidates) {
            try {
                if (fs.statSync(candidate).isFile()) {
                    return name;
                }
            } catch (e) {
            }
        }
    }
}

var isPascal:boolean=undefined;
export function isLanguagePascal() {
    if (isPascal==undefined){
        let rootDir = vscode.workspace.rootPath;
        const pascalExtensions = ['.lpr', '.dpr', '.pas'];
        
        for (const extension of pascalExtensions) {
          const pascalFilePath = path.join(rootDir, `*${extension}`);
          const files = fs.readdirSync(rootDir);
          
          for (const file of files) {
            if (file.endsWith(extension)) {
                isPascal=true;
                return true;
            }
          }
        }
        isPascal =false;
        return false;
    }
    return isPascal;
    
  }