import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { CompletionItemKind, SymbolKind } from "vscode";

const DEFAULT_ARGS = ["--languages=perl", "-n", "--fields=k"];

// TODO s/EXTRA/PERL/g
const PERL = {
    // --recurse=yes
    // --tag-relative=yes
    // --langmap=perl:+.pod
    our: "--regex-perl=/^[ \\t]*our[ \\t]+([$@%][A-Za-z_][A-Za-z0-9_]+)/\\1/v,variable/", // add parens?
    my:  "--regex-perl=/^[ \\t]*my[ \\t(]+([$@%][A-Za-z][A-Za-z0-9:]+)[ \\t)]*/\\1/v,variable/",
    use: "--regex-perl=/^[ \\t]*use[ \\t]+['\"]*([A-Za-z][A-Za-z0-9:]+)['\" \\t]*;/\\1/u,use,uses/",
    require:
        "--regex-perl=/^[ \\t]*require[ \\t]+['\"]*([A-Za-z][A-Za-z0-9:]+)['\" \\t]*;/\\1/r,require,requires/", // DROP REQUIRES?

    alias: "--regex-perl=/^[ \\t]**([A-Za-z_][A-Za-z0-9:_]+)[ \\t]+=/\\1/l,alias,aliases/", // *bar = $foo;
    // use aliased?

    package:
        "--regex-perl=/package[ \\t]+['\"]*([A-Za-z][A-Za-z0-9:]+)['\" \\t]*;/\\1/p,package,packages/", // MODULE? CLASS?

    head1: "--regex-perl=/^=head1[ \\t]+(.+)/\0/d,pod,Plain Old Documentation/",
    head2: "--regex-perl=/^=head2[ \\t]+(.+)/-- \\1/d,pod,Plain Old Documentation/",
    head345: "--regex-perl=/^=head[3-5][ \\t]+(.+)/--- \\1/d,pod,Plain Old Documentation/",

    use_base:
        "--regex-perl=/use[ \\t]+base[ \\t]+['\"]*([A-Za-z][A-Za-z0-9:]+)['\" \\t]*;/\\1/e,extends/",
    use_parent:
        "--regex-perl=/use[ \\t]+parent[ \\t]+['\"]*([A-Za-z][A-Za-z0-9:]+)['\" \\t]*;/\\1/e,extends/",
    use_constant:
        "--regex-perl=/use[ \\t]+constant[ \\t]+['\"]*([A-Za-z_][A-Za-z0-9_]+)['\" \\t]*/\\1/c,constants/",
};

const MOOSE = {
    with: "--regex-perl=/with[ \\t]+['\"]*([A-Za-z][A-Za-z0-9:]+)['\" \\t]*;/\\1/w,role,roles/",
    extends: "--regex-perl=/extends[ \\t]+['\"]*([A-Za-z][A-Za-z0-9:]+)['\" \\t]*;/\\1/e,extends/",
    requires: "--regex-perl=/requires[ \\t]+['\"]*([A-Za-z][A-Za-z0-9:]+)['\" \\t]*;/\\1//", // INTERFACE
    has:
        "--regex-perl=/^[ \\t]*has[ \\t]+['\"]*([A-Za-z_+][A-Za-z0-9_]+)['\"]*[ \\t]+/\\1/a,attribute,attributes/",
    around:
        "--regex-perl=/^[ \\t]*around[ \\t]+['\"]*([A-Za-z_][A-Za-z0-9_]+)['\"]*[ \\t]+/\\1/x,around/",
};

// via https://gist.github.com/jbolila/7598018
// let g:tagbar_type_perl = {
//     \ 'ctagstype'   : 'Perl',
//     \ 'kinds' : [
//         \ 'p:packages:1:0',
//         \ 'u:uses:1:0',
//         \ 'r:requires:1:0',
//         \ 'e:extends',
//         \ 'w:roles',
//         \ 'o:ours:1:0',
//         \ 'c:constants:1:0',
//         \ 'f:formats:1:0',
//         \ 'a:attributes',
//         \ 's:subroutines',
//         \ 'x:around:1:0',
//         \ 'l:aliases',
//         \ 'd:pod:1:0',
//     \ ],

// ctags --list-kinds:

// VSCode:
// export enum CompletionItemKind {
//     Text        = 0,
//     Method      = 1,  sub method_name ($self
//     Function    = 2,  sub function_name
//     Constructor = 3,  sub BUILD
//     Field       = 4,  has field_name (see Property)
//     Variable    = 5,  √?
//     Class       = 6,  package package_name
//     Interface   = 7,  requires role_name?
//     Module      = 8,  package?
//     Property    = 9,  has prop_name (see Field)
//     Unit        = 10,
//     Value       = 11,
//     Enum        = 12, N/A
//     Keyword     = 13, √
//     Snippet     = 14,
//     Color       = 15,
//     Reference   = 17, ? (See Variable)
//     File        = 16, open()
//     Folder      = 18, opendir()
//     EnumMember  = 19, N/A
//     Constant    = 20, use constant
//     Struct      = 21, N/A
//     Event       = 22, N/A
//     Operator    = 23, ?
//     TypeParameter = 24, my $foo : Type; also isa => ...
// }

export const ITEM_KINDS: { [index: string]: Option<CompletionItemKind> } = {
    p: CompletionItemKind.Module,
    s: CompletionItemKind.Function,
    r: CompletionItemKind.Reference,
    v: CompletionItemKind.Variable,
    c: CompletionItemKind.Value,
};

