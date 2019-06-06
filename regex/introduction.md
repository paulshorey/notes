Lets say we want to find/replace file extensions in our entire codebase,  
from `.md` to `.html`...  
  
**in IDE:**  
Find: `(\[.*?\]\(\./.*?).md(\))`  
Replace: `$1.html$2`  
  
**using Javascript:**  
  
`str.replace(\(\[.*?\]\(\./.*?).md(\))\g, "$1.html$2");`  
  
#### Other common examples:  
Any new line (including existing trailing spaces)  
`([\ ]*?)\n`  
Replace with two spaces and a new line  
`  \n`  