with open("edge-bridge/src/index.ts", "r") as f:
    content = f.read()

content = content.replace("export interface Env {\\n  AI?: any;", "export interface Env {\\n  AI?: any;")

with open("edge-bridge/src/index.ts", "w") as f:
    f.write(content)
