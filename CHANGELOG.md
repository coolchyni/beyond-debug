## [0.9.13] - 2022-11-23
## Added 
 - Add language argument for launching c++, pascal program.

## [0.9.12] - 2022-11-21
## Added 
 - Open SSH shell as terminal for debug.
 - Show progress when uploading file through ssh.
 - Only modified files will be uploaded.

## [0.9.11] - 2022-10-25
## Added 
 - Use gdb through SSH

## [0.9.10] - 2022-10-17
## Fixed 
 - Breakpointer not inserted after attach

## [0.9.9] -  2022-10-11
### Fixed
 - repository url change to github
 - #2 command 'extension.pickNativeProcess' already exists

## [0.9.7] -  2022-10-09
### Added
- Support of display TString.Strings for Free pascal.
- Support set breakpoint at runing on windows
- Show thread id in call stack window
- Pick process for attach

### Fixed
- The utf8 string is displayed incorrectly.

## [0.9.6] -  2021-06-15
### Added
- Add `View Memory` Command. Will open memery data in `Microsoft Hex Editor` if it installed.
- Add `View Memory` menu in editor on debuging.

## [0.9.5] -  2021-06-13
### Fixed
- Parse failure on some data whith \. 

## [0.9.4] -  2020-10-15
### Added
- Supports set variable value
- Use vscode terminal to show program's output on linux and macOS.
### Fixed
- Failure to set breakpoints during debugging multi-threaded programs on Linux 

## [0.9.3] -  2020-10-14
### Added
- Highlighting when an exception is triggered 
### Fixed
- Variable display is wrong after stackframe switched

## [0.9.2] -  2020-09-24
### Added
- add `programArgs` Set the inferior program arguments, to be used in the program run 
- add `commandsBeforeExec` Commands run before execution.
## [0.9.1] -  2020-09-17
### Changed 
-  Change keyword in `package.json`
## [0.9.0] - 2020/09/16
### Added
* Initial release


