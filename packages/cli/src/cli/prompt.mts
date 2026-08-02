import readline from "node:readline";

type ProjectNamePromptOptions = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
};

export async function promptForProjectName({
  input = process.stdin,
  output = process.stdout,
}: ProjectNamePromptOptions = {}): Promise<string | null> {
  const lines = readline.createInterface({ input, output });
  lines.on("SIGINT", () => lines.close());
  output.write("Project name: ");

  try {
    for await (const line of lines) {
      const projectName = line.trim();
      if (projectName) {
        return projectName;
      }
      output.write("Project name cannot be empty.\nProject name: ");
    }
  } finally {
    lines.close();
  }

  output.write("\n");
  return null;
}
