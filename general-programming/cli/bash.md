---
description: 'It''s just like "Shell", but "Better". Therefore, "Bash".'
---

# Bash

### **Variables**

to set: `myvar=somevalue` or `myvar="my pwd is $(pwd)"`   
to use: `echo $somevalue`    

### **PWD vs DIRNAME vs REALPATH**

Refer to the dirname of the file/script, not to the command line dir that it was run from:

**`$(dirname $(realpath $0))`**  use like `cd $(dirname $(realpath $0))` 

`pwd` only refers to the dir that the script was called from . So does `dirname` 







