# GDB Debugger - Beyond

Hi all, **Beyond Debug** is a debug adapter for Visual Studio Code.
It implemented through the GDB’s Machine Interface(MI).

## Supported Languages
* C, C++,Pascal,ObjectPascal, Fortran, D, Go, Objective-C, Fortran, OpenCL C,  Rust, assembly, Modula-2, and Ada.

## Supported features
* insert, *remove*, *enable*, *disable*, *condition* breakpoints
* view local variables
* view watchs
* multi-threaded debugging
* `remote`, `extended-remote` debugging 
* `gdbserver --multi` supported
* transfer files from local to remote  
* use native commands in debug console

## Using the debugger

* Install gdb on your system.
* Install the **Beyond Debug** extension in VS Code.
* Open your project
* Switch to the debug viewlet and press the gear dropdown.
* Select the debug environment "BeyondDebug(gdb)".
* Press the green 'play' button to start debugging.

You can now  debugging your program.

![Beyond Debug](https://dev.azure.com/coolchyni/00de68fc-20fd-4cff-8681-a0a0be966def/_apis/git/repositories/ce435a7c-1ae2-41d1-b97d-5c3f504c4c92/items?path=%2Fbeyond-debug.gif&versionDescriptor%5BversionOptions%5D=0&versionDescriptor%5BversionType%5D=0&versionDescriptor%5Bversion%5D=master&resolveLfs=true&%24format=octetStream&api-version=5.0)

## Launch a program

Use `launch.json` and setting `request` to `"launch"`. You also need to specify the executable
path for the debugger to find the debug symbols.

```json
{
    "type": "by-gdb",
    "request": "launch",
    "name": "Launch(gdb)",
    "program": "${fileBasenameNoExtension}",
    "cwd": "${workspaceRoot}"
}
```

##  Attach to process
Attaching to existing processes currently only works by specifying the processId in the
`launch.json` and setting `request` to `"attach"`. You also need to specify the executable
path for the debugger to find the debug symbols.

``` json
{
    "type": "by-gdb",
    "request": "attach",
    "name": "Attach(gdb)",
    "program": "{fileBasenameNoExtension}",
    "cwd": "${workspaceRoot}",
    "processId": 5678
}
```

This will attach to 5678  which should already run.

## Connect to gdbserver
You can use gdbserver as your remote debugger.  For that modify the
`launch.json` by setting `request` to `"launch"` and set `remote`  section as below: 

``` json
{
    "type": "by-gdb",
    "request": "launch",
    "name": "Launch(gdb)",
    "program": "${fileBasenameNoExtension}",
    "cwd": "${workspaceRoot}",
    "remote": { 
        "enabled": true,
        "address": ":2345",
        "mode": "remote",
        "execfile": "${fileBasenameNoExtension}"
    }
}
```
You also need to specify the executable
path for the debugger to find the debug symbols.

This will connect to the remote gdbserver on localhost:2345.

## Transfer file form local to remote
Often, if doing cross-platform compilation, we need to transfer locally compiled files to the server.
To do that, you need set `remote` - `transfer` as below:
``` json
{
    ...
    "remote": { 
        "enabled": true,
        "address": ":2345",
        "mode": "remote",
        "execfile": "${fileBasenameNoExtension}",
        "transfer": [
            { 
                "from": "${fileBasenameNoExtension}",
                "to":   "${fileBasenameNoExtension}"
            }
        ]
    }
}
```

## Use extended-remote mode
To use extende-remote mode. You must run gdbserver as `gdbserver --multi`.
Then change remote mode to `extended-remote`
in `launch.json`
``` json
{
    
    "remote": { 
        "enabled": true,
        "address": ":2345",
        "mode": "extended-remote",
        "execfile": "[filename]",
    }
}
```

## Use gdb's native command
You can use all the GDB commands from the debug console. Just like in the shell.

## View Memory
You can view memory data on debug console or `Microsoft Hex Editor` if it installed.
Rignt click in editor on deubgging or use command `byeond:View Memory`.
If no content is selected, you can input address like this:[address or variable]:[address length (default:100) ], e.g. `0x1111:12` or `0x1111` or `va:123` or `s.c_str():100` ...

## Todo List
* PickProcess for attach
* Add i18n supports
* lldb-mi support

