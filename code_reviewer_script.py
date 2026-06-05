import subprocess
import os

diff = subprocess.check_output(['git', 'diff', 'HEAD']).decode('utf-8')
print("Code changes:")
print(diff)
