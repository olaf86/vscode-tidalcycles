import { TextEditor, ExtensionContext, window, commands, languages, Range } from 'vscode';
import { Repl } from './repl';
import { Logger } from './logging';
import { Config } from './config';
import { Ghci } from './ghci';
import { Tidal } from './tidal';
import { History } from './history';
import { TidalLanguageHelpProvider } from './codehelp';
import * as path from 'path';
import { TidalExpression } from './editor';
import * as yaml from 'js-yaml';
import { readFileSync } from 'fs';

export function activate(context: ExtensionContext) {
    const config = new Config();
    const logger = new Logger(window.createOutputChannel('TidalCycles'));

    const ghci = new Ghci(logger, config.useStackGhci(), config.ghciPath(), config.showGhciOutput());
    const tidal = new Tidal(logger, ghci, config.bootTidalPath(), config.useBootFileInCurrentDirectory());
    const history = new History(logger, config);

    const hoveAndMarkdownPrivder = new TidalLanguageHelpProvider(
        ["commands-generated.yaml","commands.yaml"].map(x => ([x, path.join(context.extensionPath, x)]))
        .map(([source, defPath, ..._]) => {
            const ydef = yaml.load(readFileSync(defPath).toString());
            return {source: source, ydef};
        })
        , config
    );
    
    [languages.registerHoverProvider, languages.registerCompletionItemProvider]
        .forEach((regFunc:((selector:any, provider:any) => void)) => {
            regFunc({scheme:"*", pattern: '**/*.tidal'}, hoveAndMarkdownPrivder);
        });

    function getRepl(repls: Map<TextEditor, Repl>, textEditor: TextEditor | undefined): Repl | undefined {
        if (textEditor === undefined) { return undefined; }
        if (!repls.has(textEditor)) {
            repls.set(textEditor,
                new Repl(tidal, textEditor, history, config, window.createTextEditorDecorationType));
        }
        return repls.get(textEditor);
    }

    const repls = new Map<TextEditor, Repl>();

    if (config.showOutputInConsoleChannel()) {
        ghci.stdout.on('data', (data: any) => {
            logger.log(`${data}`, false);
        });

        ghci.stderr.on('data', (data: any) => {
            logger.warning(`GHCi | ${data}`);
        });
    }

    const evalSingleCommand = commands.registerCommand('tidal.eval', function (args?:{[key:string]:any}) {
        const repl = getRepl(repls, window.activeTextEditor);
        
        if (repl !== undefined) {

            if(typeof args !== 'undefined'){
                let command = Object.keys(args).filter(x => x === 'command').map(x=>args[x]).pop() as string | undefined;
                if(typeof command !== 'undefined'){
                    let range = Object.keys(args).filter(x => x === 'range').map(x=>args[x]).pop() as Range | undefined;
                    if(typeof range === 'undefined'){
                        range = new Range(0,0,0,0);
                    }

                    /*
                    this is a pragmatic way of splitting a list of commands into
                    distinct top level commands to executem them separately in
                    GHCi. The idea is that every time there's a not-indented
                    line, then all previous, unexecuted liens are executed up to
                    that line.
                    */

                    const lines = command.split(/\r?\n/);
                    let startLine = 0;

                    for(let i=0;i<lines.length;i++){
                        if(lines[i].length === 0){
                            continue;
                        }
                        let c = lines[i].charAt(0);
                        let m = c.match(/\S/);
                        let isEmpty = typeof m === 'undefined' || m === null || m.length === 0;
                        if(i !== lines.length - 1){
                            if(isEmpty){
                                continue;
                            }
                        }
                        let currentCommand = lines.slice(startLine, i+1).reduce((x,y)=>x+"\r\n"+y);
                        repl.evaluateExpression(new TidalExpression(currentCommand, range), true);
                        startLine = i+1;
                    }
                }
                return;
            }
        
            repl.evaluate(false);
        }
    });

    const evalMultiCommand = commands.registerCommand('tidal.evalMulti', function () {
        const repl = getRepl(repls, window.activeTextEditor);
        if (repl !== undefined) {
            repl.evaluate(true);
        }
    });

    const hushCommand = commands.registerCommand('tidal.hush', function () {
        const repl = getRepl(repls, window.activeTextEditor);
        if (repl !== undefined) {
            repl.hush();
        }
    });

    context.subscriptions.push(evalSingleCommand, evalMultiCommand, hushCommand);
}

export function deactivate() { }