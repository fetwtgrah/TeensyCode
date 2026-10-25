export interface SandBox {
    type: string;
    workingdictory: string;
    writefile(path:string,content:string,overwrite:boolean):string;
    readfile(path: string, offest: number | undefined, limit: number | undefined): string;
    exec(command: string): Promise<{ stdout: string, exitcode: number }>;
    stop(): Promise<void>;
}
import { readFileSync,writeFileSync } from "node:fs";
import { resolve,relative,isAbsolute,sep} from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
const execAsync = promisify(exec);
export class LocalSandBox implements SandBox {
    type = "local";
    workingdictory: string;
    constructor(workingdictory: string) {
        this.workingdictory = workingdictory
    }
    writefile(path: string, content: string,overwrite:boolean): string {
       const abs = resolve(this.workingdictory, path);
       const rel = relative(this.workingdictory, abs);
        if (
             rel === ".." ||
             rel.startsWith(`..${sep}`) ||
             isAbsolute(rel)
            ) {
              return "拒绝写入：文件路径超出工作目录";
            }
        
        try {
              writeFileSync(abs, content, {
                encoding: "utf-8",
                flag: overwrite?"w":"wx"
              });
        
              return `文件创建成功：${rel}`;
            } catch (e: any) {
              if (e.code === "EEXIST") {
                return "文件已经存在，为避免覆盖，本次没有写入";
              }
        
              return `文件创建失败：${e.message}`;
            }
          };        
    readfile(filePath: string, offset: number | undefined, limit: number | undefined): string {
        const abs = resolve(this.workingdictory, filePath)
        let content: string
        try {
            content = readFileSync(abs, "utf-8")
        } catch {
            return `找不到文件${filePath}`
        }
        let lines = content.split("\n")
        if (offset) lines = lines.slice(offset - 1)
        if (limit) lines = lines.slice(0, limit)
        const MAX_LENGTH = 500
        const ifOver = MAX_LENGTH < lines.length
        lines = (ifOver) ? lines.slice(0, MAX_LENGTH) : lines
        const numbered = lines.map((line, i) => `${(offset || 1) + i}:${line}`)
        return ifOver
            ? numbered.join("\n") + `\n目前只读到了${MAX_LENGTH}行`
            : numbered.join("\n") + `\n读取文件行数：${lines.length}，已经阅读完成`
    }
    async exec(command: string) {
        try {
            const result = await execAsync(command, {
                cwd: this.workingdictory,
            });

            return {
                stdout: result.stdout,
                exitcode: 0,
            };
        } catch (error: any) {
            return {
                stdout: error.stdout ?? error.stderr ?? error.message,
                exitcode: error.code ?? 1,
            };
        }
    }

    async stop(): Promise<void> {

    }
}