with open("edge-bridge/src/index.ts", "r") as f:
    content = f.read()

content = content.replace("export interface Env {", "export interface Env {\\n  AI?: any;")
content = content.replace("payload.message || 'Hello'", "(payload as any).message || 'Hello'")

with open("edge-bridge/src/index.ts", "w") as f:
    f.write(content)
