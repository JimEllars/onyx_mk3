import sys

def patch_file(file_path, diff_path):
    with open(diff_path, 'r') as f:
        diff_lines = f.readlines()

    search_lines = []
    replace_lines = []
    mode = None
    for line in diff_lines:
        if line.strip() == '<<<<<<< SEARCH':
            mode = 'search'
        elif line.strip() == '=======':
            mode = 'replace'
        elif line.strip() == '>>>>>>> REPLACE':
            break
        else:
            if mode == 'search':
                search_lines.append(line)
            elif mode == 'replace':
                replace_lines.append(line)

    search_str = "".join(search_lines)
    replace_str = "".join(replace_lines)

    with open(file_path, 'r') as f:
        content = f.read()

    if search_str in content:
        content = content.replace(search_str, replace_str)
        with open(file_path, 'w') as f:
            f.write(content)
        print("Patched successfully")
    else:
        print("Search string not found")

patch_file(sys.argv[2], sys.argv[1])
