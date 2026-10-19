import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export async function MessagePrint(message: any[], path: string) {
    const jsonStr = JSON.stringify(message, null, 2)
    const cwd = resolve(path, "log.txt")
    await writeFile(cwd, jsonStr, 'utf-8')

    const check= await readFile(cwd,'utf-8')
    console.log('验证结果：', check === jsonStr ? '写入成功' : '写入失败');
}