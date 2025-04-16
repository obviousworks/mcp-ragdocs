registerTool({
  name: 'add_documentation',
  description: 'Adds documentation to the vector index',
  parameters: z.object({ url: z.string() }),
  run: async ({ url }) => { await addDocumentation(url); }
})
