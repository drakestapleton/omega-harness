// Minimal OMP extension: native tools are disabled; repository effects stay in the controller.
export default function (pi: any) {
  const z = pi.zod
  async function call(name: string, args: unknown) {
    const response = await fetch(process.env.PILOT_GATEWAY_URL + '/tool', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        Authorization: 'Bearer ' + process.env.PILOT_GATEWAY_TOKEN },
      body: JSON.stringify({ owner: process.env.PILOT_OWNER, name, arguments: args })
    })
    return { content: [{ type: 'text', text: await response.text() }] }
  }
  pi.registerTool({ name: 'repo_command', label: 'Execute', loadMode: 'essential',
    description: 'Execute a command in the isolated repository. The conductor cannot write.',
    parameters: z.object({ command: z.string() }),
    execute: async (_id: string, args: unknown) => call('execute', args) })
  if (process.env.PILOT_OWNER === 'conductor') {
    pi.registerTool({ name: 'delegate', label: 'Delegate', loadMode: 'essential',
      description: 'Delegate to a nondelegating worker with exclusive paths.',
      parameters: z.object({ owner: z.string(), paths: z.array(z.string()), instruction: z.string() }),
      execute: async (_id: string, args: unknown) => call('delegate', args) })
  }
}
