# fs

{% embed url="https://nodejs.org/api/fs.html\#fs\_fs\_writefilesync\_file\_data\_options" %}

## Important new trick!!! Use \`fs.promises\`...

```text
import fs from "fs"
const fsPromises = fs.promises

;(async function() {

  try {
    await fsPromises.writeFile("./myfile.txt", 'cool!', { flag: "w" })
  } catch (e) {
    debug.error(e)
  }
  
})()
```

* use flag "w" to create a file if it does not exist
* use try/catch to debug errors

## ALSO IMPORTANT:

File path is relative to your CLI - dir you ran the script from. NOT to the node file itself.

