import re

with open("main.rs", "r") as f:
    content = f.read()

content = content.replace("    State {\n        output_format: CliOutputFormat,\n    },\n    State {\n        output_format: CliOutputFormat,\n    },", "    State {\n        output_format: CliOutputFormat,\n    },")
content = content.replace("CliAction::State { output_format } => print_state(output_format),\n        CliAction::State { output_format } => print_state(output_format),", "CliAction::State { output_format } => print_state(output_format),")
content = content.replace("\"state\" => Ok(CliAction::State { output_format }),\n        \"state\" => Ok(CliAction::State { output_format }),", "\"state\" => Ok(CliAction::State { output_format }),")

with open("main.rs", "w") as f:
    f.write(content)