// VSCode:
// export enum SymbolKind {
//     File = 0,
//     Module = 1,
//     Namespace = 2,
//     Package = 3,
//     Class = 4,
//     Method = 5,
//     Property = 6,
//     Field = 7,
//     Constructor = 8,
//     Enum = 9,        isa => Enum[...]
//     Interface = 10,
//     Function = 11,
//     Variable = 12,   isa =>
//     Constant = 13,   isa =>
//     String = 14,     isa => Str
//     Number = 15,     isa => Num
//     Boolean = 16,    isa => Bool
//     Array = 17,      isa => traits => 'ArrayRef',
//     Object = 18,     isa => Object
//     Key = 19,
//     Null = 20,       undef; isa => Undef
//     EnumMember = 21,
//     Struct = 22,
//     Event = 23,
//     Operator = 24,
//     TypeParameter = 25,
// }

export const SYMBOL_KINDS: { [index: string]: Option<SymbolKind> } = {
    p: SymbolKind.Package,
    s: SymbolKind.Function,
    l: SymbolKind.Constant,
    c: SymbolKind.Constant,
};

// TODO: if a setting is present, permit _ names to be Fields instead, eg:
//
// has name()   -> Property
// has _name()  -> Field
// has __name() -> Field

// TODO: sub name ($self, ...) -> Method

// TODO: requires Thing -> Interface

// TODO: with

export interface TagsFile {
    folder: string;
    data: string;
}

export class Ctags {
    versionOk = false;

    private getConfiguration(resource?: vscode.Uri): vscode.WorkspaceConfiguration {
        return vscode.workspace.getConfiguration("perl", resource);
    }

    getTagsFileName(resource: vscode.Uri): string {
        return this.getConfiguration(resource).get("ctagsFile", ".vstags");
    }

    getExecutablePath(): string {
        return this.getConfiguration().get("ctagsPath", "ctags");
    }

    async checkVersion(): Promise<Option<Error>> {
        if (this.versionOk) {
            return undefined;
        }

        const result = await this.run(["--version"]);
        if (result instanceof Error) {
            return Error(
                "Could not find a compatible version of Ctags, check extension log for more info."
            );
        }

        this.versionOk = true;

        return;
    }

    // running ctags

    private async run(args: string[], cwd?: string) {
        return new Promise<Result<string>>((resolve, reject) => {
            const file = this.getExecutablePath();
            let callback = (error: Error | null, stdout: string, stderr: string) => {
                if (error) {
                    console.error(`command failed: '${file} ${args.join(" ")}'`);
                    console.error(`cwd: '${cwd}'`);
                    console.error(`error message: 'error.message'`);
                    console.error(`stderr: '${stderr}'`);
                    resolve(error);
                }
                resolve(stdout);
            };

            let options: cp.ExecFileOptions = {};
            if (cwd !== undefined) {
                options.cwd = cwd;
            }
            cp.execFile(this.getExecutablePath(), args, options, callback);
        });
    }

    async generateProjectTagsFile(): Promise<void> {
        const folders = vscode.workspace.workspaceFolders;
        if (folders === undefined) {
            return Promise.resolve();
        }

        let error = await this.checkVersion();
        if (error !== undefined) {
            vscode.window.showErrorMessage("could not find a ");
            return;
        }

        const things = await Promise.all(
            folders.map(folder => {
                let filename = this.getTagsFileName(folder.uri);
                let args = DEFAULT_ARGS.concat(["-R", "--perl-kinds=psc", "-f", filename]);
                return this.run(args, folder.uri.fsPath);
            })
        );
    }

    async generateFileTags(document: vscode.TextDocument): Promise<Result<TagsFile>> {
        let args = DEFAULT_ARGS.concat(["-f", "-", document.fileName]);
        let workspace = vscode.workspace.getWorkspaceFolder(document.uri);
        let folder = workspace ? workspace.uri.fsPath : document.uri.fsPath;

        const data = await this.checkVersion().then(() => this.run(args, folder));
        if (data instanceof Error) {
            return data;
        }

        return { folder, data };
    }

    generateFileUseTags(document: vscode.TextDocument): Promise<Result<string>> {
        let args = DEFAULT_ARGS.concat([PERL["use"], "-f", "-", document.fileName]);
        let workspace = vscode.workspace.getWorkspaceFolder(document.uri);
        let cwd = workspace ? workspace.uri.fsPath : document.uri.fsPath;
        return this.checkVersion().then(() => this.run(args, cwd));
    }

    // reading tags (and other) files

    readFile(filename: string) {
        return new Promise<Result<string>>((resolve, reject) => {
            fs.readFile(filename, (error, data) => {
                if (error) {
                    console.error(`could not read file: ${filename}`);
                    console.error(`error message: ${error.message}`);
                    resolve(error);
                    return;
                }
                resolve(data.toString());
            });
        });
    }

    async readProjectTags(): Promise<Result<TagsFile>[]> {
        const folders = vscode.workspace.workspaceFolders;
        if (folders === undefined) {
            return [];
        }

        return Promise.all(
            folders.map(folder => {
                let filename = path.join(folder.uri.fsPath, this.getTagsFileName(folder.uri));
                return this.readFile(filename).then(data => {
                    if (data instanceof Error) {
                        return data;
                    }
                    return { folder: folder.uri.fsPath, data };
                });
            })
        );
    }

    async projectOrFileTags(document: vscode.TextDocument): Promise<Result<TagsFile>[]> {
        const results = await this.readProjectTags();
        if (results.length !== 0) {
            return results;
        }

        const result = await this.generateFileTags(document);
        return [result];
    }
}
