export interface promptContent {
    workingDictory: string,
    sandBoxType: string,
    toolName: string[],
    gitBranch?: string,
    projectContext?: string
}

export function creatSystemPrompt(ctx: promptContent) {
    const prompt: string[] = [];
    prompt.push(
        `you are a coding agent working in ${ctx.workingDictory}`
    );
    prompt.push(
        `SandBox:${ctx.sandBoxType}`
    );
    if (ctx.projectContext) {
        prompt.push(`Project context: ${ctx.projectContext}`);
    }
    prompt.push(`
    # Agency  
    - USE your tools.
    - Available tools: ${ctx.toolName.join(", ")}
  `);
    prompt.push(`
  # Guardrails
  - Prefer simple, minimal changes
  - Search before creating, and reuse existing patterns
  - No new dependencies without asking`);
    if (ctx.gitBranch) {
        prompt.push(`- Current branch: ${ctx.gitBranch}`);
    }
    return prompt.join("\n");
}